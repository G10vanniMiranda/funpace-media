# Auditoria tecnica - busca facial - 2026-06-24

## Escopo

Evento auditado: NightRun #33 by FUNPACE 23/06

- Event ID: `ac54d591-c573-4543-ab71-8072af8b0c12`
- Photographer ID: `e996a6b5-fb69-4e79-bd73-80a92ea3ea39`
- Data do evento: `2026-06-23`
- Status do evento: publicado
- Provedor ativo: AWS Rekognition
- Collection: `funpace-faces`
- Regiao: `sa-east-1`
- Threshold configurado: `90`

## Resumo executivo

A causa raiz mais provavel para usuarios sem resultado no evento auditado e indexacao incompleta das fotos do evento.

Das 705 fotos publicadas do evento, apenas 113 estao com `faceIndexStatus = indexed`. Outras 586 fotos publicadas ainda estao `pending`, portanto nao participam da busca facial. A AWS Collection e o banco estao coerentes para o subconjunto indexado: existem 539 faces em `photo_faces` para 113 fotos, e a auditoria da Collection encontrou 539 faces com `ExternalImageId` correspondente as fotos desse evento.

Conclusao: o problema principal nao e upload da selfie nem corrupcao dos registros ja indexados; e falta de cobertura de indexacao das fotos do evento.

## Evidencias principais

Consulta somente leitura em Supabase e AWS Rekognition:

- Total de produtos do evento: 705
- Total de imagens publicadas: 705
- Fotos publicadas indexadas: 113
- Fotos publicadas sem rosto: 6
- Fotos publicadas com erro: 0
- Fotos publicadas pendentes: 586
- Linhas em `photo_faces`: 539
- Fotos com faces em `photo_faces`: 113
- Faces distintas em `photo_faces`: 539
- Fotos `indexed` sem linha em `photo_faces`: 0
- Faces da Collection AWS correspondentes ao evento: 539
- Total de faces na Collection AWS: 14668
- Modelo Rekognition da Collection: 7.0

Integridade:

- `photo_faces` apontando para evento errado: 0
- Produtos do evento com fotografo diferente do evento: 0
- Imagens publicadas sem URL/caminho: 0
- Duplicidade `photo_id + face_id`: 0

Observacao: `image_id` se repete por design quando uma foto tem multiplos rostos; isso nao indica duplicidade corrompida.

## Pipeline auditada

### 1. Upload da selfie

Fluxo atual:

- Frontend envia `multipart/form-data` com `eventId`, `sessionId` e arquivo `selfie`.
- Backend le via Busboy em `parseSelfieMultipart`.
- Backend valida MIME e tamanho em `validateImage`.
- Selfie e enviada temporariamente para S3 privado em `face-search/selfies/<eventId>/<uuid>`.
- Selfie e removida no `finally`.

Pontos verificados:

- Formatos aceitos: `image/jpeg`, `image/jpg`, `image/png`.
- Limite atual: `8388608` bytes.
- Galeria: arquivo original e enviado, sem redimensionamento no frontend.
- Camera: a selfie capturada e recomprimida por canvas como JPEG qualidade `0.9`.
- Nao ha leitura de EXIF/orientacao no backend.
- Nao ha log atual de resolucao, hash, formato real por assinatura magica ou tempo por etapa.

Risco: selfies tiradas pela camera perdem EXIF e sao recomprimidas; nao ha evidencia de que isso seja a causa do evento auditado, mas a pipeline nao mede isso hoje.

### 2. Deteccao de rosto

No fluxo ativo nao ha chamada separada a `DetectFaces`. A deteccao acontece implicitamente em:

- `IndexFaces` para fotos do evento.
- `SearchFacesByImage` para selfies.

Quando a AWS nao detecta rosto, `InvalidParameterException` vira HTTP 422 com mensagem generica.

Limite atual: nao registra quantidade de rostos, bounding box, pose ou qualidade da selfie. Para fotos indexadas, salva apenas `FaceId`, `ImageId` e `Confidence`.

### 3. Embedding facial

Nao existe embedding vetorial local no banco. O embedding e gerenciado internamente pela AWS Rekognition Collection.

Equivalentes persistidos:

- `photo_faces.face_id`
- `photo_faces.image_id`
- `photo_faces.event_id`
- `photo_faces.photo_id`
- `photo_faces.confidence`

Resultado: os 539 `FaceId` do evento estao coerentes entre banco e AWS para as 113 fotos indexadas.

