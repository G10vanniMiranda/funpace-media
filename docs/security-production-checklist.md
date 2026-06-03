# Checklist de Seguranca em Producao

## Vercel e variaveis

- Definir `ALLOWED_ORIGINS=https://funpace.media,https://www.funpace.media`.
- Manter `CORS_ORIGINS` apenas como fallback legado.
- Definir `INFINITEPAY_WEBHOOK_SECRET` e configurar o mesmo segredo na InfinitePay.
- Manter `INFINITEPAY_ALLOW_UNSIGNED_WEBHOOKS=false` em producao.
- Definir `DOWNLOAD_TOKEN_SECRET` com valor aleatorio forte.
- Definir `CRON_SECRET` para `/api/payments/reconcile`.
- Definir `API_JSON_BODY_LIMIT_BYTES=204800` e `WEBHOOK_MAX_BODY_BYTES=204800` para limitar payloads JSON.
- Definir `OPERATIONS_SECRET` se `/api/system?route=checkout-debug` for usado em staging.
- Nunca expor `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `BUCKET_API_TOKEN` ou `RESEND_API_KEY` em variaveis `VITE_*`.

## Supabase

- Executar `scripts/supabase-security-hardening.sql` no SQL Editor apos revisar em staging.
- Confirmar RLS habilitado em tabelas sensiveis: `orders`, `payments`, `payment_events`, `download_access`, `download_events`, `withdrawal_requests`, `photographer_transactions`, `admin_activity_logs`.
- Confirmar que buckets com arquivos originais nao sao publicos quando o provedor permitir bucket privado.
- Usar somente service role em APIs server-side.
- Rotacionar service role se ja foi exposta em logs, frontend ou prints.

## Cloudflare/WAF

- Ativar proxy no DNS do dominio publico.
- Criar regras de rate limit para `/api/checkout/*`, `/api/downloads/*`, `/api/media/upload`, `/api/admin*`.
- Manter rate limit de borda/WAF mesmo com rate limit em codigo, porque instancias serverless nao compartilham memoria global.
- Bloquear paises/ASNs apenas se houver abuso comprovado.
- Ativar bot fight/WAF gerenciado quando disponivel.

## VPS ou proxy reverso

- Expor apenas 80/443 publicos.
- Proteger SSH com chave, sem senha, e restringir por IP quando possivel.
- Fechar portas de banco, Redis, painéis e servicos internos.
- Usar TLS valido e renovacao automatica.
- Limitar tamanho de body no Nginx/Traefik de acordo com `MEDIA_UPLOAD_MAX_BYTES`.
- Configurar timeout alto para upload e timeout baixo para rotas comuns.

## Testes de seguranca

- POST de origem desconhecida para checkout deve retornar 403.
- Pedido pendente nao deve gerar download.
- Usuario diferente nao deve baixar item comprado por outro cliente.
- Admin sem role deve receber 403.
- Webhook sem assinatura deve falhar em producao quando `INFINITEPAY_WEBHOOK_SECRET` estiver definido.
- Payload grande acima de `API_MAX_BODY_BYTES` deve retornar 413 nas rotas que usam utilitario compartilhado.
