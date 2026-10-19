'use strict';

/**
 * Restaura agendamentos de um arquivo JSON de backup para o Postgres.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/restaurar-postgres.js backup.json
 *
 * Regras:
 * - nao apaga o que ja existe no banco;
 * - nao sobrescreve registros com o mesmo id;
 * - mostra apenas contagens, nunca dados pessoais.
 */

const fs = require('fs');
const { Pool } = require('pg');
const { criarRepositorioPostgres } = require('../lib/repository');

async function principal() {
  const caminho = process.argv[2];
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL nao definida.');
    process.exit(1);
  }
  if (!caminho || !fs.existsSync(caminho)) {
    console.error(`Arquivo nao encontrado: ${caminho}`);
    process.exit(1);
  }

  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  const agendamentos = Array.isArray(conteudo) ? conteudo : [conteudo];
  console.log(`Arquivo: ${caminho}`);
  console.log(`Registros no arquivo: ${agendamentos.length}`);

  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
    max: 4,
  });

  try {
    const repositorio = criarRepositorioPostgres({ pool });
    await repositorio.garantirEsquema();

    let inseridos = 0;
    let ignorados = 0;

    for (const agendamento of agendamentos) {
      const existente = await repositorio.findById(agendamento.id);
      if (existente) {
        ignorados += 1;
        continue;
      }
      const salvo = await repositorio.insert(agendamento);
      if (salvo) inseridos += 1;
    }

    const total = (await repositorio.readAll()).length;
    console.log(`Inseridos: ${inseridos}`);
    console.log(`Ja existiam (ignorados): ${ignorados}`);
    console.log(`Total no banco agora: ${total}`);
  } finally {
    await pool.end();
  }
}

principal().catch((erro) => {
  console.error('Falha na restauracao:', erro.message);
  process.exit(1);
});
