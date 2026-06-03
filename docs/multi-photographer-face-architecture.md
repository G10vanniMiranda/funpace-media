# Arquitetura Multi-Fotografo com Busca Facial Global

Status: Fase 2 adiada.

Decisao atual: manter a arquitetura atual do Funpace Media e nao aplicar, neste momento, `scripts/add-multiphoto-face-architecture.sql`, pgvector, reconhecimento facial global, OCR global, banco vetorial ou estrutura avancada de comissionamento. A prioridade operacional passa a ser estabilizar checkout, PIX, webhooks, pedidos pagos, liberacao de downloads, area Meus Pedidos, CORS/API/producao, logs, reprocessamento de pedidos e paineis admin/fotografo.

Este documento permanece como planejamento tecnico para a fase seguinte, depois que o fluxo principal estiver validado em producao:

Cliente encontra foto -> compra -> pagamento aprovado -> pedido atualizado -> download liberado.

Este documento define a evolucao do Funpace Media para uma plataforma multi-fotografo com banco centralizado de imagens, busca facial global, OCR por numero de peito, vendas rastreaveis e comissionamento automatico.

## Estado Atual

O projeto ja possui partes importantes da arquitetura:

- `photographers`: conta, verificacao, comissao e dados do fotografo.
- `events`: eventos vinculados a `photographerId`.
- `products`: midias vendaveis vinculadas a `vendedorId`.
- `orders` e `order_items`: pedidos e itens vendidos.
- `download_access`: liberacao de downloads por pedido pago.
- `photographer_transactions` e `withdrawal_requests`: base de repasse.
- RLS em tabelas sensiveis e URLs assinadas para downloads.

O plano abaixo evolui essa base sem quebrar o contrato atual de `Product`.

## Principios

1. `products` continua sendo a foto/video vendavel.
2. Cada produto sempre tem proprietario: `ownerId` e `vendedorId`.
3. O indice facial e OCR e global, mas nao e exposto diretamente ao frontend.
4. A busca global retorna produtos publicados com URL assinada/protegida.
5. Toda venda gera snapshot financeiro por item para preservar historico.
6. Fotografos so visualizam/editam seus proprios eventos, produtos, vendas e repasses.
7. Administradores visualizam a operacao global.

## Modelagem De Banco

Patch incremental: `scripts/add-multiphoto-face-architecture.sql`.

### Tabelas Existentes Aproveitadas

- `photographers`
- `events`
- `products`
- `orders`
- `order_items`
- `payments`
- `download_access`
- `download_events`
- `photographer_transactions`
- `photographer_wallets`
- `withdrawal_requests`
- `admin_activity_logs`
- `platform_settings`

### Campos Adicionados

`products`:

- `eventId`: referencia opcional para `events.id`.
- `ownerId`: proprietario juridico/comercial da foto.
- `uploadDate`: data normalizada de upload.
- `faceIndexStatus`: estado da indexacao facial.
- `ocrIndexStatus`: estado da indexacao OCR.

`order_items`:

- `eventId`: evento no momento da compra.
- `ownerId`: fotografo proprietario no momento da compra.
- `platformFeePercent`: percentual aplicado no checkout.
- `platformFee`: valor da plataforma por item.
- `photographerAmount`: valor liquido do fotografo por item.

`photographer_transactions`:

- `productId`
- `eventId`
- `platformFeePercent`
- `currency`
- `availableAt`

### Tabelas Novas

`media_face_embeddings`:

- Indice facial global.
- Contem `productId`, `photographerId`, `eventId`, `ownerId`, `uploadDate`, `storagePath`, `faceEmbedding`, `faceBoundingBox`, provider e modelo.
- Usa `pgvector` com indice `ivfflat`.
- Acesso direto somente admin/service role.

`media_ocr_indexes`:

- Indice de numero de peito.
- Contem `productId`, `photographerId`, `eventId`, `ownerId`, `bib`, categoria, confianca, bounding box, provider e modelo.

`media_indexing_jobs`:

- Fila assicrona para `face`, `ocr`, `thumbnail`, `watermark` e `backfill`.
- Controla tentativas, lock, prioridade, retry e erro.

`face_search_queries`:

- Auditoria de buscas faciais.
- Nao salva selfie nem embedding.
- Salva metadados minimos: usuario/email quando houver, hash de IP, total de resultados, threshold, provider e tempo.

## Fluxo De Upload E Indexacao

1. Fotografo autenticado faz upload no dashboard.
2. Backend valida que `photographer.id === auth.uid()`.
3. Arquivo e salvo no storage central privado.
4. `products` recebe:
   - `vendedorId`
   - `ownerId`
   - `eventId`
   - `storagePath`
   - `uploadDate`
   - `status = published` ou `processing`
