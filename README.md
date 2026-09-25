# Website — Psicóloga Verônica Reis Santana

Site institucional com fluxo de agendamento para uma profissional de Psicologia. O projeto reúne conteúdo profissional, páginas informativas e uma API Node.js/Express para operações de agendamento.

## Projeto

O site apresenta informações sobre atendimento, especialidades, certificados, depoimentos e blog, além de páginas de agendamento, consulta de agendamentos e administração.

## Funcionalidades

- páginas institucionais, blog e certificados;
- formulário e consulta de agendamentos;
- área administrativa do projeto;
- API Express para as rotas utilizadas pela interface;
- layout responsivo e recursos básicos de acessibilidade.

## Tecnologias

HTML, CSS, JavaScript, Node.js, Express e dotenv.

## Arquitetura

As páginas estáticas ficam na raiz do projeto. O `server.js` serve os arquivos e expõe as rotas da API em `/api`. Os dados de demonstração ficam em `data/`.

## Como executar

```bash
npm install
npm start
```

Abra `http://localhost:3000` (ou a porta definida por `PORT`).

## Variáveis de ambiente

Crie um arquivo `.env` apenas quando necessário para o ambiente local. Ele não deve ser versionado. A aplicação aceita `PORT`; nunca publique senhas ou credenciais reais no repositório.

## Deploy

O deploy configurado é: [site-veronica.onrender.com](https://site-veronica.onrender.com).

## Melhorias futuras

- persistência em banco de dados;
- autenticação administrativa mais robusta;
- notificações e integrações externas mediante configuração segura.

## Autor

Desenvolvido por [Lucas Santana da Paz](https://github.com/Japapaz696).
