# Fluxos (construtor visual)

Fluxos são conversas automáticas em várias etapas: perguntar, oferecer botões, decidir por condição, marcar o contato com tags e enviar dados para outros sistemas. Ficam em **Fluxos**, no menu lateral.

Campanhas continuam existindo e funcionam em paralelo. Use **campanha** para "comentou → recebe o link". Use **fluxo** quando a conversa tem mais de um passo.

## Etapas disponíveis

| Etapa | O que faz | Saídas |
| --- | --- | --- |
| **Gatilho** | Palavras-chave em comentário, DM ou resposta de Story. Opcional: só um post específico e resposta pública no comentário | Próximo |
| **Mensagem** | Texto com até 3 botões. Botão de resposta cria um caminho; botão de link abre uma página | Uma saída por botão de resposta, ou "Próximo" |
| **Esperar resposta** | Aguarda a pessoa escrever. Pode salvar a resposta como variável (ex.: `cidade`) | Respondeu / Sem resposta |
| **Condição** | "Última resposta contém" ou "Contato tem a tag" | Sim / Não |
| **Ação** | Adiciona ou remove tags; envia os dados para um webhook (n8n, Make, CRM) | Próximo |
| **Atraso** | Espera X minutos (até 24h) | Próximo |

Personalize textos com `{username}` e com qualquer resposta salva, como `{cidade}`.

## Como criar

1. **Fluxos → Novo fluxo**: dê um nome e escolha a conta do Instagram.
2. Clique no **Gatilho** e preencha as palavras-chave.
3. Adicione etapas pelos botões acima do quadro. Para ligar uma etapa a outra, arraste do ponto de saída (embaixo) até o ponto de entrada (em cima) da próxima.
4. **Salvar rascunho** guarda sem colocar no ar. **Publicar** valida e ativa.
5. Para mudar um fluxo no ar, edite e clique em **Publicar alterações**. Conversas em andamento continuam na versão anterior até a próxima etapa.

O sistema bloqueia a publicação e aponta o problema quando há: gatilho sem palavra-chave, mensagem vazia, botão sem texto ou com link sem `https://`, etapa solta (não ligada ao fluxo).

## Regras do Instagram que o sistema já respeita

- **Comentário dá direito a uma única DM** (resposta privada). Depois dela, nada mais pode ser enviado até a pessoa responder ou tocar num botão. Por isso, **a primeira mensagem de um fluxo de comentário deve ter um botão de resposta**. Se não tiver, o fluxo para na segunda mensagem e retoma sozinho quando a pessoa escrever.
- **Janela de 24h**: só é possível mandar mensagem livre até 24h depois da última mensagem da pessoa. Por isso, esperas e atrasos têm limite de 24h.
- **Limite de 750 DMs/hora por conta**: se estourar, a execução é marcada como falha e a mensagem não é enviada.

## Comportamento importante

- Uma palavra-chave inicia **um** fluxo (o mais antigo que bater).
- Se a pessoa está no meio de um fluxo e manda uma DM, a mensagem é tratada como resposta àquele fluxo, não inicia outro.
- Comentar de novo a palavra-chave reinicia o fluxo para aquela pessoa.
- Uma mesma notificação da Meta entregue duas vezes nunca gera mensagem duplicada.
- Desligar um fluxo congela as conversas em andamento; ao religar, elas continuam.

## Webhook da etapa Ação

Envia um `POST` com JSON para o endereço configurado (somente `https://`, tempo limite de 5s):

```json
{
  "event": "flow.action",
  "flowId": "…",
  "runId": "…",
  "nodeId": "…",
  "contact": { "id": "…", "channel": "INSTAGRAM", "externalId": "…", "name": "cliente", "tags": ["lead-sp"], "fields": {} },
  "vars": { "username": "cliente", "keyword": "orçamento", "cidade": "São Paulo" }
}
```

Falha no webhook não interrompe o fluxo; o erro fica registrado na execução.

## Limitações atuais

- Não há tela de histórico por contato (os dados existem nas tabelas `Contact` e `FlowRun`).
- O canal é só Instagram. WhatsApp entra na Fase 3 usando o mesmo motor.
- A condição "segue o perfil" ainda não existe nos fluxos (existe nas campanhas).
