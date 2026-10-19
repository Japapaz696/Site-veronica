'use strict';

/**
 * Migra os agendamentos de um arquivo JSON para o Postgres.
 *
 * Uso:
 *   node scripts/migrar-para-postgres.js data/agendamentos.json
 *
 * A configuracao vem do `.env` local (ignorado pelo git) ou da variavel de
 * ambiente DATABASE_URL. O valor nunca e impresso.
 *
 * Regras:
 * - não apaga o arquivo de origem;
 * - não sobrescreve registros que já existam no banco (mesmo id);
 * - mostra apenas a contagem, nunca dados pessoais.
 */

require('../lib/env').carregarEnv();

const fs = require('fs');
const { Pool } = require('pg');
const { criarRepositorioPostgres } = require('../lib/repository');

async function principal() {
  const caminho = process.argv[2] || 'data/agendamentos.json';
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL não definida.');
    process.exit(1);
  }
  if (!fs.existsSync(caminho)) {
    console.error(`Arquivo não encontrado: ${caminho}`);
    process.exit(1);
  }

  const conteudo = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  const agendamentos = Array.isArray(conteudo) ? conteudo : [conteudo];
  console.log(`Arquivo: ${caminho}`);
  console.log(`Registros a migrar: ${agendamentos.length}`);

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
    console.log(`Já existiam (ignorados): ${ignorados}`);
    console.log(`Total no banco agora: ${total}`);
    console.log('O arquivo de origem NÃO foi alterado.');
  } finally {
    await pool.end();
  }
}

principal().catch((erro) => {
  console.error('Falha na migração:', erro.message);
  process.exit(1);
});
