# Segurança e tratamento dos dados

Este documento registra o que foi corrigido, o que ainda depende de ação no deploy e como tratar o histórico do git. Ele não contém valores de credenciais nem dados de pacientes.

## 1. O que estava exposto

| Item | Situação |
| --- | --- |
| `/server.js` | acessível, com todo o código do servidor |
| `/data/agendamentos.json` | acessível, com os agendamentos reais |
| `/package.json`, `/render.yaml` | acessíveis |
| `/.env` | bloqueado pelo provedor (404), mas na mesma raiz do conteúdo estático |
| `GET /api/agendamentos/por-ids?ids=...` | acessível, permitia enumerar ids e ler agendamentos de terceiros |

A causa era `express.static(path.join(__dirname))`: a raiz do projeto inteira era servida como conteúdo público.

## 2. O que foi corrigido no código

- conteúdo estático limitado a `public/`;
- `server.js`, `lib/`, `scripts/`, `tests/`, `data/`, `package.json`, `render.yaml` e `.env` fora do alcance da web;
- rota `por-ids` removida, substituída por `/api/agendamentos/meus`, que exige um token por agendamento;
- token aleatório por agendamento, guardado apenas como hash SHA-256;
- sessão administrativa em cookie assinado, `HttpOnly` e `SameSite=Strict`, no lugar do header `x-admin-password` e da senha em `sessionStorage`;
- suporte a `ADMIN_PASSWORD_HASH` (scrypt) para não manter a senha em texto puro no ambiente;
- limitação de tentativas de login, validação estrita de entrada, limite de corpo, cabeçalhos de segurança e exigência de mesma origem em rotas de escrita;
- gravação atômica do arquivo de dados e proteção contra condição de corrida no mesmo horário;
- remoção dos dados pessoais do `localStorage` (antes, o nome, e-mail, telefone e mensagem de cada agendamento ficavam salvos no navegador do paciente).

## 3. Ações obrigatórias no deploy (produção)

Enquanto estas etapas não forem feitas, o sistema continua exposto no servidor publicado:

1. **Trocar a senha administrativa.** A senha atual foi usada enquanto o `server.js` estava público, então deve ser considerada comprometida.
2. **Definir `SESSION_SECRET`** (mínimo 32 caracteres) no painel de variáveis do provedor. Sem ela, o servidor não inicia em produção.
3. **Definir `ADMIN_PASSWORD_HASH`** (gerado com `node scripts/gerar-hash-senha.js`) ou `ADMIN_PASSWORD` no painel. Nunca no repositório.
4. **Publicar esta versão do código.** Enquanto o deploy antigo estiver no ar, `/data/agendamentos.json` e `/server.js` continuam acessíveis.
5. **Confirmar depois do deploy** que `/data/agendamentos.json`, `/server.js`, `/package.json` e `/render.yaml` respondem 404 e que `/api/agendamentos/por-ids` responde 404.
6. **Definir `ALLOWED_ORIGIN`** apenas se a API for usada por outro domínio.

Observação: no plano gratuito do provedor o disco pode ser efêmero. O arquivo de agendamentos precisa de um destino persistente ou de backup próprio para não ser perdido em cada publicação.

## 4. Tratamento do histórico do git

O arquivo `data/agendamentos.json` já esteve versionado e continua presente nos commits antigos. Removê-lo apenas do commit atual não apaga o passado.

Antes de qualquer reescrita:

1. **Backup privado** do repositório completo, incluindo `.git`, guardado fora de qualquer pasta sincronizada com serviços públicos;
2. **Verificação** de quais caminhos sensíveis aparecem no histórico (`git log --all --name-only`);
3. **Reescrita** com `git filter-repo --path data/agendamentos.json --invert-paths` (ou `--replace-text` para trechos sensíveis), aplicada a todas as referências;
4. **Coordenação**: a reescrita muda todos os hashes. Qualquer branch ou clone existente passa a divergir e precisa ser re-clonado — neste repositório há apenas a `main`, o que simplifica;
5. **Force-push** para a `main`, ação destrutiva que só deve ocorrer com aprovação explícita;
6. **Invalidação de caches**: o GitHub pode manter commits órfãos acessíveis por algum tempo; abrir solicitação de limpeza de cache no suporte, se necessário;
7. **Rotação de credenciais** no mesmo dia: senha administrativa, e qualquer outro segredo que tenha convivido com o repositório;
8. **Aviso** aos pacientes afetados, se os dados expostos permitirem identificação — obrigação prevista na LGPD (Lei 13.709/2018), art. 48.

## 5. Recomendações seguintes

- migrar a persistência para banco de dados, com migrations e backup automático;
- registrar acesso administrativo (quem entrou, quando) sem gravar dados sensíveis no log;
- revisar a política de retenção: agendamentos antigos devem ser arquivados ou excluídos;
- adicionar teste automatizado em CI que falhe se um arquivo sensível voltar a ser servido.
