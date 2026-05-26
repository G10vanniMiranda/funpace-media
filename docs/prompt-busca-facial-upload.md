# Prompt Tecnico - Busca Facial por Upload de Imagem

Use este prompt quando for evoluir o FunPace para permitir que o usuario envie uma selfie/imagem de uma pessoa e o sistema liste fotos e videos onde essa pessoa aparece.

## Prompt Principal

Voce e um engenheiro senior full-stack trabalhando no projeto FunPace, uma plataforma de venda de fotos e videos de eventos esportivos. O projeto ja possui:

- Frontend em React/Vite.
- Backend Node/Express em `server.ts`.
- Rotas serverless na pasta `api`.
- Supabase Auth para autenticacao.
- Supabase Postgres para persistencia.
- Storage externo para imagens/videos via `/api/media/upload`.
- Entidade principal `Product` em `src/types.ts`, com campos `url`, `thumbnailUrl`, `storagePath`, `bib`, `event`, `checkpoint`, `type` e `vendedorId`.
- Busca por numero de peito via `productService.searchByBib`.
- Fluxo visual de busca por selfie em `src/App.tsx`, mas ainda sem reconhecimento facial real.

Objetivo: implementar uma funcionalidade de **busca facial por imagem enviada pelo usuario**, onde o usuario faz upload de uma selfie ou foto de referencia, o backend extrai um vetor facial da imagem, compara esse vetor com vetores previamente extraidos das midias publicadas e retorna uma lista ranqueada de produtos relacionados.

## Resultado esperado

Implementar uma arquitetura segura, escalavel e evolutiva para:

1. Receber upload temporario de uma imagem de referencia.
2. Detectar uma face na imagem enviada.
3. Extrair um **face embedding** da face detectada.
4. Comparar o embedding da imagem enviada contra embeddings das fotos/videos cadastrados.
5. Retornar produtos com similaridade acima de um threshold configuravel.
6. Listar os produtos encontrados na interface existente de fotos/videos.
7. Preservar privacidade, seguranca e controle de custo.

## Termos tecnicos obrigatorios

Use estes nomes tecnicos na implementacao e nos arquivos:

- `FaceSearch`
- `FaceEmbedding`
- `FaceDetection`
- `FaceMatch`
- `SimilarityScore`
- `SimilarityThreshold`
- `FaceIndex`
- `ReferenceImage`
- `CandidateMedia`
- `MatchedProduct`
- `EmbeddingProvider`
- `FaceSearchJob`
- `FaceSearchResult`
- `VectorSimilarity`
- `CosineSimilarity`
- `pgvector`
- `MediaFaceEmbedding`
- `FaceBoundingBox`
- `SearchByFaceRequest`
- `SearchByFaceResponse`

## Arquitetura recomendada

Implementar em fases.

### Fase 1 - Contrato backend

Criar endpoint:

```txt
POST /api/search/face
```

Entrada:

```txt
multipart/form-data
file: imagem de referencia
event?: nome/id do evento para limitar escopo
type?: IMG | VIDEO | all
limit?: numero maximo de resultados
threshold?: limiar minimo de similaridade
```

Resposta:

```ts
type SearchByFaceResponse = {
  matches: Array<{
    product: Product;
    similarityScore: number;
    faceBoundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
  searchedFaceCount: number;
  threshold: number;
};
```

Regras:

- Aceitar apenas imagens.
- Limitar tamanho maximo do arquivo.
- Rejeitar arquivo sem face detectada.
- Rejeitar imagem com muitas faces na primeira versao ou usar a face principal.
- Nao salvar a selfie permanentemente sem consentimento.
- Fazer rate limit por IP e usuario.

### Fase 2 - Modelo de dados

Adicionar tabela para indexacao facial:

```sql
create table public.media_face_embeddings (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid not null references public.products(id) on delete cascade,
  "vendedorId" text not null references public.photographers(id) on delete cascade,
  "mediaUrl" text not null,
  "storagePath" text,
  "embedding" vector(512) not null,
  "faceBoundingBox" jsonb,
  "embeddingProvider" text not null,
  "embeddingModel" text not null,
  "createdAt" timestamptz not null default now()
);
```

Se o provedor usar outra dimensao de embedding, ajustar `vector(512)` para a dimensao correta.

Indices recomendados:

```sql
create index media_face_embeddings_product_id_idx
on public.media_face_embeddings ("productId");

create index media_face_embeddings_vendedor_id_idx
on public.media_face_embeddings ("vendedorId");

create index media_face_embeddings_embedding_idx
on public.media_face_embeddings
using ivfflat ("embedding" vector_cosine_ops);
```

Ativar extensao:

```sql
create extension if not exists vector;
```

### Fase 3 - Indexacao das midias publicadas

Criar job/processo para extrair embeddings das midias publicadas.

Opcoes:

- Indexar no momento do upload do produto.
- Indexar em background com fila.
- Criar script manual para reprocessar produtos antigos.

Nome sugerido:

```txt
FaceSearchJob
```

Fluxo:

1. Buscar produtos publicados.
2. Baixar `thumbnailUrl` ou `url`.
3. Detectar faces.
4. Para cada face detectada, extrair embedding.
5. Salvar em `media_face_embeddings`.
6. Marcar produto como indexado ou registrar erro.

Para videos:

- Usar thumbnail gerada no upload como primeira etapa.
- Futuramente extrair frames em intervalos usando FFmpeg.

### Fase 4 - Provider de reconhecimento facial

Criar uma interface:

