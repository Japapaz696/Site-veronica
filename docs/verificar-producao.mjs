// Verifica a exposição em produção do Site-veronica.
// Somente leitura: faz requisições HEAD/GET e reporta status. Nao imprime conteudo.
// Uso: node verificar-producao.mjs [url-base]
const base = (process.argv[2] || 'https://site-veronica.onrender.com').replace(/\/$/, '');

// Caminhos que DEVEM estar bloqueados depois do deploy.
const devemBloquear = [
  '/data/agendamentos.json',
  '/server.js',
  '/package.json',
  '/render.yaml',
  '/.env',
  '/node_modules/express/package.json',
  '/tests/security.test.js',
  '/lib/passwords.js',
  '/api/agendamentos/por-ids?ids=1',
];

// Caminhos que DEVEM continuar funcionando (conteudo publico).
const devemResponder = [
  { caminho: '/', ok: [200] },
];

// Caminhos que DEVEM exigir sessao.
const devemExigirSessao = [
  '/api/agendamentos',
  '/api/session',
];

async function status(url, metodo = 'GET') {
  try {
    const res = await fetch(url, { method: metodo, redirect: 'manual' });
    return res.status;
  } catch (e) {
    return `erro: ${e.message}`;
  }
}

const resultado = { base, geradoEm: new Date().toISOString(), bloqueados: [], expostos: [], publicos: [], sessao: [], problemas: [] };

console.log(`Verificando ${base}\n`);

console.log('--- devem estar BLOQUEADOS (esperado 404) ---');
for (const caminho of devemBloquear) {
  const s = await status(base + caminho);
  const bloqueado = s === 404;
  resultado.bloqueados.push({ caminho, status: s, ok: bloqueado });
  if (!bloqueado) resultado.expostos.push({ caminho, status: s });
  console.log(`  ${bloqueado ? 'OK   ' : 'FALHA'} ${String(s).padEnd(6)} ${caminho}`);
}

console.log('\n--- devem RESPONDER (conteudo publico) ---');
for (const item of devemResponder) {
  const s = await status(base + item.caminho);
  const ok = item.ok.includes(s);
  resultado.publicos.push({ caminho: item.caminho, status: s, ok });
  if (!ok) resultado.problemas.push({ caminho: item.caminho, status: s, esperado: item.ok });
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${String(s).padEnd(6)} ${item.caminho}`);
}

console.log('\n--- devem exigir SESSAO (esperado 401) ---');
for (const caminho of devemExigirSessao) {
  const s = await status(base + caminho);
  const ok = s === 401;
  resultado.sessao.push({ caminho, status: s, ok });
  if (!ok) resultado.problemas.push({ caminho, status: s, esperado: 401 });
  console.log(`  ${ok ? 'OK   ' : 'FALHA'} ${String(s).padEnd(6)} ${caminho}`);
}

console.log('\n--- RESUMO ---');
console.log(`  expostos:        ${resultado.expostos.length}`);
console.log(`  exigem sessao:   ${resultado.sessao.filter((s) => s.ok).length}/${resultado.sessao.length}`);
console.log(`  problemas:       ${resultado.problemas.length}`);

if (resultado.expostos.length) {
  console.log('\nATENCAO: os caminhos abaixo continuam publicos:');
  for (const e of resultado.expostos) console.log(`  ${e.status} ${e.caminho}`);
}

process.exitCode = resultado.expostos.length || resultado.problemas.length ? 1 : 0;
