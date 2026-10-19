// Testes do cliente da API do navegador (`public/api.js`).
// Executa com: node --test tests/api.test.js
//
// O que importa aqui: a mensagem do servidor chega intacta ate a interface
// (o paciente precisa ler "horario ja ocupado", nao "erro 409"), o token do
// paciente vai no cabecalho certo e uma falha de rede nao vira "erro 500".

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { apiRequest, apiGet, apiPost, apiPut, apiDelete } = require(
  path.join(__dirname, '..', 'public', 'api.js'),
);

function mockFetch(resposta) {
  const spy = async () => ({
    ok: resposta.status >= 200 && resposta.status < 300,
    status: resposta.status,
    json: async () => {
      if (resposta.textoInvalido) throw new SyntaxError('json invalido');
      return resposta.corpo;
    },
  });
  globalThis.fetch = spy;
  return spy;
}

test.afterEach(() => {
  delete globalThis.fetch;
});

test('apiGet devolve o corpo da resposta', async () => {
  mockFetch({ status: 200, corpo: { categorias: [] } });

  const resultado = await apiGet('/api/categorias');

  assert.deepEqual(resultado, { categorias: [] });
});

test('apiGet preserva a mensagem do servidor', async () => {
  // Antes, o apiGet devolvia "API error: 409" e o agendamento mostrava um
  // erro generico no lugar de "horario ja ocupado".
  mockFetch({ status: 409, corpo: { error: 'Horário já ocupado' } });

  await assert.rejects(apiGet('/api/agendamentos'), (erro) => {
    assert.equal(erro.message, 'Horário já ocupado');
    assert.equal(erro.status, 409);
    return true;
  });
});

test('apiPost envia o corpo como JSON', async () => {
  let recebido;
  globalThis.fetch = async (url, opcoes) => {
    recebido = { url, opcoes };
    return { ok: true, status: 201, json: async () => ({ id: 1 }) };
  };

  await apiPost('/api/agendamentos', { nome: 'Teste' });

  assert.equal(recebido.url, '/api/agendamentos');
  assert.equal(recebido.opcoes.method, 'POST');
  assert.equal(recebido.opcoes.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(recebido.opcoes.body), { nome: 'Teste' });
});

test('apiGet nao envia Content-Type nem corpo', async () => {
  let recebido;
  globalThis.fetch = async (url, opcoes) => {
    recebido = { url, opcoes };
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await apiGet('/api/ocupados');

  assert.equal(recebido.opcoes.method, 'GET');
  assert.equal(recebido.opcoes.headers['Content-Type'], undefined);
  assert.equal(recebido.opcoes.body, undefined);
});

test('apiDelete envia o token do paciente no cabecalho', async () => {
  let recebido;
  globalThis.fetch = async (url, opcoes) => {
    recebido = { url, opcoes };
    return { ok: true, status: 204, json: async () => null };
  };

  await apiDelete('/api/agendamentos/123', 'token-opaco');

  assert.equal(recebido.opcoes.method, 'DELETE');
  assert.equal(recebido.opcoes.headers.Authorization, 'Bearer token-opaco');
  assert.equal(recebido.opcoes.headers['Content-Type'], undefined);
});

test('apiDelete sem token nao envia o cabecalho Authorization', async () => {
  let recebido;
  globalThis.fetch = async (url, opcoes) => {
    recebido = { url, opcoes };
    return { ok: true, status: 204, json: async () => null };
  };

  await apiDelete('/api/agendamentos/123');

  assert.equal(recebido.opcoes.headers.Authorization, undefined);
});

test('uma resposta 204 devolve undefined', async () => {
  mockFetch({ status: 204, corpo: null });

  assert.equal(await apiDelete('/api/agendamentos/1', 'token'), undefined);
});

test('uma resposta sem JSON usa a mensagem padrao com o status', async () => {
  mockFetch({ status: 500, textoInvalido: true });

  await assert.rejects(apiGet('/api/x'), (erro) => {
    assert.equal(erro.status, 500);
    assert.match(erro.message, /500/);
    return true;
  });
});

test('uma falha de rede vira status 0, com mensagem de conexao', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  await assert.rejects(apiGet('/api/x'), (erro) => {
    assert.equal(erro.status, 0);
    assert.match(erro.message, /conexão/i);
    return true;
  });
});

test('todas as chamadas enviam as credenciais da mesma origem', async () => {
  let recebido;
  globalThis.fetch = async (url, opcoes) => {
    recebido = opcoes;
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await apiGet('/api/x');
  assert.equal(recebido.credentials, 'same-origin');

  await apiPost('/api/x', { a: 1 });
  assert.equal(recebido.credentials, 'same-origin');

  await apiPut('/api/x', { a: 1 });
  assert.equal(recebido.credentials, 'same-origin');

  await apiDelete('/api/x', 'token');
  assert.equal(recebido.credentials, 'same-origin');
});

test('apiRequest aceita metodo e token direto', async () => {
  let recebido;
  globalThis.fetch = async (url, opcoes) => {
    recebido = opcoes;
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await apiRequest('/api/x', { method: 'PATCH', data: { b: 2 }, token: 'abc' });

  assert.equal(recebido.method, 'PATCH');
  assert.equal(recebido.headers.Authorization, 'Bearer abc');
  assert.equal(recebido.headers['Content-Type'], 'application/json');
});
