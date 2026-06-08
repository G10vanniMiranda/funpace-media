# Relatorio de Auditoria de Seguranca de Midias - Funpace Media

Data: 2026-06-08

## Escopo executado

- Frontend: exposicao de URLs, assinatura de midias, previews, downloads em Minha Conta.
- Backend: endpoints de download, assinatura de midia, checkout, confirmacao InfinitePay, webhook InfinitePay e recuperacao/admin de pagamentos.
- Storage e banco: buckets, RLS/policies, tabelas de pedidos/downloads/pagamentos e auditoria readonly.
- Testes: build, typecheck, testes focados de seguranca e pagamento.

## Vulnerabilidades encontradas e corrigidas

### 1. Endpoint `/api/media/sign` assinava midias sem autorizacao forte

Risco: alto.

Como reproduzir:
- Enviar um `POST /api/media/sign` com paths de midias permitidos pelo `MEDIA_PUBLIC_BASE_URL`.
- O endpoint retornava URL resolvida sem validar se o path era apenas preview, se pertencia a produto publicado ou se o usuario podia acessar.

Correcao aplicada:
- O endpoint agora so retorna URLs para campos de preview cadastrados em `products.thumbnailUrl` ou `products.watermarkUrl`.
- Produto precisa estar publicado, ou o usuario autenticado precisa ser admin/super_admin ou dono fotografo da midia.
- Paths de originais (`url`/`storagePath`) deixam de ser assinados por esse endpoint.
- Rate limit reduzido de 90 para 45 req/min por IP.

Arquivos:
- `api/media/sign.ts`
- `src/lib/services.ts`

### 2. Frontend podia receber URL original no estado da aplicacao

Risco: alto.

Como reproduzir:
- Abrir DevTools/Network/React state em paginas de galeria, videos, pedidos ou dashboards.
- Em alguns fluxos, `signMediaUrls` preservava `item.url`/`product.url`, especialmente videos e itens de pedido.

Correcao aplicada:
- `signMediaUrls` agora protege originais por padrao.
- Galerias publicas, busca facial, favoritos, pedidos e vendas nao carregam URL original no cliente.
- Downloads em Minha Conta dependem de `orderId` + `orderItemId` e passam pelo proxy autorizado, nao por URL exposta.

Arquivos:
- `src/lib/services.ts`
- `src/components/CustomerOrdersDrawer.tsx`

### 3. Token de download era reutilizavel ate expirar

Risco: alto.

Como reproduzir:
- Comprar um item, gerar link em `/api/downloads/authorize` e reutilizar/compartilhar o mesmo link ate o TTL expirar.

Correcao aplicada:
- Criada tabela `public.download_tokens` com `tokenHash` unico, expiracao e `consumedAt`.
- O `POST /api/downloads/authorize` grava o hash do token emitido.
- O `GET /api/downloads/authorize` consome o token no primeiro uso; reutilizacao retorna 403.
- O token inclui `jti` unico.
- Tentativas negadas sao registradas em `admin_activity_logs` com action `security_download_denied`.

Arquivos:
- `api/downloads/authorize.ts`
- `scripts/add-download-token-security.sql`

Banco:
- Patch aplicado com sucesso via `node scripts/apply-supabase-patch.mjs add-download-token-security.sql`.

### 4. Webhook InfinitePay aceitava payload sem segredo em producao

Risco: critico se `INFINITEPAY_WEBHOOK_REQUIRE_AUTH` nao estivesse configurado.

Como reproduzir:
- Em ambiente sem segredo ou sem `INFINITEPAY_WEBHOOK_REQUIRE_AUTH=true`, enviar payload ao webhook e provocar registro/processamento.

Correcao aplicada:
- Em `NODE_ENV=production`, o webhook agora exige segredo.
- Se `INFINITEPAY_WEBHOOK_SECRET`/`INFINITEPAY_WEBHOOK_TOKEN` nao estiver configurado, o webhook nega a requisicao.

Arquivo:
- `api/webhooks/infinitepay.ts`

### 5. Endpoint admin generico permitia marcar pedido como pago

Risco: alto.

Como reproduzir:
- Usuario admin chamar `/api/admin/orders/status` com `status: paid`.
- O endpoint liberava fulfillment e downloads pelo fluxo generico de status.

Correcao aplicada:
- Alteracao direta para `paid` foi bloqueada nesse endpoint.
- Liberacao manual fica restrita ao fluxo de recuperacao de pagamento.
- Recuperacao manual agora exige `super_admin` e justificativa/comprovante detalhado.

Arquivos:
- `server/api/admin/orders/status.ts`
- `server/api/admin/payments/recovery.ts`

## Resultado da auditoria readonly

Relatorio bruto gerado:
- `reports/security-audit-2026-06-08-after-hardening.json`

Resumo sem dados pessoais:
- Pedidos: 68
- Itens de pedido: 69
- Download access: 36
- Download events: 111
- Produtos: 3594
- Payments: 46
- Payment events: 58
- Logs admin: 41
- Clientes: 24
- Fotografos: 11

Buckets:
- `bucket_funpace`: privado
- `funpace-media`: privado
- `event-covers`: publico, somente capa de evento
- `photographer-avatars`: publico, somente avatar
- `photographer-covers`: publico, somente capa de perfil

Observacao:
- Buckets de midia principal estao privados na auditoria.
- Buckets publicos restantes sao de assets publicos de perfil/evento, nao de midias premium.

## Validacoes executadas

- `node scripts/apply-supabase-patch.mjs add-download-token-security.sql`: passou.
- `node scripts/audit-security-readonly.mjs > reports/security-audit-2026-06-08-after-hardening.json`: passou.
- `npm run lint`: passou.
- `npm run build`: passou.
- `node --import tsx --test tests\performance-security-audit.test.ts tests\payment-recovery-safety.test.ts tests\payment-recovery-safety.test.ts`: passou, 7/7.

Suite completa:
- `npm test` executado.
- Resultado: 47 passaram, 4 falharam.
- Falhas observadas estao relacionadas a expectativas textuais/snapshots de busca facial e upload alteradas em revisao gramatical anterior, nao aos endpoints corrigidos nesta auditoria.

## Status final

Corrigido:
- Originais nao sao mais entregues pelo endpoint de assinatura de midia.
- Frontend deixa de receber URL original para galeria, videos, pedidos e vendas.
- Download passa por validacao de pedido pago, usuario, item do pedido e token descartavel.
- Link de download compartilhado/reutilizado deixa de funcionar apos primeiro uso.
- Webhook exige autenticacao em producao.
- Status `paid` nao pode ser aplicado por endpoint admin generico.
- Liberacao manual exige `super_admin`, justificativa e log.
- Tentativas invalidas de download sao auditadas.

Riscos residuais e recomendacoes:
- Verificar no provedor externo de bucket se URLs antigas gravadas como `products.url` possuem acesso direto publico fora do app. O app nao as entrega mais, mas se o provedor mantiver URLs publicas conhecidas historicamente, e necessario rotacionar/migrar os objetos para acesso privado.
- Configurar obrigatoriamente `DOWNLOAD_TOKEN_SECRET` em producao para nao depender de fallback.
- Configurar obrigatoriamente `INFINITEPAY_WEBHOOK_SECRET` ou `INFINITEPAY_WEBHOOK_TOKEN` em producao.
- Considerar WAF/CDN rate limiting por rota para complementar o rate limit em memoria do serverless.
- Adicionar testes automatizados especificos para token descartavel de download e bloqueio de `/api/media/sign` para originais.
