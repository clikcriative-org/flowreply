# Deploy no Railway (tudo em um projeto)

Cinco serviços no mesmo projeto Railway, todos construídos do mesmo `Dockerfile`:

| Serviço | Origem | Config as code | Função |
| --- | --- | --- | --- |
| `postgres` | Database → PostgreSQL | — | Campanhas, contatos, logs, contas |
| `redis` | Database → Redis | — | Fila de envio (BullMQ) e rate limit |
| `web` | GitHub repo | `railway/web.json` | Painel, OAuth, webhooks. Roda as migrations ao subir |
| `worker` | GitHub repo | `railway/worker.json` | Envia as DMs, reconcilia comentários. Fica ligado 24/7 |
| `cron` | GitHub repo | `railway/cron.json` | Renova tokens do Instagram todo dia (sem ele, tudo para em ~60 dias) |

## Passo a passo

1. **Projeto**: Railway → New Project → Empty Project.
2. **Bancos**: New → Database → PostgreSQL. Depois New → Database → Redis.
3. **Serviço `web`**: New → GitHub Repo → este repositório.
   - Settings → Config-as-code → `railway/web.json`
   - Settings → Networking → Generate Domain (anote a URL, ex.: `flowreply-production.up.railway.app`)
4. **Serviço `worker`**: New → GitHub Repo → mesmo repositório. Config-as-code → `railway/worker.json`. Sem domínio público.
5. **Serviço `cron`**: idem, config-as-code → `railway/cron.json`. Sem domínio público.
6. **Variáveis**: crie em Project Settings → Shared Variables e compartilhe com `web`, `worker` e `cron`:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | `${{postgres.DATABASE_URL}}` (rede interna) |
| `REDIS_URL` | `${{redis.REDIS_URL}}` (rede interna) |
| `NEXTAUTH_URL` | `https://<domínio do web>` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` — **igual em todos os serviços** |
| `ALLOWED_EMAILS` | seu e-mail (e da equipe). **Obrigatório para o sistema ser só seu** |
| `RESEND_API_KEY`, `EMAIL_FROM` | login por link mágico (Resend) |
| `META_GRAPH_API_VERSION` | `v25.0` |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN` | do seu app na Meta |

   Só no `web`: `PORT=3000`. Só no `cron`: `CRON_BASE_URL=http://${{web.RAILWAY_PRIVATE_DOMAIN}}:3000` (ou a URL pública do `web`).

7. **App na Meta**: veja a seção abaixo.
8. **Teste**: abra `https://<domínio>/api/health`, faça login com o e-mail liberado, conecte o Instagram, crie uma campanha ou fluxo e comente a palavra-chave a partir de **outra** conta.

## App na Meta (sem App Review)

Para um sistema que só atende **as suas contas**, a Meta não exige App Review: o Standard Access basta. O que ela exige é que cada conta tenha papel no app e que o app esteja publicado (Live).

**Use um app novo, só para o FlowReply.** Não reaproveite o app "gerenciador": ele já envia os webhooks de WhatsApp para outro sistema, e cada app só tem um endereço de webhook por produto. Misturar os dois quebra um deles.

1. developers.facebook.com → Meus apps → Criar app → tipo **Empresa** → nome "FlowReply".
2. Adicione o produto **Instagram** → "API com login do Instagram".
3. Em "Configurar login comercial do Instagram", cadastre o redirect `https://<domínio>/api/instagram/callback`.
4. Copie o **ID do app do Instagram** e a **chave secreta do app do Instagram** para `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`. Em Configurações → Básico, copie a chave secreta do app para `FACEBOOK_APP_SECRET`.
5. **Webhooks** (produto Instagram): URL `https://<domínio>/api/webhook`, token = `WEBHOOK_VERIFY_TOKEN`. Assine os campos `comments` e `messages`.
6. **Funções do app → Testadores do Instagram**: convide o @ de cada conta que vai usar. Depois, no Instagram de cada conta: Editar perfil → Apps e sites → Convites de testador → **Aceitar**. Sem isso o login falha com "Insufficient Developer Role".
7. **Configurações → Básico**: preencha
   - Política de privacidade: `https://<domínio>/privacy`
   - Termos de serviço: `https://<domínio>/terms`
   - Exclusão de dados: `https://<domínio>/data-deletion`
   - Categoria e ícone do app
8. **Publicar** (menu lateral) → mude para **Live**. Em modo desenvolvimento, os comentários reais **não** geram webhook; só o botão de teste do painel.

Pronto: a partir daqui, qualquer pessoa que comentar nos posts das suas contas recebe a DM. App Review só seria necessário para conectar contas de **outras** empresas (ex.: vender o sistema para clientes).

## Custo estimado

Plano Hobby (US$ 5 de crédito incluso) cobre testes. Em produção com 5 serviços, conte com US$ 10–25/mês, conforme uso.

## Problemas comuns

- **DM não sai, log mostra erro de decrypt** → `ENCRYPTION_KEY` diferente entre `web` e `worker`.
- **Nada acontece ao comentar** → webhook não verificado na Meta, ou app em modo desenvolvimento sem a conta como testadora.
- **Parou tudo após ~60 dias** → serviço `cron` fora do ar (token não foi renovado).
