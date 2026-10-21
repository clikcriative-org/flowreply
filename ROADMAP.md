# Roadmap FlowReply

Objetivo: cobrir as funções do ManyChat que geram resultado para PMEs, em um sistema próprio.

## Fase 1 — Base Instagram (pronta)

Herdada do OpenReply e adaptada:

- [x] Comentário com palavra-chave → DM (posts, reels, stories via DM)
- [x] Resposta pública opcional no comentário
- [x] Links rastreados com cliques/CTR e até 2 botões por DM
- [x] Exigir seguir o perfil antes de liberar o link
- [x] Inbox de DMs, logs de envio, várias contas, workspaces e papéis
- [x] Marca FlowReply, interface padrão em português, sem landing pública
- [x] Deploy completo no Railway (`docs/deploy-railway.md`)

## Fase 2 — Construtor visual de fluxos (pronta)

Guia de uso: [docs/fluxos.md](docs/fluxos.md).

- [x] Modelos `Flow` (rascunho + versão publicada), `Contact` (multicanal, tags, campos) e `FlowRun` (estado, trava otimista, deduplicação por evento)
- [x] Motor puro (`lib/flows/engine.ts`): mensagem com botões, esperar resposta, condição, ação (tags e webhook), atraso
- [x] Regras da Meta embutidas: uma resposta privada por comentário, retomada automática quando a pessoa responde, limite de 24h
- [x] Executor (`lib/flows/runner.ts`) em fila própria do BullMQ, com limite de DMs/hora e registro de erros
- [x] Editor visual (React Flow) em `/flows`, com validação antes de publicar
- [x] Testes: motor, validação, executor e teste de ponta a ponta (Postgres + Redis + navegador + webhook assinado)

Próximos incrementos sugeridos: histórico por contato, condição "segue o perfil", métricas por etapa.

## Fase 3 — WhatsApp Cloud API (pronta)

Guia: [docs/whatsapp.md](docs/whatsapp.md).

- [x] Conexão por número (ID do número + ID da conta + token do usuário do sistema), validada com a Meta e salva criptografada
- [x] Webhook `/api/whatsapp/webhook` com verificação de assinatura `X-Hub-Signature-256`
- [x] Mesmo motor de fluxos: canal virou um adaptador (`lib/flows/channels.ts`)
- [x] Botões de resposta interativos, botão de link nativo e links no texto quando há mistura
- [ ] Templates aprovados (mensagens fora da janela de 24h)
- [ ] Caixa de entrada unificada com resposta manual

## Fase 4 — Contatos e histórico (pronta)

- [x] Tela **Contatos** com busca, filtro por canal, tags e status das execuções
- [x] Histórico da conversa por contato: mensagens recebidas, enviadas e falhas de envio
- [x] Edição manual de tags

## Riscos e decisões

- **App Review da Meta**: não é necessário enquanto o sistema atende só as suas contas (Standard Access). Passa a ser obrigatório, junto com a verificação da empresa, se você quiser conectar contas de clientes.
- **Custo WhatsApp**: a Meta cobra por conversa/mensagem de template. Mensagens de marketing para listas frias são caras e arriscam bloqueio do número.
- **Disparos em massa**: fora do escopo atual. No Instagram, a Meta proíbe DM fora da janela de 24h.
- **Atualizações do OpenReply**: o remoto `upstream` permite trazer correções (`git fetch upstream && git merge upstream/main`). Quanto mais o código divergir, mais conflitos. Concentre código novo em pastas próprias (`lib/flows`, `lib/whatsapp`).