### 4. Indexacao das fotos do evento

Resultado do evento:

| Metrica | Valor |
| --- | ---: |
| Fotos publicadas | 705 |
| Fotos indexadas | 113 |
| Fotos sem rosto | 6 |
| Fotos com erro | 0 |
| Fotos pendentes | 586 |
| Fotos indexadas sem face row | 0 |

Esta e a falha dominante: 83,1% das fotos publicadas do evento ainda estao fora do indice facial.

### 5. Busca por similaridade

Algoritmo ativo:

- AWS `SearchFacesByImage`
- Distancia/score: `Similarity` da AWS, escala 0 a 100
- Threshold atual: `FACE_SIMILARITY_THRESHOLD || 90`
- Max candidates: `FACE_SEARCH_MAX_CANDIDATES || 1000`
- Depois da AWS, o backend filtra por `event_id` em `photo_faces`.
- Depois disso, busca somente produtos `status = published`.

Ponto importante: a AWS so retorna faces acima de `FaceMatchThreshold`. Logo o sistema atual nao consegue exibir scores abaixo do threshold sem executar uma busca diagnostica com threshold menor.

### 6. Threshold

Teste controlado usando uma foto ja indexada do proprio evento como imagem de consulta:

| Threshold | Raw matches AWS | Faces do evento | Fotos do evento |
| ---: | ---: | ---: | ---: |
| 90 | 2 | 2 | 2 |
| 85 | 2 | 2 | 2 |
| 80 | 2 | 2 | 2 |
| 75 | 2 | 2 | 2 |

Top scores: `100`, `99.64`.

Esse teste nao substitui as selfies reais A/B/C, mas indica que, para este caso controlado, baixar threshold nao aumentou resultados. Com os dados disponiveis, a configuracao do threshold nao e a causa raiz principal.

### 7. Banco de dados

Validacoes:

- Embeddings locais: nao aplicavel, AWS gerencia.
- `FaceId` salvos: sim, 539 no evento.
- Duplicidade corrompida: nao encontrada para `photo_id + face_id`.
- Fotos `indexed` sem face row: 0.
- Referencias de imagem: todas as 705 imagens publicadas do evento possuem caminho/URL.
- Evento correto: OK.
- Fotografo correto: OK.

### 8. Fluxo do evento

Busca usa apenas o evento correto:

- `searchFaceHandler` recebe `eventId`.
- `getEvent(eventId)` valida evento publicado.
- `getMatchesByEvent(eventId, matches)` filtra `photo_faces.event_id = eventId`.
- Produtos retornados precisam estar `status = published`.

Integridade encontrada:

- Event ID correto.
- Photographer ID correto.
- Album ID: nao ha campo separado no fluxo auditado.
- Bucket AWS privado: `funpace-media`.
- Caminho de indexacao: `face-index/events/<eventId>/photos/<photoId>`.
- Caminho de selfie temporaria: `face-search/selfies/<eventId>/<uuid>`.

### 9. AWS Rekognition

Uso atual:

- `IndexFaces` na indexacao.
- `SearchFacesByImage` na busca.
- `DeleteFaces` antes de substituir faces antigas.
- `CreateCollection`, `DescribeCollection`, `ListCollections` para ciclo da Collection.
- Nao usa `CompareFaces`.

Estatisticas:

- Collection existe: sim.
- Collection listada: sim.
- Faces totais na Collection: 14668.
- Faces do evento auditado na Collection: 539.
- Faces do evento no banco: 539.
- Divergencia AWS x banco para evento: 0 no subconjunto indexado.

### 10. Logs

Logs atuais cobrem parcialmente:

- Upload S3 inicio/fim.
- Indexacao AWS com quantidade de faces.
- Busca AWS com count e threshold.
- Resultado final com count e tempo total.
- Backfill com download, status e tempo por foto.

Lacunas:

- Hash da selfie.
- Resolucao da selfie.
- Formato real por assinatura.
- EXIF/orientacao.
- Tempo por etapa dentro da busca.
- Scores descartados abaixo do threshold.
- Bounding box, pose e qualidade.
- Motivo granular de rejeicao de rosto.

### 11. Performance

Medicao atual:

- Busca registra apenas tempo total (`processingMs`) no handler.
- Backfill registra tempo por foto.
- S3 registra inicio/fim sem duracao.

Lacunas:

