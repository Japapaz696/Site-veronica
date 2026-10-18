const http = require('http');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');
const { hashPassword } = require('../lib/passwords');

const ADMIN_PASSWORD = 'senha-de-teste-administrativa';
const SESSION_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-ok';
const BOOKING_PAYLOAD = {
  nome: 'Paciente de Teste',
  tipo: 'online',
  data: '2026-12-01',
  hora: '09:00',
  email: 'paciente@example.com',
  telefone: '31999999999',
  mensagem: 'Primeira sessão',
};

let server;
let baseUrl;
let dataFile;
let publicDir;
let tempRoot;

function request(method, url, options = {}) {
  return fetch(baseUrl + url, {
    method,
    redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function login() {
  const res = await request('POST', '/api/login', { body: { senha: ADMIN_PASSWORD } });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  return cookie;
}

before(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'site-veronica-test-'));
  dataFile = path.join(tempRoot, 'data', 'agendamentos.json');
  publicDir = path.join(tempRoot, 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, '[]', 'utf8');
  await fs.writeFile(path.join(publicDir, 'index.html'), '<h1>Home</h1>', 'utf8');

  // Arquivos internos que nunca podem ser servidos
  await fs.writeFile(path.join(tempRoot, 'server.js'), 'const segredo = "interno";', 'utf8');
  await fs.writeFile(path.join(tempRoot, '.env'), 'ADMIN_PASSWORD=valor-interno-de-teste', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'render.yaml'), 'services: []', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'package.json'), '{"name":"interno"}', 'utf8');

  const app = createApp({
    publicDir,
    dataFile,
    adminPasswordHash: hashPassword(ADMIN_PASSWORD),
    sessionSecret: SESSION_SECRET,
    allowedOrigins: '',
    isProduction: false,
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('exposição de arquivos internos', () => {
  const blocked = [
    '/server.js',
    '/.env',
    '/render.yaml',
    '/package.json',
    '/data/agendamentos.json',
    '/lib/passwords.js',
    '/../server.js',
    '/public/../server.js',
  ];

  for (const target of blocked) {
    test(`bloqueia ${target}`, async () => {
      const res = await request('GET', target);
      assert.equal(res.status, 404);
      const body = await res.text();
      assert.ok(!body.includes('ADMIN_PASSWORD'));
      assert.ok(!body.includes('segredo'));
    });
  }

  test('serve normalmente a página pública', async () => {
    const res = await request('GET', '/index.html');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Home/);
  });

  test('resposta não anuncia o framework', async () => {
    const res = await request('GET', '/index.html');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('autenticação administrativa', () => {
  test('senha errada e senha ausente retornam 401 sem cookie', async () => {
    for (const body of [{ senha: 'errada' }, {}, { senha: '' }]) {
      const res = await request('POST', '/api/login', { body });
      assert.equal(res.status, 401);
      assert.equal(res.headers.getSetCookie().length, 0);
    }
  });

  test('senha correta devolve cookie HttpOnly e SameSite=Strict', async () => {
    const res = await request('POST', '/api/login', { body: { senha: ADMIN_PASSWORD } });
    assert.equal(res.status, 200);
    const cookie = res.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /^vr_admin_session=/);
    // A senha nunca é devolvida no corpo
    assert.deepEqual(await res.json(), { ok: true });
  });

  test('rota administrativa exige sessão', async () => {
    const res = await request('GET', '/api/agendamentos');
    assert.equal(res.status, 401);
  });

  test('o antigo header x-admin-password não autentica mais', async () => {
    const res = await request('GET', '/api/agendamentos', {
      headers: { 'x-admin-password': ADMIN_PASSWORD },
    });
    assert.equal(res.status, 401);
  });

  test('sessão válida acessa a lista completa', async () => {
    await request('POST', '/api/agendamentos', { body: BOOKING_PAYLOAD });
    const cookie = await login();
    const res = await request('GET', '/api/agendamentos', { headers: { cookie } });
    assert.equal(res.status, 200);
    const lista = await res.json();
    assert.equal(lista.length, 1);
    assert.equal(lista[0].nome, BOOKING_PAYLOAD.nome);
    assert.equal(lista[0].temCredencial, true);
    // O hash do token nunca é exposto
    assert.equal(lista[0].accessTokenHash, undefined);
  });

  test('cookie adulterado é rejeitado', async () => {
    const cookie = await login();
    const [name, value] = cookie.split('=');
    const tampered = `${name}=${value.slice(0, -4)}abcd`;
    const res = await request('GET', '/api/agendamentos', { headers: { cookie: tampered } });
    assert.equal(res.status, 401);
  });

  test('/api/session reflete o estado da sessão', async () => {
    const semSessao = await request('GET', '/api/session');
    assert.deepEqual(await semSessao.json(), { authenticated: false });

    const cookie = await login();
    const comSessao = await request('GET', '/api/session', { headers: { cookie } });
    assert.deepEqual(await comSessao.json(), { authenticated: true });
  });

  test('logout invalida a sessão no navegador', async () => {
    const cookie = await login();
    const res = await request('POST', '/api/logout', { headers: { cookie } });
    assert.equal(res.status, 204);
    const cleared = res.headers.getSetCookie()[0];
    assert.match(cleared, /vr_admin_session=;|vr_admin_session=$|Max-Age=0/i);
  });

  test('limita tentativas repetidas de login', async () => {
    const app = createApp({
      publicDir,
      dataFile,
      adminPasswordHash: hashPassword(ADMIN_PASSWORD),
      sessionSecret: SESSION_SECRET,
      allowedOrigins: '',
      isProduction: false,
    });
    const local = http.createServer(app);
    await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${local.address().port}`;
    const attempt = () => fetch(`${url}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: 'errada' }),
    });
    try {
      const statuses = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await attempt()).status);
      assert.equal(statuses.filter((s) => s === 429).length, 2);
      assert.equal(statuses.at(-1), 429);
    } finally {
      await new Promise((resolve) => local.close(resolve));
    }
  });
});

