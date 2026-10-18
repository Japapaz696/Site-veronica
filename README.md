# Website — Psicóloga Verônica Reis Santana

Site institucional com fluxo de agendamento para uma profissional de Psicologia. O projeto reúne conteúdo profissional, páginas informativas e uma API Node.js/Express para operações de agendamento.

## Projeto

O site apresenta informações sobre atendimento, especialidades, certificados, depoimentos e blog, além de páginas de agendamento, consulta de agendamentos e administração.

## Funcionalidades

- páginas institucionais, blog e certificados em `public/`;
- formulário e consulta de agendamentos;
- área administrativa com sessão em cookie HttpOnly;
- API Express para as rotas utilizadas pela interface;
- layout responsivo e recursos básicos de acessibilidade.

## Tecnologias

HTML, CSS, JavaScript, Node.js, Express e dotenv.

## Arquitetura

Somente a pasta `public/` é servida como conteúdo estático. Isso mantém fora do alcance da web o `server.js`, o `package.json`, o `render.yaml`, o `.env` e a pasta `data/`.

```
public/     páginas, estilos, scripts e imagens
lib/        funções internas (hash de senha, persistência)
scripts/    utilitários de linha de comando (hash de senha, migração para Postgres)
tests/      testes de segurança, de repositório e do backend Postgres
data/       arquivo de agendamentos — nunca servido; só agendamentos.example.json é versionado
server.js   API + servidor estático restrito a public/
```

### Persistência

Os agendamentos ficam no **Postgres** quando `DATABASE_URL` está definida. Sem
banco, o sistema usa um arquivo JSON local — útil para desenvolvimento e testes.

| Backend | Quando | Observação |
| --- | --- | --- |
| Postgres | `DATABASE_URL` definida | obrigatório em produção |
| Arquivo JSON | sem `DATABASE_URL` | desenvolvimento e testes |

A escolha foi por whitelist: sem configuração explícita, o comportamento é o
local. O restante do servidor não sabe qual backend está ativo, porque a
interface em `lib/repository.js` é a mesma nos dois casos.

Por que o Postgres é obrigatório em produção: o plano gratuito do provedor não
permite disco persistente e o sistema de arquivos é efêmero — arquivos gravados
localmente se perdem a cada deploy, restart ou hibernação.

Para migrar dados já existentes de um arquivo:

```
DATABASE_URL=postgres://... node scripts/migrar-para-postgres.js data/agendamentos.json
```

Endpoints principais:

| Método | Rota | Acesso |
| --- | --- | --- |
| GET | `/api/ocupados` | público (apenas data e hora ocupadas) |
| POST | `/api/agendamentos` | público (o servidor define id, status e token) |
| POST | `/api/agendamentos/meus` | público (exige token de cada agendamento) |
| DELETE | `/api/agendamentos/:id` | dono do agendamento (token) ou administrador |
| POST | `/api/login` / `/api/logout` | administrativo |
| GET | `/api/session` | informa se há sessão ativa |
| GET/PUT/DELETE | `/api/agendamentos` | administrativo |

## Modelo de segurança

- **Sessão administrativa**: depois do login, o servidor envia um cookie assinado com HMAC-SHA256, `HttpOnly`, `SameSite=Strict` e `Secure` em produção. A senha nunca é gravada no navegador.
- **Senha no servidor**: comparada com `scrypt` (ou com comparação de tempo constante quando em texto puro). O header `x-admin-password` não é mais aceito.
- **Token do paciente**: cada agendamento recebe um token aleatório de 32 bytes. O servidor guarda apenas o hash SHA-256. O token é o que prova a propriedade do registro — não é mais possível consultar agendamentos alheios informando um id.
- **Limitação de tentativas** de login por IP (5 em 15 minutos).
- **Validação e limites**: campos normalizados e truncados, data e hora em formato estrito, e-mail e telefone verificados, corpo limitado a 32 KB.
- **Cabeçalhos**: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` e, em produção, `Strict-Transport-Security`.
- **Escrita da API** exige mesma origem e `Content-Type: application/json`, o que fecha o vetor de CSRF simples.
- **Gravação atômica** do arquivo de dados (escrita em arquivo temporário e renomeação), com fila interna contra condição de corrida.

## Como executar

```bash
npm install
npm test
npm start
```

Abra `http://localhost:3000` (ou a porta definida por `PORT`).

## Variáveis de ambiente

Veja `.env.example`. Nunca versione valores reais.

| Variável | Uso |
| --- | --- |
| `PORT` | porta do servidor |
| `ADMIN_PASSWORD` | senha administrativa em texto puro (alternativa simples) |
| `ADMIN_PASSWORD_HASH` | hash scrypt da senha (preferível) |
| `SESSION_SECRET` | obrigatório em produção, mínimo de 32 caracteres |
| `ALLOWED_ORIGIN` | origens extra autorizadas, separadas por vírgula |
| `DATA_FILE` | caminho do arquivo de dados |

Para gerar o hash da senha sem deixá-la no histórico do terminal:

```bash
node scripts/gerar-hash-senha.js
```

## Implantação

O deploy configurado é: [site-veronica.onrender.com](https://site-veronica.onrender.com).

No painel do provedor, defina `ADMIN_PASSWORD_HASH` (ou `ADMIN_PASSWORD`) e `SESSION_SECRET`. Troque a senha que já esteve publicada, porque o arquivo de dados e o código ficaram acessíveis na internet por um período.

## Testes

```bash
npm test
```

A suíte cobre exposição de arquivos internos, autenticação, autorização por token, tentativa de enumeração de ids, validação de entrada, CSRF, cabeçalhos de segurança e formatação dos dados gravados.

## Limitações conhecidas

- o `data/` fica fora da web e é ignorado pelo git; o arquivo real nunca é versionado e precisa de backup próprio — veja `docs/SEGURANCA-DADOS.md`;
- os dados continuam em arquivo JSON, não em banco de dados;
- o histórico do git ainda contém versões antigas do arquivo de dados; a limpeza exige reescrita de histórico e está detalhada em `docs/SEGURANCA-DADOS.md`.

## Autor

Desenvolvido por [Lucas Santana da Paz](https://github.com/Japapaz696).
