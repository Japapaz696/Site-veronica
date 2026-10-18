# Segurança e tratamento dos dados

Este documento registra o que foi corrigido, o que ainda depende de ação no deploy e como tratar o histórico do git. Ele não contém valores de credenciais nem dados de pacientes.

## 1. O que estava exposto

| Item | Situação |
| --- | --- |
| `/server.js` | acessível, com todo o código do servidor |
| `/data/agendamentos.json` | acessível, com os agendamentos reais |
| `/package.json`, `/render.yaml` | acessíveis |
| `/node_modules/express/package.json` | acessível (verificado) |
| `/.env` | bloqueado pelo provedor (404), mas na mesma raiz do conteúdo estático |
| `GET /api/agendamentos/por-ids?ids=...` | acessível, permitia enumerar ids e ler agendamentos de terceiros |

A causa era `express.static(path.join(__dirname))`: a raiz do projeto inteira era servida como conteúdo público.

### 1.1 Segunda exposição: GitHub Pages do mesmo repositório

Além do Render, o repositório tinha **GitHub Pages ativo na branch `main`**. Isso
publicava uma segunda cópia dos mesmos arquivos em
`https://japapaz696.github.io/Site-veronica/`, incluindo `data/agendamentos.json`.

O Pages serve a branch, não o resultado do pull request. Portanto **o PR sozinho
não corrige essa cópia**: ela continua no ar enquanto o Pages estiver ativo e a
`main` antiga existir. A orientação é desativar o Pages deste repositório — é uma
aplicação Express, não um site estático, e a versão publicada ali nunca funcionou
de verdade.

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
- **persistência em banco de dados** (ver seção 6).

## 3. Ações obrigatórias no deploy (produção)

Enquanto estas etapas não forem feitas, o sistema continua exposto no servidor publicado:

1. **Trocar a senha administrativa.** A senha atual foi usada enquanto o `server.js` estava público, então deve ser considerada comprometida.
2. **Definir `SESSION_SECRET`** (mínimo 32 caracteres) no painel de variáveis do provedor. Sem ela, o servidor não inicia em produção.
3. **Definir `ADMIN_PASSWORD_HASH`** (gerado com `node scripts/gerar-hash-senha.js`) ou `ADMIN_PASSWORD` no painel. Nunca no repositório.
4. **Definir `DATABASE_URL`** com a URL interna do Postgres. Sem ela, os agendamentos vão para arquivo e se perdem a cada deploy.
5. **Publicar esta versão do código.** Enquanto o deploy antigo estiver no ar, `/data/agendamentos.json` e `/server.js` continuam acessíveis.
6. **Desativar o GitHub Pages** deste repositório (ver 1.1).
7. **Confirmar depois do deploy** que `/data/agendamentos.json`, `/server.js`, `/package.json`, `/render.yaml`, `/node_modules/express/package.json` e `/api/agendamentos/por-ids` respondem 404, e que `/api/agendamentos` responde 401 sem sessão. O script `docs/verificar-producao.mjs` faz essa checagem.
8. **Definir `ALLOWED_ORIGIN`** apenas se a API for usada por outro domínio.

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

- registrar acesso administrativo (quem entrou, quando) sem gravar dados sensíveis no log;
- revisar a política de retenção: agendamentos antigos devem ser arquivados ou excluídos;
- adicionar teste automatizado em CI que falhe se um arquivo sensível voltar a ser servido;
- acompanhar a validade do Postgres gratuito e migrar para pago antes dos 30 dias.

## 6. Persistência: do arquivo JSON para o Postgres

### Por que mudou

O Render não permite disco persistente no plano gratuito e o sistema de arquivos
é efêmero: qualquer arquivo gravado localmente se perde **a cada deploy, restart
ou quando o serviço hiberna por inatividade** (15 minutos sem tráfego). Manter os
agendamentos em arquivo significava perdê-los continuamente.

### Como ficou

A persistência vive em `lib/repository.js`, com dois backends atrás da mesma
interface:

| Backend | Quando é usado |
| --- | --- |
| Postgres | sempre que `DATABASE_URL` estiver definida (produção) |
| Arquivo JSON | quando não há banco (desenvolvimento e testes) |

O restante do servidor não sabe qual está ativo. O formato do agendamento
devolvido é idêntico ao do arquivo histórico, então o front-end não mudou.

A escolha foi por **whitelist**: o Postgres só entra quando configurado
explicitamente. Sem `DATABASE_URL`, o comportamento é o antigo — o que mantém a
suíte de testes rápida e sem dependências externas.

### Esquema

```
agendamentos (
  id          BIGINT PRIMARY KEY,
  nome        TEXT        NOT NULL,
  email       TEXT        NOT NULL,
  telefone    TEXT        NOT NULL,
  tipo        TEXT        NOT NULL,
  data        DATE        NOT NULL,
  hora        TEXT        NOT NULL,
  mensagem    TEXT        NOT NULL DEFAULT '',
  confirmado  BOOLEAN     NOT NULL DEFAULT FALSE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_hash  TEXT
)
```

O esquema é criado automaticamente na inicialização (`garantirEsquema`), de forma
idempotente. Duas nuances que os testes contra Postgres real revelaram:

1. **`BIGINT` volta como texto** no driver `pg`, para não perder precisão. O
   repositório converte para número, preservando o id como número seguro.
2. **`DATE` volta como `Date`** deslocado pelo fuso do servidor: `2026-01-01`
   chegava como `2026-01-01T03:00:00.000Z`. A leitura pede `to_char(data,
   'YYYY-MM-DD')`, mantendo o formato curto do arquivo original.

### Limitações do Postgres gratuito do Render

| Limitação | Detalhe |
| --- | --- |
| Expiração | o banco gratuito **expira 30 dias após a criação** |
| Tolerância | 14 dias para migrar para plano pago, depois o banco é **apagado com os dados** |
| Backup | o plano gratuito **não** tem nenhuma forma de backup |
| Armazenamento | 1 GB fixo |
| Instâncias | apenas **um** banco gratuito por workspace |

Para uso contínuo, o plano pago mais barato de Postgres custa **US$ 6/mês**
(0.1 CPU / 256 MB). É o único caminho com durabilidade sem prazo de validade.

### Migração dos dados existentes

```
DATABASE_URL=postgres://... node scripts/migrar-para-postgres.js data/agendamentos.json
```

O script não altera o arquivo de origem e não sobrescreve registros já existentes
(mesmo id). Ele foi testado com o agendamento real: os campos pessoais chegam
idênticos, o id continua número seguro e a data preserva o formato `YYYY-MM-DD`.

### Registros anteriores ao token

Agendamentos criados antes desta mudança não têm `access_token_hash`. Isso é
esperado: o paciente que guardou apenas o id no navegador **não** conseguirá
consultá-los pelo site. A administração continua vendo todos. É o preço de
eliminar a listagem por id, que permitia ler agendamentos de terceiros.

## 7. Testes

| Suíte | O que cobre | Banco necessário |
| --- | --- | --- |
| `tests/security.test.js` | exposição de arquivos, autenticação, tokens, validação, CSRF | não |
| `tests/repository.test.js` | conteúdo do repositório, `.gitignore`, `render.yaml` | não |
| `tests/postgres.test.js` | backend Postgres e fluxo HTTP completo sobre ele | **sim** |

A suíte de Postgres só executa quando `TEST_DATABASE_URL` está definida; caso
contrário é ignorada, e os testes locais continuam funcionando sem banco.

```
TEST_DATABASE_URL=postgres://user@host:porta/banco node --test tests/postgres.test.js
```
