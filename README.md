# FunPace Media

Plataforma para venda de fotos e vídeos de eventos esportivos. O fluxo conecta atletas, fotógrafos e administradores em uma aplicação Vite/React com backend Node/Express, Supabase para auth/banco e provider externo para armazenamento de mídias.

## Principais Fluxos

- Vitrine publica com busca por numero de peito, eventos, favoritos, likes e compartilhamento.
- Carrinho e checkout com InfinitePay via `/api/checkout/create-session`.
- Retorno de pagamento, confirmação e liberação de downloads protegidos.
- Area do cliente em `/minhas-compras`, com pedidos, recibo minimo, favoritos e downloads.
- Painel do fotógrafo para upload, edição, remoção de produtos, vendas, downloads e solicitações de saque.
- Painel administrativo para fotógrafos, pedidos, métricas, configurações, storage e processamento manual de saques.

## Requisitos

- Node.js
- Projeto Supabase configurado
- Bucket externo configurado quando `MEDIA_STORAGE_PROVIDER=external_bucket`
- Credenciais InfinitePay para checkout e verificação de pagamento

## Configuracao

Copie `.env.example` para `.env` e preencha as variaveis obrigatorias:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

MEDIA_STORAGE_PROVIDER=external_bucket
MEDIA_BUCKET=
MEDIA_PUBLIC_BASE_URL=
BUCKET_API_BASE_URL=
BUCKET_API_TOKEN=

PAYMENT_PROVIDER=infinitepay
INFINITEPAY_HANDLE=
INFINITEPAY_WEBHOOK_SECRET=
```

Em producao, use `VITE_DATA_MODE=production`. O modo `mock` serve apenas para desenvolvimento visual sem depender do backend real.

## Comandos

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

Comandos operacionais:

```bash
npm run backup:db
npm run backup:bucket
npm run supabase:schema:apply
npm run supabase:schema:validate
npm run bucket:upload:test
npm run payments:reconcile
npm run supabase:admin:set -- email@exemplo.com
```

`npm run payments:reconcile` roda em dry-run por padrao. Para aplicar mudancas em pedidos, use:

```bash
npm run payments:reconcile -- --apply
```

O job depende de `transaction_nsu` e `slug` salvos no retorno, webhook, pagamento ou URL da InfinitePay. Pedidos antigos que não tenham esses identificadores continuam exigindo conferência manual no painel administrativo.

## Validacao Antes De Deploy

Execute:

```bash
npm run lint
npm test
npm run build
npm audit
```

Tambem valide manualmente:

- login/cadastro de cliente;
- upload e publicação por fotógrafo;
- compra InfinitePay;
- retorno de pagamento;
- download protegido em `/minhas-compras`;
- métricas do fotógrafo e admin;
- saque manual e configurações administrativas.

## Pendencias Operacionais

- Manter `npm run supabase:schema:validate` no checklist antes de deploy.
- Confirmar `INFINITEPAY_WEBHOOK_SECRET` no deploy.
- Agendar `npm run payments:reconcile -- --apply` para reconciliar pedidos pendentes com identificadores InfinitePay salvos.
- Agendar backup automatizado do banco e bucket usando `npm run backup:db` e `npm run backup:bucket`.
- Registrar auditoria persistente de acoes administrativas.
- Adicionar testes E2E para compra, retorno de pagamento e download.
