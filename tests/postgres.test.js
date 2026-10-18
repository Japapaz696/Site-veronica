'use strict';

/**
 * Testes do backend Postgres contra um servidor real.
 *
 * Rodam apenas quando TEST_DATABASE_URL está definida; caso contrário, são
 * ignorados, para que a suíte continue funcionando sem banco.
 *
 *   TEST_DATABASE_URL=postgres://user@host:port/db node --test tests/postgres.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const URL_TESTE = process.env.TEST_DATABASE_URL;
const temBanco = Boolean(URL_TESTE);

test('Postgres: persistência dos agendamentos', { skip: !temBanco && 'defina TEST_DATABASE_URL' }, async (t) => {
  const { Pool } = require('pg');
  const { criarRepositorioPostgres } = require('../lib/repository');

  // A suíte usa um schema próprio para nunca tocar em dados reais que
  // eventualmente existam no banco de teste.
  const SCHEMA = 'teste_repositorio';
  const pool = new Pool({ connectionString: URL_TESTE, ssl: false, max: 4 });
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await pool.query(`SET search_path TO ${SCHEMA}`);
  const poolNoSchema = new Pool({
    connectionString: URL_TESTE,
    ssl: false,
    max: 4,
    options: `-c search_path=${SCHEMA}`,
  });
  const repositorio = criarRepositorioPostgres({ pool: poolNoSchema });

  t.after(async () => {
    await poolNoSchema.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await poolNoSchema.end();
    await pool.end();
  });

  await repositorio.garantirEsquema();

  const base = {
    nome: 'Fulana de Teste',
    email: 'teste@exemplo.invalid',
    telefone: '(31) 90000-0000',
    tipo: 'online',
    data: '2026-11-10',
    hora: '14:30',
    mensagem: 'mensagem de teste',
    confirmado: false,
    criadoEm: new Date().toISOString(),
    accessTokenHash: crypto.createHash('sha256').update('token-de-teste').digest('hex'),
  };

  await t.test('garantirEsquema é idempotente', async () => {
    await repositorio.garantirEsquema();
    await repositorio.garantirEsquema();
    const { rows } = await poolNoSchema.query("SELECT to_regclass('agendamentos') AS tabela");
    assert.equal(rows[0].tabela, 'agendamentos');
  });

  await t.test('insert devolve o registro com os campos do formato JSON', async () => {
    const salvo = await repositorio.insert({ id: 1001, ...base });
    assert.equal(salvo.id, 1001);
    assert.equal(salvo.nome, base.nome);
    assert.equal(salvo.data, '2026-11-10');
    assert.equal(salvo.hora, '14:30');
    assert.equal(salvo.confirmado, false);
    assert.equal(salvo.accessTokenHash, base.accessTokenHash);
    // criadoEm volta como string ISO, não como Date
    assert.equal(typeof salvo.criadoEm, 'string');
    assert.match(salvo.criadoEm, /^\d{4}-\d{2}-\d{2}T/);
  });

  await t.test('insert com id repetido não sobrescreve e devolve null', async () => {
    const outro = await repositorio.insert({ id: 1001, ...base, nome: 'Outra Pessoa' });
    assert.equal(outro, null);
    const atual = await repositorio.findById(1001);
    assert.equal(atual.nome, base.nome);
  });

  await t.test('findById devolve null quando não existe', async () => {
    assert.equal(await repositorio.findById(999999), null);
  });

  await t.test('readAll ordena por criadoEm', async () => {
    await repositorio.insert({ id: 1002, ...base, criadoEm: new Date(Date.now() + 1000).toISOString() });
    const todos = await repositorio.readAll();
    assert.equal(todos.length, 2);
    assert.deepEqual(todos.map((a) => a.id), [1001, 1002]);
  });

  await t.test('update altera o registro e devolve o resultado', async () => {
    const alterado = await repositorio.update(1002, { confirmado: true, hora: '15:00' });
    assert.equal(alterado.confirmado, true);
    assert.equal(alterado.hora, '15:00');
    assert.equal(alterado.id, 1002);
  });

  await t.test('update de id inexistente devolve null', async () => {
    assert.equal(await repositorio.update(999999, { hora: '10:00' }), null);
  });

  await t.test('remove devolve true e depois false', async () => {
    assert.equal(await repositorio.remove(1002), true);
    assert.equal(await repositorio.remove(1002), false);
    assert.equal(await repositorio.readAll().then((r) => r.length), 1);
  });

  await t.test('a data é preservada como YYYY-MM-DD, sem deslocamento de fuso', async () => {
    // O tipo DATE do Postgres voltaria como Date UTC se não fosse formatado.
    await repositorio.insert({ id: 1003, ...base, data: '2026-01-01' });
    const registro = await repositorio.findById(1003);
    assert.equal(registro.data, '2026-01-01');
  });

  await t.test('o servidor completo funciona sobre Postgres', async () => {
    const { createApp } = require('../server');
    const app = createApp({
      isProduction: false,
      sessionSecret: 'segredo-de-teste-com-mais-de-32-caracteres-!!',
      adminPassword: 'senha-de-teste',
      pool: poolNoSchema,
      repositorio,
    });

    const servidor = app.listen(0);
    const porta = servidor.address().port;
    const baseUrl = `http://127.0.0.1:${porta}`;
    t.after(() => servidor.close());

    // Cria um agendamento pela API pública
    const criado = await fetch(`${baseUrl}/api/agendamentos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Cliente Postgres',
        email: 'cliente@exemplo.invalid',
        telefone: '(31) 91111-2222',
        tipo: 'presencial',
        data: '2026-12-05',
        hora: '09:00',
        mensagem: 'via Postgres',
      }),
    });
    assert.equal(criado.status, 201);
    const corpo = await criado.json();
    assert.ok(corpo.id);
    assert.ok(corpo.accessToken);

    // O horário passa a constar como ocupado
    const ocupados = await (await fetch(`${baseUrl}/api/ocupados`)).json();
    assert.ok(ocupados.includes('2026-12-05T09:00'));

    // O mesmo horário é recusado
    const repetido = await fetch(`${baseUrl}/api/agendamentos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Outro Cliente',
        tipo: 'online',
        data: '2026-12-05',
        hora: '09:00',
      }),
    });
    assert.equal(repetido.status, 409);

    // A listagem administrativa exige sessão
    const semSessao = await fetch(`${baseUrl}/api/agendamentos`);
    assert.equal(semSessao.status, 401);

    // Com login, o registro aparece
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ senha: 'senha-de-teste' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0].split(';')[0];

    const comSessao = await fetch(`${baseUrl}/api/agendamentos`, { headers: { cookie } });
    assert.equal(comSessao.status, 200);
    const lista = await comSessao.json();
    assert.ok(lista.some((a) => a.id === corpo.id));

    // O dono consulta pelo token
    const meus = await fetch(`${baseUrl}/api/agendamentos/meus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: [{ id: corpo.id, token: corpo.accessToken }] }),
    });
    assert.equal(meus.status, 200);
    assert.equal((await meus.json()).length, 1);

    // Token errado não devolve nada
    const errado = await fetch(`${baseUrl}/api/agendamentos/meus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: [{ id: corpo.id, token: 'token-errado' }] }),
    });
    assert.equal((await errado.json()).length, 0);

    // Cancelamento com o token correto
    const cancelar = await fetch(`${baseUrl}/api/agendamentos/${corpo.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${corpo.accessToken}` },
    });
    assert.equal(cancelar.status, 204);

    // E não há mais nada
    const vazio = await fetch(`${baseUrl}/api/agendamentos/meus`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentials: [{ id: corpo.id, token: corpo.accessToken }] }),
    });
    assert.equal((await vazio.json()).length, 0);
  });
});
