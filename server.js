require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const { hashPassword, verifyScryptPassword } = require('./lib/passwords');
const { criarRepositorio } = require('./lib/repository');

const DEFAULT_PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_DATA_FILE = path.join(__dirname, 'data', 'agendamentos.json');
const SESSION_COOKIE = 'vr_admin_session';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_CREDENTIALS_PER_LOOKUP = 50;
const MAX_MESSAGE_LENGTH = 1000;

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function hashAccessToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function tokenMatchesHash(token, storedHash) {
  if (typeof token !== 'string' || typeof storedHash !== 'string' || !token || !storedHash) {
    return false;
  }
  const received = crypto.createHash('sha256').update(token).digest();
  let expected;
  try {
    expected = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  return expected.length === received.length && crypto.timingSafeEqual(received, expected);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseAllowedOrigins(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

function parseAppointmentId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function resolveSessionSecret(explicitSecret, isProduction) {
  const secret = explicitSecret || process.env.SESSION_SECRET;
  if (secret) {
    if (String(secret).length < 32) {
      throw new Error('SESSION_SECRET deve ter pelo menos 32 caracteres.');
    }
    return String(secret);
  }
  if (isProduction) {
    throw new Error('SESSION_SECRET é obrigatório quando NODE_ENV=production.');
  }
  return crypto.randomBytes(32).toString('hex');
}

function createApp(options = {}) {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const publicDir = options.publicDir || DEFAULT_PUBLIC_DIR;
  const dataFile = options.dataFile || process.env.DATA_FILE || DEFAULT_DATA_FILE;
  const sessionSecret = resolveSessionSecret(options.sessionSecret, isProduction);
  const adminPassword = options.adminPassword !== undefined
    ? options.adminPassword
    : process.env.ADMIN_PASSWORD;
  const adminPasswordHash = options.adminPasswordHash !== undefined
    ? options.adminPasswordHash
    : process.env.ADMIN_PASSWORD_HASH;
  const allowedOrigins = parseAllowedOrigins(
    options.allowedOrigins !== undefined ? options.allowedOrigins : process.env.ALLOWED_ORIGIN
  );
  const loginAttempts = new Map();
  let writeQueue = Promise.resolve();
  // A escolha do backend vive na fábrica: Postgres quando há pool, JSON caso contrário.
  const repositorio = options.repositorio || criarRepositorio({
    pool: options.pool,
    dataFile,
    fs,
  });

  const app = express();
  app.disable('x-powered-by');
  if (isProduction) app.set('trust proxy', 1);

  // A interface do repositório já é atômica no backend; this garante a ordem
  // das operações dentro do processo.
  function withDataLock(task) {
    const result = writeQueue.then(task);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  function verifyAdminPassword(candidate) {
    if (typeof candidate !== 'string' || !candidate) return false;
    if (adminPasswordHash) return verifyScryptPassword(candidate, adminPasswordHash);
    if (typeof adminPassword === 'string' && adminPassword) return safeEqual(candidate, adminPassword);
    return false;
  }

  function signSession(expiresAt) {
    const payload = base64url(JSON.stringify({ sub: 'admin', exp: expiresAt }));
    const signature = base64url(
      crypto.createHmac('sha256', sessionSecret).update(payload).digest()
    );
    return `${payload}.${signature}`;
  }

  function verifySession(token) {
    if (typeof token !== 'string') return false;
    const pieces = token.split('.');
    if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return false;
    const expected = crypto.createHmac('sha256', sessionSecret).update(pieces[0]).digest();
    let received;
    try {
      received = Buffer.from(pieces[1], 'base64url');
    } catch {
      return false;
    }
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      return false;
    }
    try {
      const payload = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8'));
      return payload.sub === 'admin' && Number(payload.exp) > Date.now();
    } catch {
      return false;
    }
  }

  function isAdminRequest(req) {
    return verifySession(readCookie(req, SESSION_COOKIE));
  }

  function bearerToken(req) {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1].trim() : null;
  }

  function setSessionCookie(res) {
    const token = signSession(Date.now() + SESSION_TTL_MS);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isProduction,
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  }

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isProduction,
      path: '/',
    });
  }

  function isSameOrigin(req, origin) {
    if (allowedOrigins.includes(origin)) return true;
    try {
      const parsed = new URL(origin);
      const forwarded = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
      return parsed.host === req.get('host') && parsed.protocol === `${forwarded}:`;
    } catch {
      return false;
    }
  }

  function rateLimitLogin(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (!current || current.resetAt <= now) {
      loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
      return next();
    }
    if (current.count >= MAX_LOGIN_ATTEMPTS) {
      res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
    }
    current.count += 1;
    return next();
  }

  function publicAppointment(record) {
    return {
      id: record.id,
      nome: record.nome,
      tipo: record.tipo,
      data: record.data,
      hora: record.hora,
      email: record.email,
      telefone: record.telefone,
      mensagem: record.mensagem,
      confirmado: Boolean(record.confirmado),
      criadoEm: record.criadoEm,
    };
  }

  function adminAppointment(record) {
    return {
      ...publicAppointment(record),
      temCredencial: Boolean(record.accessTokenHash),
    };
  }

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https://images.unsplash.com",
        "connect-src 'self'",
      ].join('; ')
    );
    if (isProduction) {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(express.json({ limit: '32kb', strict: true }));

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!req.path.startsWith('/api')) return next();
    const origin = req.get('origin');
    if (origin && !isSameOrigin(req, origin)) {
      return res.status(403).json({ error: 'Origem não permitida' });
    }
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type deve ser application/json' });
    }
    return next();
  });

  // Área administrativa: a página em si não contém dados.
  app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));

  // GET /api/ocupados — apenas datas/horários ocupados, sem dados pessoais.
  app.get('/api/ocupados', async (req, res, next) => {
    try {
      const agendamentos = await repositorio.readAll();
      const slots = new Set(agendamentos.map((ag) => `${ag.data}T${ag.hora}`));
      res.json([...slots]);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/login — senha verificada no servidor; sessão em cookie HttpOnly.
  app.post('/api/login', rateLimitLogin, (req, res) => {
    const password = req.body && req.body.senha;
    if (!verifyAdminPassword(password)) {
      return res.status(401).json({ error: 'Não autorizado' });
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    loginAttempts.delete(key);
    setSessionCookie(res);
    return res.status(200).json({ ok: true });
  });

  // GET /api/session — informa se a sessão administrativa está ativa.
  app.get('/api/session', (req, res) => {
    res.json({ authenticated: isAdminRequest(req) });
  });

  // POST /api/logout — encerra a sessão no navegador.
  app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    res.status(204).send();
  });

  // POST /api/agendamentos — criação pública. O servidor define id, status e token.
  app.post('/api/agendamentos', async (req, res, next) => {
    try {
      const body = req.body || {};
      const nome = cleanText(body.nome, 120);
      const tipo = cleanText(body.tipo, 20);
      const data = cleanText(body.data, 10);
      const hora = cleanText(body.hora, 5);
      const email = cleanText(body.email, 254);
      const telefone = cleanText(body.telefone, 40);
      const mensagem = cleanText(body.mensagem, MAX_MESSAGE_LENGTH);

      if (!nome || !tipo || !data || !hora) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
      }
      if (!['online', 'presencial'].includes(tipo)) {
        return res.status(400).json({ error: 'Tipo inválido' });
      }
      if (!isValidDate(data) || !isValidTime(hora)) {
        return res.status(400).json({ error: 'Data ou horário inválido' });
      }
      if (email && !isValidEmail(email)) {
        return res.status(400).json({ error: 'E-mail inválido' });
      }
      if (telefone && !isValidPhone(telefone)) {
        return res.status(400).json({ error: 'Telefone inválido' });
      }

      const result = await withDataLock(async () => {
        const agendamentos = await repositorio.readAll();
        if (agendamentos.some((ag) => ag.data === data && ag.hora === hora)) {
          return { conflict: true };
        }
        let id;
        do {
          // O id precisa continuar sendo um número seguro para o JavaScript do navegador.
          id = Number(`${Date.now()}${crypto.randomInt(1000, 10000)}`.slice(-15));
        } while (await repositorio.findById(id));

        const accessToken = crypto.randomBytes(32).toString('base64url');
        const newAppointment = {
          id,
          nome,
          tipo,
          data,
          hora,
          email,
          telefone,
          mensagem,
          confirmado: false,
          criadoEm: new Date().toISOString(),
          accessTokenHash: hashAccessToken(accessToken),
        };
        const saved = await repositorio.insert(newAppointment);
        if (!saved) return { conflict: true };
        return { appointment: saved, accessToken };
      });

      if (result.conflict) {
        return res.status(409).json({ error: 'Horário já ocupado' });
      }
      return res.status(201).json({
        ...publicAppointment(result.appointment),
        accessToken: result.accessToken,
      });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/agendamentos/meus — retorna somente registros cujo token confere.
  app.post('/api/agendamentos/meus', async (req, res, next) => {
    try {
      const credentials = req.body && req.body.credentials;
      if (!Array.isArray(credentials) || credentials.length > MAX_CREDENTIALS_PER_LOOKUP) {
        return res.status(400).json({ error: 'Credenciais inválidas' });
      }
      const agendamentos = await repositorio.readAll();
      const found = [];
      for (const credential of credentials) {
        if (!credential || typeof credential !== 'object') continue;
        const id = parseAppointmentId(credential.id);
        if (!id) continue;
        const record = agendamentos.find((ag) => ag.id === id);
        if (record && tokenMatchesHash(credential.token, record.accessTokenHash)) {
          found.push(publicAppointment(record));
        }
      }
      return res.json(found);
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/agendamentos — somente sessão administrativa.
  app.get('/api/agendamentos', async (req, res, next) => {
    if (!isAdminRequest(req)) {
      return res.status(401).json({ error: 'Não autorizado' });
    }
    try {
      const agendamentos = await repositorio.readAll();
      return res.json(agendamentos.map(adminAppointment));
    } catch (error) {
      return next(error);
    }
  });

  // PUT /api/agendamentos/:id — somente sessão administrativa.
  app.put('/api/agendamentos/:id', async (req, res, next) => {
    if (!isAdminRequest(req)) {
      return res.status(401).json({ error: 'Não autorizado' });
    }
    const id = parseAppointmentId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    const body = req.body || {};
    const nome = cleanText(body.nome, 120);
    const tipo = cleanText(body.tipo, 20);
    const data = cleanText(body.data, 10);
    const hora = cleanText(body.hora, 5);
    const email = cleanText(body.email, 254);
    const telefone = cleanText(body.telefone, 40);
    const mensagem = cleanText(body.mensagem, MAX_MESSAGE_LENGTH);

    if (!nome || !tipo || !data || !hora) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }
    if (!['online', 'presencial'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido' });
    }
    if (!isValidDate(data) || !isValidTime(hora)) {
      return res.status(400).json({ error: 'Data ou horário inválido' });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }
    if (telefone && !isValidPhone(telefone)) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }

    try {
      const updated = await withDataLock(async () => {
        const agendamentos = await repositorio.readAll();
        const current = agendamentos.find((ag) => ag.id === id);
        if (!current) return { notFound: true };
        if (agendamentos.some((ag) => ag.id !== id && ag.data === data && ag.hora === hora)) {
          return { conflict: true };
        }
        const alterado = await repositorio.update(id, {
          nome,
          tipo,
          data,
          hora,
          email,
          telefone,
          mensagem,
          confirmado: body.confirmado !== undefined ? Boolean(body.confirmado) : current.confirmado,
        });
        return { appointment: alterado };
      });

      if (updated.notFound) return res.status(404).json({ error: 'Agendamento não encontrado' });
      if (updated.conflict) return res.status(409).json({ error: 'Horário já ocupado' });
      return res.json(adminAppointment(updated.appointment));
    } catch (error) {
      return next(error);
    }
  });

  // DELETE /api/agendamentos/:id — admin ou dono do agendamento (token).
  app.delete('/api/agendamentos/:id', async (req, res, next) => {
    const id = parseAppointmentId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const admin = isAdminRequest(req);
    const token = bearerToken(req);
    if (!admin && !token) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    try {
      const outcome = await withDataLock(async () => {
        const alvo = await repositorio.findById(id);
        if (!alvo) return { notFound: true };
        if (!admin && !tokenMatchesHash(token, alvo.accessTokenHash)) {
          return { notFound: true };
        }
        await repositorio.remove(id);
        return { removed: true };
      });
      if (outcome.notFound) return res.status(404).json({ error: 'Agendamento não encontrado' });
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });

  // Somente public/ é servido. server.js, data/, package*.json e .env ficam fora.
  app.use(express.static(publicDir, {
    index: 'index.html',
    dotfiles: 'ignore',
    fallthrough: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.set('Cache-Control', 'no-cache');
      }
    },
  }));

  app.use((req, res) => {
    res.status(404).type('text/plain').send('Página não encontrada');
  });

  app.use((error, req, res, next) => {
    if (error && (error.type === 'entity.parse.failed' || error instanceof SyntaxError)) {
      return res.status(400).json({ error: 'JSON inválido' });
    }
    if (error && error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Conteúdo muito grande' });
    }
    console.error('Erro interno:', error && error.name ? error.name : 'unknown');
    return res.status(500).json({ error: 'Erro interno' });
  });

  return app;
}

// O pool só é criado no processo real do servidor, nunca em testes.
function criarPoolSeConfigurado() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      console.error('ERRO: DATABASE_URL ausente em producao. O armazenamento em arquivo JSON e efemero no Render e nao e seguro para agendamentos.');
      process.exit(1);
    }
    return null;
  }
  const { Pool } = require('pg');

  // O proprio sslmode da connection string manda, quando presente:
  //   require    -> TLS sem verificar a cadeia (padrão do Neon e do Render)
  //   verify-full-> TLS com cadeia verificada
  //   disable    -> sem TLS (apenas Postgres local)
  let ssl;
  if (process.env.DATABASE_SSL === 'false') {
    ssl = false;
  } else if (/[?&]sslmode=/.test(url)) {
    ssl = undefined; // deixa o driver interpretar
  } else {
    ssl = { rejectUnauthorized: false };
  }

  const pool = new Pool({
    connectionString: url,
    ...(ssl === undefined ? {} : { ssl }),
    max: 5,
    // Sem isto, uma conexao ociosa mantida pelo pool impede o scale-to-zero
    // do Neon e o servico fica sempre ligado.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (erro) => {
    console.error('Erro de conexao com o banco:', erro.message);
  });
  return pool;
}

let app = null;
let pool = null;

if (require.main === module) {
  pool = criarPoolSeConfigurado();
  app = createApp({ pool });
  const port = Number(process.env.PORT) || 3000;
  const iniciar = async () => {
    if (pool) {
      const { criarRepositorioPostgres } = require('./lib/repository');
      await criarRepositorioPostgres({ pool }).garantirEsquema();
      console.log('Persistência: Postgres');
    } else {
      console.log('Persistência: arquivo JSON (defina DATABASE_URL para usar Postgres)');
    }
    app.listen(port, () => {
      console.log(`Servidor rodando na porta ${port}`);
      console.log('Arquivos públicos servidos de public/');
    });
  };
  iniciar().catch((erro) => {
    console.error('Falha ao iniciar:', erro.message);
    process.exit(1);
  });
} else {
  // Importado por testes: sem banco, sem conexão.
  app = createApp();
}

module.exports = { createApp, app, criarPoolSeConfigurado, hashPassword, verifyScryptPassword };