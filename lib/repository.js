'use strict';

/**
 * Camada de persistência dos agendamentos.
 *
 * Dois backends, escolhidos por configuração:
 * - Postgres, quando DATABASE_URL existe (produção);
 * - arquivo JSON, caso contrário (desenvolvimento e testes).
 *
 * A interface exposta é a mesma nos dois casos:
 *   readAll()                 -> Promise<Agendamento[]>
 *   findById(id)              -> Promise<Agendamento | null>
 *   insert(agendamento)       -> Promise<Agendamento>
 *   update(id, campos)        -> Promise<Agendamento | null>
 *   remove(id)                -> Promise<boolean>
 *
 * O formato do agendamento devolvido é idêntico ao do arquivo JSON histórico,
 * para que o restante do servidor e o front-end não percebam a troca.
 */

const CAMPO_PARA_COLUNA = {
  id: 'id',
  nome: 'nome',
  email: 'email',
  telefone: 'telefone',
  tipo: 'tipo',
  data: 'data',
  hora: 'hora',
  mensagem: 'mensagem',
  confirmado: 'confirmado',
  criadoEm: 'criado_em',
  accessTokenHash: 'token_hash',
};

// A coluna `data` é DATE. O driver pg a converte para Date à meia-noite local,
// o que desloca o dia conforme o fuso do servidor. Pedimos o texto já no
// formato ISO curto, para o campo continuar idêntico ao do arquivo JSON.
const COLUNA_DATA_COMO_TEXTO = "to_char(data, 'YYYY-MM-DD') AS data";

const COLUNA_PARA_CAMPO = Object.fromEntries(
  Object.entries(CAMPO_PARA_COLUNA).map(([campo, coluna]) => [coluna, campo])
);

function linhaParaAgendamento(linha) {
  if (!linha) return null;
  const agendamento = {};
  for (const [coluna, valor] of Object.entries(linha)) {
    const campo = COLUNA_PARA_CAMPO[coluna];
    if (!campo) continue;
    if (campo === 'id') {
      // BIGINT chega como texto pelo driver, para não perder precisão.
      // O id continua sendo um número seguro, como no formato JSON.
      agendamento.id = Number(valor);
    } else if (campo === 'criadoEm') {
      agendamento.criadoEm = valor instanceof Date ? valor.toISOString() : String(valor);
    } else {
      agendamento[campo] = valor;
    }
  }
  // A ordem das chaves acompanha o formato histórico do arquivo JSON.
  return ordenarCampos(agendamento);
}

function ordenarCampos(agendamento) {
  const ordem = ['id', 'nome', 'email', 'telefone', 'tipo', 'data', 'hora', 'mensagem', 'confirmado', 'criadoEm', 'accessTokenHash'];
  const resultado = {};
  for (const campo of ordem) {
    if (agendamento[campo] !== undefined) resultado[campo] = agendamento[campo];
  }
  for (const [campo, valor] of Object.entries(agendamento)) {
    if (resultado[campo] === undefined) resultado[campo] = valor;
  }
  return resultado;
}

// ---------------------------------------------------------------- JSON (local)

