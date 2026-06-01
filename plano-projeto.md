# Plano do Projeto FunPace

## 1. Visao Geral

O FunPace Media e uma plataforma para comercializacao de fotos e videos de eventos esportivos. A aplicacao conecta atletas, fotografos e administradores em um fluxo unico: publicacao de midias, vitrine publica, carrinho, checkout, confirmacao de pagamento, downloads protegidos e gestao financeira.

O projeto deixou de ser apenas uma base visual com mocks. A versao atual ja possui integracoes reais com Supabase, storage externo, checkout InfinitePay, painel do cliente, painel do fotografo e painel administrativo. O modo mock continua existindo para desenvolvimento e testes visuais.

## 2. Estado Atual

### Vitrine Publica

- Lista fotos e videos publicados no modelo unificado `Product`.
- Busca por numero de peito.
- Busca visual por selfie ainda simulada.
- Carrinho persistido no navegador.
- Favoritos e likes no navegador, com suporte parcial a favoritos remotos para usuario autenticado.
- Compartilhamento por link de vitrine.
- Checkout exige cliente autenticado e dados de compra validos.

### Checkout E Pagamento

- Checkout principal usa `/api/checkout/create-session`.
- O backend busca produtos no banco, valida status publicado e recalcula total no servidor.
- Pedidos nascem em `orders` com itens em `order_items`.
- InfinitePay cria o link externo de pagamento.
- Retorno de pagamento usa `/api/checkout/confirm`.
- Webhook InfinitePay existe em `/api/webhooks/infinitepay`.
- Downloads sao liberados por `fulfillPaidOrder` depois de pagamento confirmado.

### Cliente

- `/minhas-compras` lista pedidos, itens, status, recibo minimo, favoritos e downloads.
- Pedido pago libera download protegido.
- Pedido pendente pode exibir link para retomar pagamento.
- Compartilhamento de item comprado aponta para a vitrine publica, nao para o arquivo privado.

### Fotografo

- Login/cadastro com Supabase Auth e aprovacao.
- Upload de imagens e videos via `/api/media/upload`.
- Storage final usa provider externo quando `MEDIA_STORAGE_PROVIDER=external_bucket`.
- Produto salva URL publica, `storagePath`, thumbnail e metadados.
- Dashboard mostra produtos, vendas, downloads, saldo e solicitacoes de saque.
- Saques ficam pendentes para processamento manual pelo admin.

### Administrador

- Login exige usuario com `app_metadata.role = admin`.
- Painel mostra fotografos, pedidos, produtos, metricas, pagamentos, saques, storage e configuracoes.
- Configuracoes ficam em `platform_settings`.
- Admin pode confirmar/cancelar pedidos pendentes e marcar saques como pagos/rejeitados.
- Ainda falta auditoria persistente detalhada das acoes administrativas.

## 3. Modelo De Dados Principal

O modelo vendavel e `Product`, persistido na tabela `products`.

Campos relevantes:

- `id`
- `name`
- `price`
- `url`
- `type`: `IMG`, `VIDEO` ou `VIEW`
- `vendedorId`
- `bib`
- `event`
- `checkpoint`
- `thumbnailUrl`
- `watermarkUrl`
- `storagePath`
- `fileHash`
- `fileSize`
- `originalFileName`
- `status`
- `favoriteCount`
- `viewCount`
- `salesCount`

Tabelas operacionais importantes:

- `orders`
- `order_items`
- `payments`
- `payment_events`
- `download_access`
- `download_events`
- `downloads`
- `product_likes`
- `customer_favorites`
- `withdrawal_requests`
- `platform_settings`

## 4. Validacoes Ja Executadas

Em 01/06/2026:

- `npm run lint`: passou.
- `npm test`: passou com 16 testes.
- `npm run build`: passou.
- `npm audit fix`: aplicado; `npm audit` ficou sem vulnerabilidades conhecidas.
- `npm run supabase:schema:validate`: passou com `ok: true`, sem colunas faltantes, RLS desativado ou policies ausentes.
- `npm run payments:reconcile`: disponivel em modo dry-run por padrao; use `-- --apply` para aplicar alteracoes.
- Dry-run da reconciliacao encontrou 24 pedidos pendentes antigos sem `transaction_nsu`/`slug`; estes nao podem ser confirmados automaticamente pelo `payment_check` e precisam de conferencia manual no admin.
- `npm run backup:db` e `npm run backup:bucket`: comandos operacionais criados para exportar banco em JSON e manifesto do bucket.

## 5. O Que Falta Para Concluir

### Prioridade Alta

1. Testar em producao o fluxo completo: cadastro, upload, compra, pagamento, download, venda no fotografo e receita no admin.
2. Confirmar `INFINITEPAY_WEBHOOK_SECRET` no deploy e testar webhook real.
3. Agendar o job de reconciliacao de pedidos pendentes consultando InfinitePay para pedidos com `transaction_nsu` e `slug`.
4. Agendar backup automatizado do banco e do bucket.
5. Testar restauracao em ambiente separado usando `docs/backup-restauracao.md`.
6. Registrar auditoria persistente de acoes administrativas.
7. Manter validacao de schema/RLS no checklist antes de deploy.

### Prioridade Media

1. Criar recibo imprimivel em `/pedidos/:id/recibo`.
2. Criar rota dedicada `/media/:id` para compartilhamento.
3. Melhorar o retorno de pagamento quando o usuario estiver deslogado.
4. Persistir likes/favoritos de forma completa por usuario e exibir estatisticas no fotografo/admin.
5. Adicionar rate limit especifico para upload, download, checkout e acoes sensiveis.
6. Criar testes de negacao para RLS e permissoes.

### Prioridade Baixa

1. Melhorar filtros da vitrine publica.
2. Adicionar recomendacoes com base em favoritos e likes.
3. Melhorar code splitting para reduzir bundle inicial.
4. Criar painel de saude operacional.

## 6. Plano De Testes Recomendado

### Automatizados

- Unitarios para CPF, telefone, paths de compartilhamento e fluxo de cliente.
- Testes de backend para checkout, confirmacao, webhook, download e permissoes.
- Testes de negacao para leitura cruzada de pedidos e edicao de produtos de outro fotografo.
- E2E com Playwright para cadastro, upload, compra simulada, retorno de pagamento e download.

### Manuais Antes De Deploy

1. Cadastrar cliente.
2. Cadastrar/aprovar fotografo.
3. Publicar foto e video.
4. Comprar midia pela vitrine.
5. Confirmar pagamento InfinitePay.
6. Abrir `/minhas-compras`.
7. Baixar arquivo comprado.
8. Conferir venda no painel do fotografo.
9. Conferir receita e pedido no admin.
10. Solicitar e processar saque.

## 7. Conclusao

O FunPace Media esta funcional como produto em fase pre-operacional. A maior parte da jornada principal ja existe no codigo. O trabalho restante esta concentrado em validacao real de producao, seguranca operacional, backups, auditoria, reconciliacao de pagamentos e cobertura E2E.