5. Sistema cria jobs em `media_indexing_jobs`:
   - `kind = face`
   - `kind = ocr`
6. Worker processa jobs:
   - baixa midia/thumbnail por caminho interno
   - extrai faces
   - salva embeddings em `media_face_embeddings`
   - executa OCR
   - salva resultados em `media_ocr_indexes`
   - atualiza `products.faceIndexStatus` e `products.ocrIndexStatus`

## Fluxo De Busca Facial Global

API: `POST /api/search/face`

Entrada:

- `file`: selfie/imagem temporaria.
- `limit`: maximo de resultados.
- `threshold`: similaridade minima.
- filtros opcionais: `eventId`, `dateFrom`, `dateTo`, `type`.

Processo:

1. Validar imagem, tamanho e rate limit.
2. Rejeitar se nao houver face.
3. Extrair embedding da face principal.
4. Consultar `media_face_embeddings` por similaridade global.
5. Juntar com `products`, `events` e `photographers`.
6. Retornar apenas produtos publicados.
7. Assinar URLs de thumbnail/preview.
8. Registrar `face_search_queries`.

Resposta:

```ts
type SearchByFaceResponse = {
  matches: Array<{
    product: Product;
    photographerId: string;
    eventId?: string | null;
    ownerId: string;
    similarityScore: number;
    faceBoundingBox?: unknown;
  }>;
  searchedFaceCount: number;
  threshold: number;
};
```

## Fluxo De OCR Por Numero De Peito

API: `GET /api/search/bib`

Parametros:

- `bib`
- `eventId?`
- `category?`
- `dateFrom?`
- `dateTo?`
- `photographerId?`
- `limit?`

Processo:

1. Normalizar numero.
2. Consultar `media_ocr_indexes`.
3. Fazer fallback para `products.bib` enquanto OCR ainda estiver em implantacao.
4. Retornar produtos publicados com URLs assinadas.

## Fluxo De Venda

1. Cliente adiciona fotos ao carrinho.
2. Checkout busca produtos publicados por `productId`.
3. Para cada item, snapshot em `order_items`:
   - `productId`
   - `vendedorId`
   - `ownerId`
   - `eventId`
   - `price`
   - `platformFeePercent`
   - `platformFee`
   - `photographerAmount`
4. Pagamento confirmado.
5. Fulfillment:
   - `orders.status = paid`
   - cria/ativa `download_access`
   - incrementa `products.salesCount`
   - cria `photographer_transactions` por item
6. Cliente baixa via API autenticada com URL assinada.

## Fluxo De Comissionamento

Calculo por item:

```txt
platformFee = price * platformFeePercent / 100
photographerAmount = price - platformFee
```

Fonte do percentual:

1. `photographers.commissionPercent`, se definido.
2. `platform_settings.platformFeePercent`, fallback global.

Registro:

- `order_items` guarda o snapshot.
- `photographer_transactions` cria uma entrada por item vendido.
- `photographer_wallets.pendingBalance` sobe quando o pagamento e confirmado.
- `status` muda para `available` apos regra de liberacao financeira.
- Saques usam `withdrawal_requests`.

## APIs Necessarias

### Fotografo

- `GET /api/photographers/me/dashboard`
- `GET /api/photographers/me/events`
- `POST /api/photographers/me/events`
- `PATCH /api/photographers/me/events/:eventId`
- `GET /api/photographers/me/products`
- `POST /api/photographers/me/products/upload`
- `POST /api/photographers/me/products/:productId/reindex`
- `GET /api/photographers/me/sales`
- `GET /api/photographers/me/transactions`
- `POST /api/photographers/me/withdrawals`

### Busca Publica

- `POST /api/search/face`
- `GET /api/search/bib`
- `GET /api/events`
- `GET /api/products`

### Admin

- `GET /api/admin/overview`
- `GET /api/admin/reports/photographers`
- `GET /api/admin/reports/events`
- `GET /api/admin/reports/sales`
- `GET /api/admin/indexing/jobs`
- `POST /api/admin/indexing/jobs/:jobId/retry`
- `POST /api/admin/indexing/backfill`
- `GET /api/admin/search-audit`

### Workers

- `POST /api/workers/media-indexing/poll`
- `POST /api/workers/media-indexing/:jobId/complete`
- `POST /api/workers/media-indexing/:jobId/fail`

Em producao, workers devem ser protegidos por segredo interno, fila gerenciada ou ambiente privado.

## Reconhecimento Facial: Providers

Interface recomendada:

