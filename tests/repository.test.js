const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('conteúdo do repositório', () => {
  test('as páginas que usam a API carregam o script da API antes dos outros', () => {
    // As funções de API vivem em public/api.js. Estas três páginas alcançam
    // a API: duas por script inline, uma pelo agendamento.js. Se api.js for
    // carregado depois (ou não for carregado), a chamada quebra em execução.
    const paginas = ['public/agendamento.html', 'public/admin.html', 'public/meus-agendamentos.html'];
    for (const pagina of paginas) {
      const conteudo = read(pagina);

      const posApi = conteudo.indexOf('src="api.js"');
      assert.ok(posApi !== -1, `${pagina} não carrega api.js`);

      for (const outro of ['src="script.js"', 'src="agendamento.js"']) {
        const pos = conteudo.indexOf(outro);
        if (pos !== -1) {
          assert.ok(posApi < pos, `${pagina} carrega api.js depois de ${outro}`);
        }
      }
    }
  });

  test('o agendamento.js usa as funções de API que o api.js define', () => {
    // Guarda o par: o script usa apiGet/apiPost e o api.js define.
    const definicoes = read('public/api.js');
    for (const nome of ['apiGet', 'apiPost', 'apiPut', 'apiDelete']) {
      assert.ok(definicoes.includes(`function ${nome}`), `api.js não define ${nome}`);
    }
    const uso = read('public/agendamento.js');
    assert.ok(/\bapi(Get|Post)\s*\(/.test(uso), 'agendamento.js não usa a API');
  });

  test('nenhum arquivo público guarda a senha administrativa', () => {
    const arquivos = ['public/script.js', 'public/admin.html', 'public/agendamento.js', 'public/meus-agendamentos.html'];
    for (const arquivo of arquivos) {
      const conteudo = read(arquivo);
      assert.ok(!conteudo.includes('x-admin-password'), `${arquivo} ainda usa o header antigo`);
      assert.ok(!conteudo.includes("sessionStorage.setItem('admin_password'"), `${arquivo} ainda guarda a senha`);
      assert.ok(!conteudo.includes("sessionStorage.getItem('admin_password')"), `${arquivo} ainda lê a senha`);
      assert.ok(!conteudo.includes("sessionStorage.setItem('admin_logged'"), `${arquivo} ainda simula login`);
    }
  });

  test('nenhum arquivo público guarda dados pessoais de agendamento', () => {
    const arquivos = ['public/script.js', 'public/agendamento.js', 'public/meus-agendamentos.html', 'public/admin.html'];
    for (const arquivo of arquivos) {
      const conteudo = read(arquivo);
      assert.ok(!conteudo.includes("localStorage.setItem('agendamentos'"), `${arquivo} ainda grava agendamentos`);
      assert.ok(!conteudo.includes("localStorage.getItem('agendamentos')"), `${arquivo} ainda lê agendamentos locais`);
      assert.ok(!conteudo.includes("localStorage.setItem('meus_agendamento_ids'"), `${arquivo} ainda grava ids (enumeráveis)`);
    }
  });

  test('o servidor não serve a raiz do projeto', () => {
    const servidor = read('server.js');
    assert.ok(!/express\.static\(path\.join\(__dirname\)\)/.test(servidor));
    assert.ok(servidor.includes('express.static(publicDir'));
  });

  test('o endpoint público de enumeração de ids foi removido do servidor', () => {
    const servidor = read('server.js');
    assert.ok(!servidor.includes('/api/agendamentos/por-ids'));
  });

  test('a senha não é comparada em texto puro por padrão', () => {
    const servidor = read('server.js');
    assert.ok(servidor.includes('verifyScryptPassword'));
    assert.ok(servidor.includes('timingSafeEqual'));
  });

  test('produção exige SESSION_SECRET', () => {
    const servidor = read('server.js');
    assert.ok(servidor.includes('SESSION_SECRET é obrigatório quando NODE_ENV=production'));
  });

  test('login tem limitação de tentativas', () => {
    const servidor = read('server.js');
    assert.ok(servidor.includes('MAX_LOGIN_ATTEMPTS'));
    assert.ok(servidor.includes('429'));
  });

  test('o token de acesso não é devolvido nas listagens', () => {
    const servidor = read('server.js');
    assert.ok(servidor.includes('temCredencial'));
    assert.ok(!/res\.json\(agendamentos\)/.test(servidor));
  });

  test('o .env e o arquivo de dados estão ignorados pelo git', () => {
    const ignore = read('.gitignore');
    assert.ok(ignore.includes('.env'));
    assert.ok(ignore.includes('data/*.json'));
  });

  test('o arquivo de dados real não é versionado; apenas o exemplo', () => {
    const { execFileSync } = require('node:child_process');
    const versionados = execFileSync('git', ['ls-files', 'data/'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    assert.ok(!versionados.includes('data/agendamentos.json'), 'data/agendamentos.json não pode estar versionado');
    assert.deepEqual(versionados, ['data/agendamentos.example.json']);
  });

  test('o exemplo de ambiente não contém valor real', () => {
    const exemplo = read('.env.example');
    for (const linha of exemplo.split(/\r?\n/)) {
      if (/^(ADMIN_PASSWORD|ADMIN_PASSWORD_HASH|SESSION_SECRET)=/.test(linha)) {
        assert.equal(linha.split('=')[1], '', `valor inesperado em: ${linha}`);
      }
    }
  });

  test('o render.yaml não carrega credenciais', () => {
    const render = read('render.yaml');
    assert.ok(!/value:\s*\S+/.test(render.replace(/value: production/, '')));
  });
});