function criarRepositorioJson({ dataFile, fs }) {
  async function readAll() {
    try {
      const bruto = await fs.readFile(dataFile, 'utf8');
      const analisado = JSON.parse(bruto);
      return Array.isArray(analisado) ? analisado : [];
    } catch (erro) {
      if (erro.code === 'ENOENT') {
        await fs.mkdir(require('path').dirname(dataFile), { recursive: true, mode: 0o700 });
        await fs.writeFile(dataFile, '[]', { encoding: 'utf8', mode: 0o600 });
        return [];
      }
      throw erro;
    }
  }

  async function writeAll(agendamentos) {
    await fs.mkdir(require('path').dirname(dataFile), { recursive: true, mode: 0o700 });
    const temporario = `${dataFile}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(temporario, JSON.stringify(agendamentos, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporario, dataFile);
  }

  return {
    tipo: 'json',

    readAll,

    async findById(id) {
      const todos = await readAll();
      return todos.find((a) => String(a.id) === String(id)) || null;
    },

    async insert(agendamento) {
      const todos = await readAll();
      todos.push(ordenarCampos(agendamento));
      await writeAll(todos);
      return ordenarCampos(agendamento);
    },

    async update(id, campos) {
      const todos = await readAll();
      const indice = todos.findIndex((a) => String(a.id) === String(id));
      if (indice === -1) return null;
      todos[indice] = ordenarCampos({ ...todos[indice], ...campos });
      await writeAll(todos);
      return todos[indice];
    },

    async remove(id) {
      const todos = await readAll();
      const restantes = todos.filter((a) => String(a.id) !== String(id));
      if (restantes.length === todos.length) return false;
      await writeAll(restantes);
      return true;
    },

    // Somente para teste: substitui todo o conteúdo.
    async replaceAll(agendamentos) {
      await writeAll(agendamentos.map(ordenarCampos));
    },
  };
}

// ------------------------------------------------------------ Postgres (produção)

function criarRepositorioPostgres({ pool }) {
  const COLUNAS = Object.values(CAMPO_PARA_COLUNA);
  // Na leitura, `data` sai como texto; nas escritas, o valor continua indo como parâmetro.
  const COLUNAS_SELECT = COLUNAS.map((c) => (c === 'data' ? COLUNA_DATA_COMO_TEXTO : c));
  const COLUNAS_RETURNING = COLUNAS_SELECT.join(', ');

  async function garantirEsquema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agendamentos (
        id          BIGINT PRIMARY KEY,
        nome        TEXT        NOT NULL,
        email       TEXT        NOT NULL,
        telefone    TEXT        NOT NULL,
        tipo        TEXT        NOT NULL,
        data        DATE        NOT NULL,
        hora        TEXT        NOT NULL,
        mensagem    TEXT        NOT NULL DEFAULT '',
        confirmado  BOOLEAN     NOT NULL DEFAULT FALSE,
        criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        token_hash  TEXT
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS agendamentos_data_hora_idx ON agendamentos (data, hora)');
    await pool.query('CREATE INDEX IF NOT EXISTS agendamentos_token_hash_idx ON agendamentos (token_hash)');
  }

  function valoresDoAgendamento(agendamento) {
    return COLUNAS.map((coluna) => {
      const campo = COLUNA_PARA_CAMPO[coluna];
      const valor = agendamento[campo];
      if (campo === 'confirmado') return valor === true;
      if (campo === 'mensagem') return valor ?? '';
      if (campo === 'criadoEm') return valor ?? new Date().toISOString();
      if (campo === 'accessTokenHash') return valor ?? null;
      return valor;
    });
  }

  return {
    tipo: 'postgres',

    garantirEsquema,

    async readAll() {
      const { rows } = await pool.query(
        `SELECT ${COLUNAS_RETURNING} FROM agendamentos ORDER BY criado_em ASC, id ASC`
      );
      return rows.map(linhaParaAgendamento);
    },

    async findById(id) {
      const { rows } = await pool.query(
        `SELECT ${COLUNAS_RETURNING} FROM agendamentos WHERE id = $1`,
        [id]
      );
      return linhaParaAgendamento(rows[0]);
    },

    async insert(agendamento) {
      const marcadores = COLUNAS.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await pool.query(
        `INSERT INTO agendamentos (${COLUNAS.join(', ')}) VALUES (${marcadores})
         ON CONFLICT (id) DO NOTHING
         RETURNING ${COLUNAS_RETURNING}`,
        valoresDoAgendamento(agendamento)
      );
      // Conflito de id: outro pedido criou o mesmo registro.
      return rows[0] ? linhaParaAgendamento(rows[0]) : null;
    },

    async update(id, campos) {
      const entradas = Object.entries(campos).filter(([campo]) => CAMPO_PARA_COLUNA[campo]);
      if (!entradas.length) return this.findById(id);
      const atribuicoes = entradas.map(([campo], i) => `${CAMPO_PARA_COLUNA[campo]} = $${i + 1}`);
      const valores = entradas.map(([campo, valor]) => {
        if (campo === 'confirmado') return valor === true;
        return valor;
      });
      valores.push(id);
      const { rows } = await pool.query(
        `UPDATE agendamentos SET ${atribuicoes.join(', ')}
         WHERE id = $${valores.length}
         RETURNING ${COLUNAS_RETURNING}`,
        valores
      );
      return linhaParaAgendamento(rows[0]);
    },

    async remove(id) {
      const { rowCount } = await pool.query('DELETE FROM agendamentos WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async replaceAll(agendamentos) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query('DELETE FROM agendamentos');
        for (const agendamento of agendamentos) {
          const marcadores = COLUNAS.map((_, i) => `$${i + 1}`).join(', ');
          await cliente.query(
            `INSERT INTO agendamentos (${COLUNAS.join(', ')}) VALUES (${marcadores}) ON CONFLICT (id) DO NOTHING`,
            valoresDoAgendamento(ordenarCampos(agendamento))
          );
        }
        await cliente.query('COMMIT');
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw erro;
      } finally {
        cliente.release();
      }
    },
  };
}

// ------------------------------------------------------------------- fábrica

function criarRepositorio(opcoes = {}) {
  if (opcoes.pool) return criarRepositorioPostgres({ pool: opcoes.pool });
  if (opcoes.dataFile) return criarRepositorioJson({ dataFile: opcoes.dataFile, fs: opcoes.fs || require('fs').promises });
  throw new Error('criarRepositorio exige pool ou dataFile');
}

module.exports = {
  criarRepositorio,
  criarRepositorioJson,
  criarRepositorioPostgres,
  ordenarCampos,
  linhaParaAgendamento,
  CAMPO_PARA_COLUNA,
};