describe('token do paciente e enumeração', () => {
  test('cada agendamento recebe id e token próprios', async () => {
    const res = await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-20', hora: '10:00' },
    });
    assert.equal(res.status, 201);
    const criado = await res.json();
    assert.ok(Number.isSafeInteger(criado.id));
    assert.equal(typeof criado.accessToken, 'string');
    assert.ok(criado.accessToken.length >= 32);
    assert.equal(criado.accessTokenHash, undefined);
    assert.equal(criado.confirmado, false);
  });

  test('token válido devolve só o próprio agendamento', async () => {
    const primeiro = await (await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-21', hora: '11:00' },
    })).json();
    const segundo = await (await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-21', hora: '12:00' },
    })).json();

    const res = await request('POST', '/api/agendamentos/meus', {
      body: { credentials: [{ id: primeiro.id, token: primeiro.accessToken }] },
    });
    assert.equal(res.status, 200);
    const meus = await res.json();
    assert.equal(meus.length, 1);
    assert.equal(meus[0].id, primeiro.id);
    assert.ok(!meus.some((ag) => ag.id === segundo.id));
  });

  test('token errado não devolve nada, mesmo com id correto', async () => {
    const criado = await (await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-22', hora: '13:00' },
    })).json();

    const res = await request('POST', '/api/agendamentos/meus', {
      body: { credentials: [{ id: criado.id, token: 'token-invalido-com-tamanho-grande-o-suficiente' }] },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  test('enumeração de ids não retorna dados de terceiros', async () => {
    for (const ids of ['1', '1,2,3', '1000000']) {
      const res = await request('GET', `/api/agendamentos/por-ids?ids=${ids}`);
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, 'Rota não encontrada');
    }
  });

  test('lista de credenciais é limitada', async () => {
    const credentials = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, token: 'x'.repeat(40) }));
    const res = await request('POST', '/api/agendamentos/meus', { body: { credentials } });
    assert.equal(res.status, 400);
  });

  test('cancelamento sem token é recusado', async () => {
    const criado = await (await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-23', hora: '14:00' },
    })).json();

    const semToken = await request('DELETE', `/api/agendamentos/${criado.id}`);
    assert.equal(semToken.status, 401);

    const tokenErrado = await request('DELETE', `/api/agendamentos/${criado.id}`, {
      headers: { authorization: 'Bearer token-errado-mas-com-tamanho-ok-para-teste' },
    });
    assert.equal(tokenErrado.status, 404);

    // O registro continua existindo depois das tentativas
    const cookie = await login();
    const lista = await (await request('GET', '/api/agendamentos', { headers: { cookie } })).json();
    assert.ok(lista.some((ag) => ag.id === criado.id));
  });

  test('cancelamento com o token correto funciona', async () => {
    const criado = await (await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-24', hora: '15:00' },
    })).json();

    const res = await request('DELETE', `/api/agendamentos/${criado.id}`, {
      headers: { authorization: `Bearer ${criado.accessToken}` },
    });
    assert.equal(res.status, 204);

    const repetido = await request('DELETE', `/api/agendamentos/${criado.id}`, {
      headers: { authorization: `Bearer ${criado.accessToken}` },
    });
    assert.equal(repetido.status, 404);
  });

  test('administrador cancela qualquer agendamento', async () => {
    const criado = await (await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-25', hora: '16:00' },
    })).json();
    const cookie = await login();
    const res = await request('DELETE', `/api/agendamentos/${criado.id}`, { headers: { cookie } });
    assert.equal(res.status, 204);
  });
});

