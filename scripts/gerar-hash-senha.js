#!/usr/bin/env node
// Gera o hash scrypt da senha administrativa, para uso em ADMIN_PASSWORD_HASH.
// Uso: node scripts/gerar-hash-senha.js
// O valor digitado não aparece na tela nem é gravado em arquivo.

const readline = require('readline');
const { hashPassword } = require('../lib/passwords');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let value = '';
    const onData = (char) => {
      const text = char.toString('utf8');
      if (text === '\r' || text === '\n') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw || false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (text === '\u0003') {
        process.stdout.write('\n');
        process.exit(130);
      } else if (text === '\u007f' || text === '\b') {
        value = value.slice(0, -1);
      } else {
        value += text;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const senha = await askHidden('Senha administrativa: ');
  if (senha.length < 12) {
    console.error('Use pelo menos 12 caracteres.');
    process.exit(1);
  }
  const confirmacao = await askHidden('Confirme a senha: ');
  rl.close();
  if (senha !== confirmacao) {
    console.error('As senhas não coincidem.');
    process.exit(1);
  }
  console.log('\nADMIN_PASSWORD_HASH=' + hashPassword(senha));
  console.log('\nGuarde este valor apenas nas variáveis de ambiente do deploy.');
})();
