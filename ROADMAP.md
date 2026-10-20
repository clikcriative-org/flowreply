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

## Fase 2 — Construtor visual de fluxos

Substitui "1 campanha = 1 mensagem" por um fluxo com várias etapas.

**Modelo de dados**
- `Flow` (workspace, nome, status, gatilho) e `FlowVersion` (grafo JSON publicado, imutável)
- `FlowRun` (contato, fluxo, nó atual, variáveis, status) para retomar quando o contato responde
- `Contact` unificado por canal (Instagram ID / telefone WhatsApp), com `tags` e campos personalizados

**Nós do MVP**
| Nó | Função |
| --- | --- |
| Gatilho | Palavra-chave em comentário, DM ou mensagem WhatsApp |
| Mensagem | Texto, imagem, até 3 botões |
| Aguardar resposta | Pausa até o contato responder ou clicar (com timeout) |
| Condição | Por resposta, tag, campo ou se segue o perfil |
| Ação | Adicionar/remover tag, salvar campo, chamar webhook (n8n/CRM) |
| Atraso | Esperar X minutos/horas (job atrasado no BullMQ) |

**Execução**: o worker já existente ganha um `flow-runner` que avança um nó por job, respeitando o rate limit e a janela de 24h da Meta.

**Editor**: React Flow (`@xyflow/react`) na rota `/flows/[id]`, com validação antes de publicar.

## Fase 3 — WhatsApp Cloud API

- Conexão por número (Phone Number ID + token do System User), salvo criptografado como o token do Instagram
- Webhook `/api/whatsapp/webhook` com verificação de assinatura `X-Hub-Signature-256`
- Envio de texto, botões interativos e listas dentro da janela de 24h
- Fora da janela: só **templates aprovados** (cadastro e sincronização no painel)
- Inbox unificada Instagram + WhatsApp
- Mesmo motor de fluxos da Fase 2 (o canal vira só um adaptador de envio)

## Riscos e decisões

- **App Review da Meta**: necessário para `instagram_business_manage_messages` e `whatsapp_business_messaging` em produção. Inicie cedo; leva semanas.
- **Custo WhatsApp**: a Meta cobra por conversa/mensagem de template. Mensagens de marketing para listas frias são caras e arriscam bloqueio do número.
- **Disparos em massa**: fora do escopo atual. No Instagram, a Meta proíbe DM fora da janela de 24h.
- **Atualizações do OpenReply**: o remoto `upstream` permite trazer correções (`git fetch upstream && git merge upstream/main`). Quanto mais o código divergir, mais conflitos. Concentre código novo em pastas próprias (`lib/flows`, `lib/whatsapp`).