- Upload multipart.
- Upload S3.
- SearchFacesByImage.
- Consulta Supabase.
- Filtro/comparacao.
- Assinatura de URLs no frontend.

### 12. Casos de teste conhecidos

Nao foram executados casos `Selfie A/B/C` porque os arquivos de selfie reais e resultados esperados nao foram fornecidos no workspace. O print anexado mostra a tela, mas nao fornece o arquivo original da selfie nem uma lista de fotos esperadas.

Teste substituto executado:

- Consulta com foto ja indexada do evento.
- Thresholds 90/85/80/75.
- Resultado constante: 2 fotos do evento.

## Causa raiz

As fotos existem no evento, mas a maioria nao esta indexada no Rekognition.

O backend de busca so pode retornar fotos que tenham:

1. rosto indexado na AWS Collection;
2. linha correspondente em `photo_faces`;
3. `event_id` igual ao evento pesquisado;
4. produto publicado.

Para o evento auditado, 586 de 705 fotos publicadas falham no requisito 1/2 porque estao `pending`.

## Impacto

Usuarios que aparecem apenas nas 586 fotos pendentes recebem zero resultado, mesmo com fotos publicadas no evento.

Usuarios que aparecem nas 113 fotos indexadas podem receber resultados normalmente, o que explica o comportamento intermitente: alguns usuarios encontram fotos, outros nao.

## Gravidade

Alta.

Motivo: 83,1% do evento auditado esta fora do indice facial, afetando diretamente a funcionalidade principal de acesso as fotos por selfie.

## Melhor solucao

Executar e monitorar o backfill facial ate zerar pendencias do evento, sem alterar threshold ou algoritmo antes disso.

Depois do backfill:

1. repetir a auditoria;
2. executar testes com selfies reais de usuarios conhecidos;
3. somente entao avaliar threshold.

## Melhorias recomendadas

- Criar modo diagnostico protegido por segredo operacional para `SearchFacesByImage` com thresholds 90/85/80/75.
- Adicionar logs estruturados por etapa no handler de busca.
- Registrar hash SHA-256, bytes, MIME, assinatura magica, resolucao e tempo de upload da selfie.
- Executar `DetectFaces` diagnostico antes de `SearchFacesByImage` quando a busca falhar.
- Expor painel/admin de status por evento: total, indexed, pending, no_face, failed.
- Alertar fotografo/admin quando evento publicado tiver fotos `pending`.
- Mover indexacao para fila com retries e concorrencia controlada.
- Impedir que evento seja marcado como pronto para busca facial enquanto houver pendencias relevantes.

## Artefatos criados

- `scripts/audit-face-search-readonly.mjs`: script diagnostico somente leitura para Supabase e AWS Rekognition.

## Verificacoes executadas

- `node scripts/audit-face-search-readonly.mjs ac54d591-c573-4543-ab71-8072af8b0c12`
- `GET https://api.funpace.media/api/face/test`: 200 OK
- `npm run lint`: passou
- `npm test`: falhou em 7 testes existentes nao relacionados a indexacao facial do evento auditado.

## Execucao do proximo passo - backfill

Backfill executado em 2026-06-24 via endpoint operacional `POST /api/face/backfill`.

Estado antes:

| Status | Fotos |
| --- | ---: |
| indexed | 113 |
| no_face | 6 |
| failed | 0 |
| pending | 586 |
| processing | 0 |
| total | 705 |

Foram executados 12 lotes. Resultado agregado dos lotes para o evento:

- 585 fotos passaram de `pending` para `indexed`.
- 1 foto passou de `pending` para `no_face`.
- 0 fotos falharam.
- 0 fotos ficaram pendentes.

Estado depois:

| Status | Fotos |
| --- | ---: |
| indexed | 698 |
| no_face | 7 |
| failed | 0 |
| pending | 0 |
| processing | 0 |
| total | 705 |

Auditoria pos-backfill:

- Linhas em `photo_faces`: 2050
- Fotos com faces em `photo_faces`: 698
- Faces distintas em `photo_faces`: 2050
- Faces da Collection AWS correspondentes ao evento: 2050
- Fotos `indexed` sem linha em `photo_faces`: 0
- `photo_faces` apontando para evento errado: 0
- Produtos do evento com fotografo diferente do evento: 0

Conclusao pos-backfill: a causa raiz operacional foi corrigida para o evento auditado. A busca facial agora tem cobertura de indice para todas as fotos publicadas em que a AWS detectou rosto.
