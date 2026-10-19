'use strict';

/**
 * Carrega a configuracao local de ambiente.
 *
 * A leitura vem de um arquivo `.env` na raiz do projeto, que esta no
 * `.gitignore` e nunca e versionado. Isso evita digitar a connection string
 * no terminal a cada comando e mantem o segredo fora do shell, do historico e
 * de qualquer log.
 *
 * A variavel de ambiente real tem prioridade sobre o arquivo.
 *
 * Nenhum valor lido aqui e impresso em log, erro ou saida de script.
 */

const path = require('path');
const fs = require('fs');

const raizDoProjeto = path.resolve(__dirname, '..');
const caminhoDoEnv = path.join(raizDoProjeto, '.env');

let carregado = false;

function carregarEnv() {
  if (carregado) return;
  carregado = true;

  if (!fs.existsSync(caminhoDoEnv)) return;

  // O dotenv e dependencia do projeto; se faltar, segue sem carregar o arquivo.
  try {
    require('dotenv').config({ path: caminhoDoEnv, quiet: true });
  } catch {
    // Sem dotenv instalado: a variavel de ambiente continua valendo.
  }
}

/**
 * Informa se a configuracao local existe, sem revelar o conteudo.
 * Usado para avisar o usuario quando falta algum passo.
 */
function statusConfig() {
  carregarEnv();
  return {
    arquivoExiste: fs.existsSync(caminhoDoEnv),
    caminho: caminhoDoEnv,
    temDatabaseUrl: Boolean(process.env.DATABASE_URL),
  };
}

/**
 * Mostra apenas a origem da configuracao, nunca o valor.
 */
function descreverOrigem(chave) {
  carregarEnv();
  const noArquivo = fs.existsSync(caminhoDoEnv)
    && fs.readFileSync(caminhoDoEnv, 'utf8').split(/\r?\n/).some((linha) => linha.trim().startsWith(`${chave}=`));
  if (!process.env[chave]) return 'nao definida';
  return noArquivo ? '.env local' : 'variavel de ambiente';
}

module.exports = { carregarEnv, statusConfig, descreverOrigem, caminhoDoEnv };