```ts
interface EmbeddingProvider {
  detectFaces(image: Buffer): Promise<FaceDetection[]>;
  extractEmbedding(image: Buffer, face?: FaceDetection): Promise<FaceEmbedding>;
}
```

Implementacoes possiveis:

- AWS Rekognition.
- Azure Face API.
- Google Cloud Vision/Vertex AI.
- Modelo local com `face-api.js`, `onnxruntime-node` ou InsightFace.
- Servico proprio de embeddings.

Nao acoplar o app diretamente a um provider. Criar adaptador:

```txt
src/server/face-search/providers/<provider>.ts
```

Variaveis sugeridas:

```env
FACE_SEARCH_PROVIDER=aws_rekognition
FACE_SEARCH_ENABLED=true
FACE_SEARCH_THRESHOLD=0.72
FACE_SEARCH_MAX_RESULTS=50
FACE_SEARCH_MAX_UPLOAD_MB=8
```

### Fase 5 - Busca por similaridade

Quando o usuario enviar a selfie:

1. Backend valida arquivo.
2. Backend extrai embedding da face de referencia.
3. Backend consulta `media_face_embeddings`.
4. Compara usando `cosine distance`.
5. Ordena por maior similaridade.
6. Busca os produtos correspondentes em `products`.
7. Retorna `MatchedProduct[]`.

Exemplo de query com `pgvector`:

```sql
select
  mfe."productId",
  1 - (mfe.embedding <=> $1::vector) as "similarityScore",
  mfe."faceBoundingBox"
from public.media_face_embeddings mfe
join public.products p on p.id = mfe."productId"
where p.status = 'published'
  and (1 - (mfe.embedding <=> $1::vector)) >= $2
order by mfe.embedding <=> $1::vector
limit $3;
```

### Fase 6 - Frontend

Substituir o fluxo simulado atual em `src/App.tsx`.

Hoje existe:

- `handleSelfieSearch(file: File)`
- `isAnalyzingSelfie`
- `selfieNotice`
- modal avisando que a busca facial ainda nao esta ativa

Evoluir para:

- Enviar arquivo real para `/api/search/face`.
- Mostrar estado `analyzing`.
- Mostrar erro se nenhuma face for detectada.
- Mostrar erro se nenhuma midia relacionada for encontrada.
- Separar resultados em fotos e videos.
- Usar o mesmo layout de `PhotoGrid` e `VideoGrid`.

Adicionar service:

```ts
productService.searchByFace(file: File, options?: {
  event?: string;
  type?: 'IMG' | 'VIDEO' | 'all';
  limit?: number;
}): Promise<Product[]>
```

## Cuidados de privacidade

Implementar com estas regras:

- Nao salvar selfie enviada pelo usuario sem consentimento explicito.
- Processar a imagem temporariamente em memoria ou storage temporario com expiracao.
- Informar que a busca facial e aproximada.
- Permitir remocao de midias sob solicitacao.
- Registrar apenas metadados tecnicos necessarios.
- Evitar expor embeddings para o frontend.
- Proteger endpoint com rate limit.
- Limitar busca a produtos publicados.

## Criterios de aceite

A funcionalidade esta pronta quando:

- Usuario consegue enviar uma selfie pelo fluxo existente.
- Backend retorna produtos similares com `similarityScore`.
- Produtos aparecem na vitrine sem quebrar carrinho/checkout.
- Imagem sem rosto retorna erro amigavel.
- Imagem com rosto desconhecido retorna lista vazia amigavel.
- Upload muito grande e rejeitado.
- Endpoint nao expoe token de provider.
- Embeddings ficam apenas no banco/backend.
- `npm run lint`, `npm test` e `npm run build` passam.

## Prompt de execucao para Codex

Copie e cole este prompt quando for implementar:

```txt
Analise o projeto FunPace e implemente a Fase 1 da busca facial por upload de imagem.

Contexto:
- React/Vite no frontend.
- Express em server.ts.
- Supabase Auth/Postgres para autenticacao e banco.
- Products usam url, thumbnailUrl, storagePath, bib, event, checkpoint, type e vendedorId.
- O fluxo visual de selfie existe em src/App.tsx, mas hoje e simulado.

Objetivo da Fase 1:
- Criar contrato backend POST /api/search/face.
- Criar productService.searchByFace(file, options).
- Substituir o fluxo simulado de selfie para chamar o endpoint real.
- Nao implementar provider real de reconhecimento ainda; criar uma interface EmbeddingProvider e um MockEmbeddingProvider controlado por env FACE_SEARCH_PROVIDER=mock.
- Retornar erro amigavel quando FACE_SEARCH_ENABLED nao estiver true.
- Documentar proximos passos para integrar pgvector e provider real.

Requisitos:
- Nao expor tokens no frontend.
- Validar tipo e tamanho do arquivo.
- Manter compatibilidade com busca por numero de peito.
- Manter UI existente de loading.
- Retornar Product[] para a tela reaproveitar PhotoGrid e VideoGrid.
- Rodar npm run lint, npm test e npm run build.

Entregue:
- Lista de arquivos alterados.
- Explicacao curta do fluxo.
- Pontos pendentes para Fase 2.
```

## Roadmap sugerido

1. Fase 1: endpoint e frontend usando mock controlado por env.
2. Fase 2: criar tabela `media_face_embeddings` e scripts SQL.
3. Fase 3: criar `EmbeddingProvider` real.
4. Fase 4: indexar fotos publicadas.
5. Fase 5: busca real com `pgvector`.
6. Fase 6: indexacao de frames de video.
7. Fase 7: painel admin para status da indexacao facial.