describe('validação de entrada', () => {
  const invalidos = [
    [{ ...BOOKING_PAYLOAD, nome: '' }, 'sem nome'],
    [{ ...BOOKING_PAYLOAD, tipo: 'domiciliar' }, 'tipo desconhecido'],
    [{ ...BOOKING_PAYLOAD, data: '01/12/2026' }, 'data em formato errado'],
    [{ ...BOOKING_PAYLOAD, data: '2026-13-45' }, 'data inexistente'],
    [{ ...BOOKING_PAYLOAD, hora: '25:99' }, 'hora inválida'],
    [{ ...BOOKING_PAYLOAD, email: 'invalido' }, 'e-mail inválido'],
    [{ ...BOOKING_PAYLOAD, telefone: '123' }, 'telefone inválido'],
  ];

  for (const [payload, label] of invalidos) {
    test(`recusa ${label}`, async () => {
      const res = await request('POST', '/api/agendamentos', { body: payload });
      assert.equal(res.status, 400);
    });
  }

  test('cliente não consegue forjar status confirmado', async () => {
    const res = await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-26', hora: '17:00', confirmado: true },
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).confirmado, false);
  });

  test('cliente não consegue forjar um id específico', async () => {
    const res = await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-27', hora: '18:00', id: 1 },
    });
    assert.equal(res.status, 201);
    assert.notEqual((await res.json()).id, 1);
  });

  test('mensagem longa é truncada em vez de virar vetor de abuso', async () => {
    const res = await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-28', hora: '08:00', mensagem: 'a'.repeat(5000) },
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).mensagem.length, 1000);
  });

  test('horário duplicado retorna 409', async () => {
    const payload = { ...BOOKING_PAYLOAD, data: '2026-12-29', hora: '09:00' };
    const primeira = await request('POST', '/api/agendamentos', { body: payload });
    assert.equal(primeira.status, 201);
    const segunda = await request('POST', '/api/agendamentos', { body: payload });
    assert.equal(segunda.status, 409);
  });

  test('JSON malformado retorna 400 sem vazar detalhes', async () => {
    const res = await fetch(`${baseUrl}/api/agendamentos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nome: ',
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'JSON inválido' });
  });

  test('payload grande é recusado', async () => {
    const res = await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, mensagem: 'a'.repeat(200000) },
    });
    assert.equal(res.status, 413);
  });

  test('rota de escrita exige application/json', async () => {
    const res = await fetch(`${baseUrl}/api/agendamentos`, {
      method: 'POST',
      body: 'nome=x',
    });
    assert.equal(res.status, 415);
  });
});

describe('proteção contra CSRF e cabeçalhos', () => {
  test('origem externa é bloqueada em escrita', async () => {
    const res = await request('POST', '/api/agendamentos', {
      body: BOOKING_PAYLOAD,
      headers: { origin: 'https://attacker.example' },
    });
    assert.equal(res.status, 403);
  });

  test('mesma origem é aceita', async () => {
    const res = await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-30', hora: '10:30' },
      headers: { origin: baseUrl },
    });
    assert.equal(res.status, 201);
  });

  test('cabeçalhos de segurança presentes', async () => {
    const res = await request('GET', '/index.html');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  });

  test('respostas da API não são armazenadas em cache', async () => {
    const res = await request('GET', '/api/ocupados');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

describe('privacidade dos dados', () => {
  test('a lista de slots ocupados não revela quem agendou', async () => {
    await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-12-31', hora: '11:30' },
    });
    const res = await request('GET', '/api/ocupados');
    const slots = await res.json();
    assert.ok(slots.includes('2026-12-31T11:30'));
    const texto = JSON.stringify(slots);
    assert.ok(!texto.includes('Paciente de Teste'));
    assert.ok(!texto.includes('paciente@example.com'));
    assert.ok(!texto.includes('31999999999'));
  });

  test('o arquivo de dados guarda apenas o hash do token', async () => {
    const criado = await (await request('POST', '/api/agendamentos', {
      body: { ...BOOKING_PAYLOAD, data: '2026-11-15', hora: '12:30' },
    })).json();
    const conteudo = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    const registro = conteudo.find((ag) => ag.id === criado.id);
    assert.ok(registro);
    assert.equal(registro.accessToken, undefined);
    assert.equal(typeof registro.accessTokenHash, 'string');
    assert.equal(registro.accessTokenHash.length, 64);
    assert.ok(!conteudo.some((ag) => JSON.stringify(ag).includes(criado.accessToken)));
  });
});
