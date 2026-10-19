'use strict';

/**
 * Backup dos agendamentos do Postgres para um arquivo JSON privado.
 *
 * Complementa o backup do banco (que o provedor faz) com um dump legivel e
 * portavel, para guarda fora da plataforma.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/backup-postgres.js caminho/do/backup.json
 *
 * O arquivo gerado contem dados pessoais: guarde-o fora de qualquer repositorio
 * git e fora de pasta sincronizada.
 *
 * O script nunca imprime o conteudo. Mostra apenas contagens e hashes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

async function principal() {
  const saida = process.argv[2];
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL nao definida.');
    process.exit(1);
  }
  if (!saida) {
    console.error('Informe o caminho do arquivo de backup.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
    max: 2,
  });

  try {
    const { rows } = await pool.query(`
      SELECT id, nome, email, telefone, tipo,
             to_char(data, 'YYYY-MM-DD') AS data,
             hora, mensagem, confirmado,
             to_char(criado_em, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS criado_em,
             token_hash
      FROM agendamentos
      ORDER BY criado_em ASC, id ASC
    `);

    const agendamentos = rows.map((r) => ({
      id: Number(r.id),
      nome: r.nome,
      email: r.email,
      telefone: r.telefone,
      tipo: r.tipo,
      data: r.data,
      hora: r.hora,
      mensagem: r.mensagem,
      confirmado: r.confirmado,
      criadoEm: r.criado_em,
      ...(r.token_hash ? { accessTokenHash: r.token_hash } : {}),
    }));

    const conteudo = JSON.stringify(agendamentos, null, 2);
    fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
    fs.writeFileSync(saida, conteudo, { encoding: 'utf8', mode: 0o600 });

    const hash = crypto.createHash('sha256').update(conteudo, 'utf8').digest('hex');

    console.log(`Registros copiados: ${agendamentos.length}`);
    console.log(`Arquivo: ${saida}`);
    console.log(`Bytes: ${Buffer.byteLength(conteudo, 'utf8')}`);
    console.log(`SHA-256: ${hash}`);
    console.log('');
    console.log('Guarde este arquivo fora de repositorios git e de pastas sincronizadas.');
    console.log('Para restaurar: node scripts/restaurar-postgres.js <arquivo>');
  } finally {
    await pool.end();
  }
}

principal().catch((erro) => {
  console.error('Falha no backup:', erro.message);
  process.exit(1);
});
