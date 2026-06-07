# AWS Rekognition - Busca Facial

## Arquitetura

O catalogo continua usando `products` e o storage de midia existente. Depois que uma foto e publicada, o frontend autenticado chama `POST /api/face/index` com o arquivo, `photoId` e `eventId`. O backend:

1. valida usuario, propriedade da foto, evento, MIME e tamanho;
2. envia uma copia privada para `s3://funpace-media/face-index/events/...`;
3. cria a collection `funpace-faces` caso ainda nao exista;
4. executa `IndexFaces`;
5. salva os identificadores retornados em `photo_faces`;
6. atualiza `products.faceIndexStatus`.

Na busca, o cliente abre um evento e envia a selfie. `POST /api/face/search` recebe multipart, salva a selfie temporariamente no S3, executa `SearchFacesByImage`, filtra os candidatos pelo `event_id`, retorna apenas produtos publicados e remove a selfie no bloco `finally`.

## Arquivos Criados

- `src/services/aws/rekognition.service.ts`: collection, indexacao, busca, remocao e teste Rekognition.
- `src/services/aws/s3.service.ts`: upload privado, remocao e teste S3.
- `server/face/face-utils.ts`: multipart, validacao, limites e erros.
- `server/face/face-repository.ts`: acesso privado ao Supabase.
- `server/face/face-handlers.ts`: handlers compartilhados Express/Vercel.
- `api/face.ts`: entrada serverless consolidada.
- `scripts/add-aws-rekognition-face-search.sql`: migration incremental.
- `tests/aws-rekognition-face-search.test.ts`: contratos da integracao.

## Arquivos Alterados

- `server.ts`, `vercel.json`: rotas.
- `src/types.ts`, `src/lib/services.ts`: contratos e chamadas.
- `src/components/PhotographerDashboard.tsx`: indexacao automatica.
- `src/App.tsx`: busca real por selfie.
- `scripts/supabase-schema.sql`: schema-base.
- `.env.example`, `package.json`, `package-lock.json`: configuracao e dependencias.

## Rotas

- `POST /api/face/index`: autenticada, body binario da foto, headers `X-Photo-Id` e `X-Event-Id`.
- `POST /api/face/search`: multipart com `eventId` e arquivo `selfie`.
- `GET /api/face/test`: valida credenciais, S3, Rekognition e collection. Em producao exige `Authorization: Bearer <OPERATIONS_SECRET>`.

## Banco

Campos adicionados em `products`:

- `eventId`
- `faceIndexStatus`
- `faceIndexError`
- `faceIndexedAt`

Tabela privada `photo_faces`:

- `face_id`
- `image_id`
- `event_id`
- `photo_id`
- `confidence`
- `created_at`

Aplicar primeiro em staging:

```powershell
node scripts/apply-supabase-patch.mjs add-aws-rekognition-face-search.sql
```

## Variaveis

```env
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=sa-east-1
AWS_BUCKET_NAME=funpace-media
AWS_REKOGNITION_COLLECTION=funpace-faces
AWS_REQUEST_TIMEOUT_MS=20000
FACE_SIMILARITY_THRESHOLD=90
FACE_SEARCH_MAX_CANDIDATES=1000
FACE_SEARCH_MAX_UPLOAD_BYTES=8388608
```

## IAM Minimo

Permitir no bucket `funpace-media`: `s3:ListBucket`, `s3:PutObject`, `s3:DeleteObject`, `s3:GetObject`. Permitir no Rekognition: `CreateCollection`, `DescribeCollection`, `ListCollections`, `IndexFaces`, `SearchFacesByImage` e `DeleteFaces`.

Configure lifecycle no prefixo `face-search/selfies/` para expirar objetos rapidamente como defesa adicional. A aplicacao tambem os remove ao fim de toda busca.

## Como Testar

1. Aplicar a migration em staging.
2. Configurar AWS e `OPERATIONS_SECRET`.
3. Executar `GET /api/face/test` com o bearer operacional.
4. Publicar uma foto JPG/PNG vinculada a um evento e confirmar `products.faceIndexStatus`.
5. Enviar uma selfie dentro da pagina do mesmo evento.
6. Confirmar que somente fotos publicadas daquele evento sao retornadas.
7. Testar imagem sem rosto, arquivo corrompido, MIME invalido, timeout e selfie acima do limite.
8. Executar `npm run lint`, `npm test` e `npm run build`.

## Operacao

Fotos sem rosto ficam com status `no_face`. Falhas AWS ficam com status `failed` e mensagem resumida em `faceIndexError`, sem impedir que a foto seja publicada. Para grande volume, o proximo passo recomendado e mover `POST /api/face/index` para uma fila com retries e concorrencia controlada.
