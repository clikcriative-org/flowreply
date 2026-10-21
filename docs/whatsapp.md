# WhatsApp (Cloud API)

O FlowReply responde no WhatsApp com os mesmos fluxos do Instagram: palavra-chave, botões, perguntas, condições, tags e webhook. Usa a API oficial (Cloud API) da Meta. Não usa WhatsApp Web, QR code nem automação de navegador.

## Antes de começar: um número, um sistema

Se o número já responde por outro sistema (ex.: o app "gerenciador" que envia para o Supabase), **os dois vão responder a mesma mensagem**. A Meta entrega cada mensagem para todos os apps inscritos na conta do WhatsApp Business.

Escolha uma das opções:
- Use no FlowReply um número que nenhum outro sistema responde; ou
- Desligue a resposta automática no outro sistema para esse número.

## Passo a passo

1. **App na Meta**: use o mesmo app novo do FlowReply criado para o Instagram (veja [deploy-railway.md](deploy-railway.md)). Adicione o produto **WhatsApp**.
2. **Número**: em WhatsApp → Configuração da API, adicione e verifique o número da empresa. Anote o **ID do número de telefone** e o **ID da conta do WhatsApp Business**.
3. **Token permanente**: business.facebook.com → Configurações do negócio → Usuários do sistema → crie um usuário do sistema (Admin), atribua o app e a conta do WhatsApp, e gere um token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`. Não use o token temporário de 24h da página de teste.
4. **Webhook**: em WhatsApp → Configuração, cadastre
   - URL: `https://<domínio>/api/whatsapp/webhook`
   - Token de verificação: o valor de `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (ou `WEBHOOK_VERIFY_TOKEN`, se você não definir o primeiro)
   - Assine o campo **messages**
5. **Conectar no FlowReply**: Configurações → Conexão com WhatsApp → informe os dois IDs e o token → Conectar número. O sistema valida o token com a Meta, salva criptografado e inscreve o app na conta do WhatsApp.
6. **Criar fluxo**: Fluxos → escolha "WhatsApp · seu número" → monte e publique.

## Variáveis de ambiente

| Variável | Quando usar |
| --- | --- |
| `WHATSAPP_APP_SECRET` | Só se o WhatsApp estiver em um app da Meta diferente do Instagram. Sem ela, vale `FACEBOOK_APP_SECRET` |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Opcional. Sem ela, vale `WEBHOOK_VERIFY_TOKEN` |

## Como os botões aparecem no WhatsApp

| No editor | No WhatsApp |
| --- | --- |
| Até 3 botões de resposta | Botões interativos (cada um abre um caminho) |
| 1 botão de link, sem botões de resposta | Botão de link nativo |
| Botões de resposta + links, ou 2+ links | Botões de resposta; os links vão no texto da mensagem |

## Regras da Meta

- **Janela de 24h**: o fluxo só envia mensagens livres até 24h depois da última mensagem do cliente. Como todo fluxo de WhatsApp começa com uma mensagem do cliente, a janela está aberta no início. Atrasos longos podem passar do limite.
- **Fora da janela** só é possível enviar *templates* aprovados. O FlowReply ainda não envia templates.
- **Custo**: conversas iniciadas pelo cliente (atendimento) são as mais baratas; a Meta cobra conforme a tabela dela por país.
- **App Review**: não é necessário para o seu próprio número. Só para atender números de outras empresas.

## Limitações atuais

- Sem envio de templates (mensagens fora da janela de 24h, campanhas ativas).
- Mensagens de mídia, localização e reações do cliente são ignoradas pelos fluxos.
- Ainda não há caixa de entrada para responder manualmente pelo painel; o histórico fica em **Contatos**.
