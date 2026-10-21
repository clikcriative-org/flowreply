# FlowReply

Sistema próprio de automação para Instagram e WhatsApp: comentário ou mensagem com palavra-chave inicia um fluxo visual com botões, perguntas, condições e tags; contatos com histórico; links rastreados, inbox e logs. Usa a API oficial da Meta. Sem senha do Instagram, sem automação de navegador.

Baseado no [OpenReply](https://github.com/diwenne/openreply) (licença MIT, ver `LICENSE`).

## Começar

| Objetivo | Documento |
| --- | --- |
| Colocar no ar no Railway | [docs/deploy-railway.md](docs/deploy-railway.md) |
| Criar o app na Meta e variáveis em detalhe | [docs/setup.md](docs/setup.md) |
| Criar fluxos no construtor visual | [docs/fluxos.md](docs/fluxos.md) |
| Conectar o WhatsApp | [docs/whatsapp.md](docs/whatsapp.md) |
| O que já existe e o que vem a seguir | [ROADMAP.md](ROADMAP.md) |

## Desenvolvimento local

```bash
docker-compose up -d          # Postgres + Redis
cp .env.example .env          # preencha as variáveis
npm ci
npm run db:migrate
npm run dev                   # painel em http://localhost:3000
npm run worker                # em outro terminal: envia as DMs
```

Checagens antes de subir código: `npm run typecheck && npm test && npm run lint`.

## Trazer atualizações do OpenReply

```bash
git fetch upstream
git merge upstream/main
```
