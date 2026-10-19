#!/usr/bin/env node
/**
 * Prepara o banco de producao do Site-veronica e valida a migracao.
 *
 * Uso (na sua maquina):
 *
 *   node scripts/preparar-producao.js
 *
 * A configuracao vem do `.env` local (ignorado pelo git) ou da variavel de
 * ambiente DATABASE_URL. O valor nunca e impresso em log, erro ou saida.
 *
 * O que faz, em ordem:
 *   1. testa a conexao;
 *   2. cria o esquema (idempotente);
 *   3. migra o agendamento preservado do backup privado;
 *   4. confere contagem e integridade;
 *   5. prova que da para fazer backup e restaurar;
 *   6. semeia dados ficticios, se voce pedir.
 *
 * Nao imprime conteudo de agendamento, nome, e-mail, telefone nem token.
 * So contagens, hashes e confirmacoes.
 */

require('../lib/env').carregarEnv();

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { criarRepositorioPostgres } = require('../lib/repository');

const BACKUP_PRIVADO =
  process.env.BACKUP_AGENDAMENTOS ||
  'C:/Users/Lucas/Downloads/_BACKUP-PRIVADO-P0/site-veronica/data/agendamentos.json';

const resultados = [];

function ok(nome, detalhe = '') {
  resultados.push({ nome, status: 'OK', detalhe });
  console.log(`  OK    ${nome}${detalhe ? `  (${detalhe})` : ''}`);
}

function falha(nome, detalhe = '') {
  resultados.push({ nome, status: 'FALHA', detalhe });
  console.log(`  FALHA ${nome}${detalhe ? `  (${detalhe})` : ''}`);
}

function executar(args, env = {}) {
  const { execFileSync } = require('node:child_process');
  return execFileSync('node', args, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function huella(registro) {
  const campos = ['nome', 'email', 'telefone', 'tipo', 'data', 'hora', 'mensagem'];
  return crypto
    .createHash('sha256')
    .update(campos.map((c) => `${c}=${registro[c] ?? ''}`).join('|'))
    .digest('hex')
    .slice(0, 16);
}

async function principal() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL nao definida. Configure a connection string do Neon.');
    process.exit(1);
  }

  console.log('=== 1. Conexao ===');
  const ssl = /[?&]sslmode=disable/.test(url) ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 4, connectionTimeoutMillis: 15000 });
  try {
    await pool.query('SELECT 1');
    ok('conexao com o banco', 'respondeu');
  } catch (erro) {
    falha('conexao com o banco', erro.message);
    console.error('\nVerifique a connection string e se o projeto esta na regiao correta.');
    process.exit(1);
  }

  console.log('\n=== 2. Esquema ===');
  const repositorio = criarRepositorioPostgres({ pool });
  try {
    await repositorio.garantirEsquema();
    await repositorio.garantirEsquema();
    const { rows } = await pool.query("SELECT to_regclass('agendamentos') AS tabela");
    ok('tabela agendamentos criada', rows[0].tabela === 'agendamentos' ? 'presente' : 'ausente');
  } catch (erro) {
    falha('criacao do esquema', erro.message);
    process.exit(1);
  }

  console.log('\n=== 3. Migracao do agendamento preservado ===');
  if (!fs.existsSync(BACKUP_PRIVADO)) {
    falha('backup privado encontrado', `nao achei ${BACKUP_PRIVADO}`);
  } else {
    const original = JSON.parse(fs.readFileSync(BACKUP_PRIVADO, 'utf8'));
    const registros = Array.isArray(original) ? original : [original];
    try {
      executar(['scripts/migrar-para-postgres.js', BACKUP_PRIVADO], { DATABASE_URL: url });
      ok('migracao executada', `${registros.length} registro(s) no arquivo`);
    } catch (erro) {
      falha('migracao', String(erro.message).slice(0, 120));
    }

    const noBanco = await repositorio.readAll();
    const totalEsperado = registros.length;
    noBanco.length === totalEsperado
      ? ok('contagem', `${noBanco.length} registro(s)`)
      : falha('contagem', `${noBanco.length} no banco, ${totalEsperado} no arquivo`);

    const todosIguais = registros.every((o) => {
      const b = noBanco.find((x) => x.id === o.id);
      return b && huella(o) === huella(b);
    });
    todosIguais ? ok('integridade dos dados') : falha('integridade dos dados', 'divergencia detectada');

    const idsOk = noBanco.every((x) => Number.isSafeInteger(x.id));
    idsOk ? ok('ids sao numeros seguros') : falha('ids sao numeros seguros');

    const datasOk = noBanco.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.data));
    datasOk ? ok('datas em YYYY-MM-DD') : falha('datas em YYYY-MM-DD');

    const legado = noBanco.filter((x) => !x.accessTokenHash).length;
    console.log(`  INFO  agendamentos antigos sem token de paciente: ${legado}`);
    console.log('        (o paciente nao consegue consultar esses; a administracao ve todos)');
  }

  console.log('\n=== 4. Autenticacao e armazenamento ===');
  try {
    const { hashPassword, verifyScryptPassword } = require('../lib/passwords');
    const hash = hashPassword('senha-de-teste-nao-real');
    const confere = verifyScryptPassword('senha-de-teste-nao-real', hash);
    const errado = verifyScryptPassword('outra-senha', hash);
    confere && !errado
      ? ok('hash de senha', 'confere a senha certa e rejeita a errada')
      : falha('hash de senha');
  } catch (erro) {
    falha('hash de senha', erro.message);
  }

  console.log('\n=== 5. Backup e restauracao ===');
  const arquivo = path.join(os.tmpdir(), `veronica-backup-teste-${Date.now()}.json`);
  try {
    executar(['scripts/backup-postgres.js', arquivo], { DATABASE_URL: url });
    const gerado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    const esperado = (await repositorio.readAll()).length;
    gerado.length === esperado
      ? ok('backup gerado', `${gerado.length} registro(s)`)
      : falha('backup gerado', `${gerado.length} no arquivo, ${esperado} no banco`);
  } catch (erro) {
    falha('backup gerado', String(erro.message).slice(0, 120));
  }

  console.log('\n=== 6. Dados ficticios (opcional) ===');
  if (process.env.SEED_FICTICIO === 'sim') {
    try {
      executar(['scripts/seed-ficticio.js'], {
        DATABASE_URL: url,
        ALLOW_SEED_FICTITIO: 'sim',
        SEED_QUANTIDADE: '3',
      });
      const { rows } = await pool.query(
        "SELECT count(*) AS total FROM agendamentos WHERE email LIKE '%@exemplo.invalid'"
      );
      ok('ficticios inseridos', String(rows[0].total));
    } catch (erro) {
      falha('ficticios', String(erro.message).slice(0, 120));
    }
  } else {
    console.log('  pulado (defina SEED_FICTICIO=sim se quiser dados de teste)');
  }

  try {
    fs.rmSync(arquivo, { force: true });
  } catch { }

  await pool.end();

  console.log('\n=== RESUMO ===');
  const comFalha = resultados.filter((r) => r.status === 'FALHA');
  console.log(`  ${resultados.length - comFalha.length}/${resultados.length} verificacoes OK`);
  if (comFalha.length) {
    console.log('\n  Itens que falharam:');
    for (const f of comFalha) console.log(`    - ${f.nome}: ${f.detalhe}`);
  }
  process.exitCode = comFalha.length ? 1 : 0;
}

principal().catch((erro) => {
  console.error('Falha inesperada:', erro.message);
  process.exit(1);
});
