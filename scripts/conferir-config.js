#!/usr/bin/env node
'use strict';

/**
 * Confere a configuracao local sem revelar nenhum valor.
 *
 *   node scripts/conferir-config.js
 *
 * Mostra apenas o que esta definido e de onde vem. Nao imprime a
 * connection string, a senha nem o segredo de sessao.
 */

require('../lib/env').carregarEnv();

const { statusConfig, descreverOrigem } = require('../lib/env');
const fs = require('fs');
const path = require('path');

function linha(nome, valor, detalhe = '') {
  console.log(`  ${valor ? 'OK   ' : 'FALTA'} ${nome.padEnd(22)} ${detalhe}`);
}

console.log('=== Configuracao local do Site-veronica ===\n');

const status = statusConfig();
console.log(`  Arquivo: ${status.caminho}`);
console.log(`  Existe: ${status.arquivoExiste ? 'sim' : 'nao'}`);
console.log(`  Versionado: ${(() => {
  try {
    const { execFileSync } = require('node:child_process');
    const raiz = path.resolve(__dirname, '..');
    const listados = execFileSync('git', ['ls-files', '.env'], { cwd: raiz, encoding: 'utf8' }).trim();
    return listados ? 'SIM — PROBLEMA' : 'nao (correto)';
  } catch {
    return 'verificacao indisponivel';
  }
})()}\n`);

console.log('  Variaveis:');
linha('DATABASE_URL', Boolean(process.env.DATABASE_URL), descreverOrigem('DATABASE_URL'));
linha('SESSION_SECRET', Boolean(process.env.SESSION_SECRET), descreverOrigem('SESSION_SECRET'));
linha('ADMIN_PASSWORD_HASH', Boolean(process.env.ADMIN_PASSWORD_HASH), descreverOrigem('ADMIN_PASSWORD_HASH'));

if (process.env.DATABASE_URL) {
  // Confere o formato sem mostrar o valor.
  let formatoOk = false;
  let temSsl = false;
  let host = '';
  try {
    const url = new URL(process.env.DATABASE_URL);
    formatoOk = url.protocol.startsWith('postgres') && Boolean(url.hostname);
    temSsl = /sslmode=require/.test(process.env.DATABASE_URL);
    host = url.hostname;
  } catch { }
  console.log('\n  Connection string:');
  linha('formato postgres://', formatoOk, formatoOk ? 'ok' : 'formato invalido');
  linha('sslmode=require', temSsl, temSsl ? 'ok' : 'recomendado pelo Neon');
  linha('host', Boolean(host), host ? `${host.slice(0, 4)}***` : '');
  console.log('  (o restante da string nunca e mostrado)');
}

if (process.env.SESSION_SECRET) {
  console.log('\n  SESSION_SECRET:');
  linha('minimo 32 caracteres', process.env.SESSION_SECRET.length >= 32, `${process.env.SESSION_SECRET.length} caracteres`);
}

console.log('\n  Proximo passo:');
if (!process.env.DATABASE_URL) {
  console.log('    1. Pegue a connection string no painel do Neon (projeto "veronica")');
  console.log('    2. Cole no arquivo .env local, na linha DATABASE_URL=');
  console.log('    3. Rode: node scripts/preparar-producao.js');
} else {
  console.log('    Rode: node scripts/preparar-producao.js');
}
