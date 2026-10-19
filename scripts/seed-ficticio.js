'use strict';

/**
 * Popula o banco com agendamentos ficticios, para desenvolvimento e teste.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/seed-ficticio.js
 *
 * Nao aceita nenhum dado real: todos os nomes, e-mails, telefones e mensagens
 * sao inventados e claramente marcados como ficcao. O script recusa rodar se
 * a variavel ALLOW_SEED_FICTITIO nao estiver definida como "sim", para que
 * ninguem confunda o seed com uma migracao de verdade.
 */

const crypto = require('crypto');
const { Pool } = require('pg');
const { criarRepositorioPostgres } = require('../lib/repository');

const NOMES = [
  'Maria Ficticia de Teste',
  'Joao Ficticio de Teste',
  'Ana Ficticia de Teste',
  'Carlos Ficticio de Teste',
];

const TIPOS = ['online', 'presencial'];

function idFicticio(indice) {
  // Mesma faixa de tamanho do id real, para exercitar o mesmo caminho de codigo.
  return Number(`${Date.now()}${String(1000 + indice).padStart(4, '0')}`.slice(-15));
}

async function principal() {
  if (process.env.ALLOW_SEED_FICTITIO !== 'sim') {
    console.error('Defina ALLOW_SEED_FICTITIO=sim para confirmar que e um seed de ficticios.');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL nao definida.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: /[?&]sslmode=disable/.test(url) ? false : { rejectUnauthorized: false },
    max: 4,
  });

  try {
    const repositorio = criarRepositorioPostgres({ pool });
    await repositorio.garantirEsquema();

    // O seed e repetivel: remove apenas os registros ficticios de execucoes
    // anteriores (dominio .invalid) e nunca toca em qualquer outro registro.
    const { rows: antigos } = await pool.query(
      "DELETE FROM agendamentos WHERE email LIKE '%@exemplo.invalid' RETURNING id"
    );
    if (antigos.length) {
      console.log(`Ficticios de execucoes anteriores removidos: ${antigos.length}`);
    }

    const existentes = await repositorio.readAll();
    console.log(`Registros antes do seed: ${existentes.length}`);

    const quantos = Number(process.env.SEED_QUANTIDADE ?? 5);
    let inseridos = 0;

    for (let indice = 0; indice < quantos; indice += 1) {
      const nome = NOMES[indice % NOMES.length];
      const dia = String(10 + indice).padStart(2, '0');
      const agendamento = {
        id: idFicticio(indice),
        nome: `${nome} ${indice + 1}`,
        email: `ficticio${indice + 1}@exemplo.invalid`,
        telefone: `(31) 9000${String(1000 + indice).slice(-4)}`,
        tipo: TIPOS[indice % TIPOS.length],
        data: `2026-12-${dia}`,
        hora: `${String(9 + (indice % 8)).padStart(2, '0')}:00`,
        mensagem: 'Agendamento ficticio criado pelo seed de desenvolvimento.',
        confirmado: indice % 3 === 0,
        criadoEm: new Date(Date.now() + indice * 1000).toISOString(),
        accessTokenHash: crypto.createHash('sha256').update(`ficticio-${indice}`).digest('hex'),
      };
      const salvo = await repositorio.insert(agendamento);
      if (salvo) inseridos += 1;
    }

    const total = (await repositorio.readAll()).length;
    console.log(`Ficticios inseridos: ${inseridos}`);
    console.log(`Total no banco agora: ${total}`);
    console.log('');
    console.log('Todos os registros sao ficticios (dominio .invalid).');
    console.log('Nenhum dado real de paciente foi usado.');
  } finally {
    await pool.end();
  }
}

principal().catch((erro) => {
  console.error('Falha no seed:', erro.message);
  process.exit(1);
});
