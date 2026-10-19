#!/usr/bin/env node
// Confirma que a versao vulneravel do Site-veronica nao responde mais.
//
//   node verificar-suspensao.mjs [url-base]
//
// Saida: codigo 0 quando nenhuma rota sensivel responde conteudo.
//         codigo 1 quando ainda ha exposicao.
//
// Considera "exposto" apenas respostas 2xx: um 404, 403, 503 ou erro de
// conexao significa que o caminho nao entrega conteudo ao publico.

const base = (process.argv[2] || 'https://site-veronica.onrender.com').replace(/\/$/, '');

const caminhos = [
  '/data/agendamentos.json',
  '/server.js',
  '/package.json',
  '/render.yaml',
  '/node_modules/express/package.json',
  '/api/agendamentos/por-ids?ids=1',
];

const resultado = { base, verificadoEm: new Date().toISOString(), exposed: [], blocked: [], erros: [] };

console.log(`Verificando ${base}\n`);

for (const caminho of caminhos) {
  let status;
  try {
    const res = await fetch(`${base}${caminho}`, { method: 'GET', redirect: 'manual' });
    status = res.status;
    // Consome o corpo para forcar a leitura real do recurso.
    const corpo = await res.text();
    if (res.ok && corpo.length > 0) {
      resultado.exposed.push({ caminho, status, bytes: corpo.length });
      console.log(`  EXPOSTO  ${status}  ${caminho}  (${corpo.length} bytes)`);
    } else {
      resultado.blocked.push({ caminho, status, bytes: corpo.length });
      console.log(`  bloqueado ${status}  ${caminho}`);
    }
  } catch (erro) {
    const mensagem = erro.message;
    resultado.erros.push({ caminho, erro: mensagem });
    console.log(`  sem rota  ${caminho}  (${mensagem})`);
  }
}

console.log('\n--- RESUMO ---');
console.log(`  ainda expostos: ${resultado.exposed.length}`);
console.log(`  bloqueados:     ${resultado.blocked.length}`);
console.log(`  sem rota:       ${resultado.erros.length}`);

if (resultado.exposed.length === 0) {
  console.log('\nOK: nenhuma rota sensivel entrega conteudo ao publico.');
} else {
  console.log('\nATENCAO: as rotas abaixo ainda entregam conteudo:');
  for (const item of resultado.exposed) {
    console.log(`  ${item.status} ${item.caminho} (${item.bytes} bytes)`);
  }
}

process.exitCode = resultado.exposed.length ? 1 : 0;