```ts
type FaceDetection = {
  boundingBox: { x: number; y: number; width: number; height: number };
  confidence: number;
};

type FaceEmbedding = {
  vector: number[];
  provider: string;
  model: string;
};

interface EmbeddingProvider {
  detectFaces(image: Buffer): Promise<FaceDetection[]>;
  extractEmbedding(image: Buffer, face?: FaceDetection): Promise<FaceEmbedding>;
}
```

Providers suportados:

- `aws_rekognition`: bom para operacao gerenciada e escala.
- `insightface`: bom para custo controlado com worker proprio e banco vetorial.
- `mock`: testes e desenvolvimento.

Variaveis:

```env
FACE_SEARCH_ENABLED=true
FACE_SEARCH_PROVIDER=insightface
FACE_SEARCH_THRESHOLD=0.72
FACE_SEARCH_MAX_RESULTS=80
FACE_SEARCH_MAX_UPLOAD_MB=8
FACE_INDEXING_WORKER_SECRET=...
OCR_PROVIDER=aws_textract
OCR_ENABLED=true
```

## Performance E Escalabilidade

Para milhoes de fotos:

- Storage central privado, particionado por `photographerId/eventId/uploadBatchId`.
- Thumbnails otimizados para busca/listagem.
- `pgvector` com `ivfflat` como fase inicial.
- Para volume maior, migrar o indice para Pinecone, Weaviate, Qdrant ou OpenSearch k-NN.
- Jobs assiccronos com retry e backoff.
- Backfill separado para fotos antigas.
- Cache de resultados por hash da selfie temporaria quando permitido.
- Paginacao por cursor.
- Rate limit em busca facial.

## Seguranca

- RLS em todas as tabelas sensiveis.
- Fotografos editam apenas `products.vendedorId = auth.uid()`.
- Clientes so acessam downloads comprados.
- Embeddings faciais nao sao retornados ao frontend.
- Selfie de busca nao e armazenada permanentemente.
- Fotos originais ficam privadas.
- Downloads usam URL assinada de curta duracao.
- Admin usa role em `app_metadata`.
- Worker usa service role/segredo interno.

## Dashboards

### Admin

Metricas globais:

- total de fotografos
- total de eventos
- total de fotos/videos
- total de pedidos pagos
- faturamento bruto
- taxa da plataforma
- repasse pendente
- vendas por periodo
- vendas por fotografo
- jobs de indexacao pendentes/falhos

### Fotografo

Metricas individuais:

- eventos ativos
- total de fotos/videos
- vendas por periodo
- receita bruta
- comissao da plataforma
- valor liquido
- saldo pendente/disponivel
- historico de pagamentos
- fotos mais vendidas
- status de indexacao facial/OCR

## Plano De Implementacao

### Fase 1 - Banco e contratos

1. Aplicar `scripts/add-multiphoto-face-architecture.sql` em staging.
2. Validar `pgvector`.
3. Backfill de `products.ownerId`, `products.uploadDate`, `order_items.ownerId`.
4. Ajustar validação de schema.

### Fase 2 - Venda e comissao

1. Atualizar checkout para gravar snapshot financeiro em `order_items`.
2. Atualizar fulfillment para criar `photographer_transactions` por item.
3. Atualizar dashboard do fotografo com valores vindos de transacoes.
4. Criar relatorios admin por fotografo/evento.

### Fase 3 - Fila de indexacao

1. Criar job no upload.
2. Criar worker de processamento.
3. Criar endpoint admin de retry/backfill.
4. Mostrar status no dashboard do fotografo.

### Fase 4 - Busca facial

1. Criar `EmbeddingProvider`.
2. Implementar `mock` para testes.
3. Implementar `insightface` ou `aws_rekognition`.
4. Criar `POST /api/search/face`.
5. Integrar UI de selfie.

### Fase 5 - OCR

1. Implementar provider OCR.
2. Criar jobs `kind = ocr`.
3. Popular `media_ocr_indexes`.
4. Evoluir `GET /api/search/bib`.

### Fase 6 - Escala

1. Medir latencia do pgvector.
2. Aumentar listas/probes ou migrar para banco vetorial dedicado.
3. Separar worker em processo/servico independente.
4. Adicionar observabilidade e alertas.

## Garantia De Rastreabilidade

Cada foto vendida conserva:

- produto original: `products.id`
- fotografo: `vendedorId`
- proprietario: `ownerId`
- evento: `eventId` e `event`
- caminho storage: `storagePath`
- pedido: `order_items.orderId`
- download: `download_access.photoId`
- repasse: `photographer_transactions.orderItemId`

Assim a busca pode ser global, mas a propriedade e o comissionamento continuam individuais.
