# Fase 3B — Relatório de execução real

Execução concluída e auditada em 2026-07-15, vinculada ao manifesto aprovado
`1383953648343b1b6cf367c2f088282ad68c26279730690394a047514b6b6c16`.

## Resultado efetivo

| Operação | Previsto | Efetivo | Ignorado | Rejeitado |
|---|---:|---:|---:|---:|
| `products.eventId` | 349 | 349 | 0 | 0 |
| `photo_faces.photographer_id` | 8.488 | 8.488 | 0 | 0 |
| Reconstrução de `photo_faces` | 393 | 393 | 0 | 0 |

Foram executados 370/370 checkpoints: 14 de eventos, 340 de fotógrafo e 16 de reconstrução.
As duas retomadas reconheceram 698 registros de evento já aplicados e não fizeram nova escrita.

## Auditoria antes/depois

| Indicador | Antes | Depois |
|---|---:|---:|
| Problemas de evento | 3.056 | 2.707 |
| Problemas de fotógrafo | 13.754 | 5.266 |
| `indexed` sem `photo_faces` | 2.066 | 1.744 |
| Faces AWS órfãs no banco | 3.037 no dry-run | 2.644 |
| Divergências face/evento | 0 | 0 |
| Divergências face/fotógrafo | 13.142 | 4.654 |
| FaceIds duplicados no banco | 0 | 0 |
| Pares `photo_id + face_id` duplicados | 0 | 0 |
| FaceIds duplicados na AWS | 0 | 0 |

No snapshot final: `processing = 0`. Permanece um único `pending`, produto removido
`35ef862b-239b-4b32-8a09-4c1a631e0b17`, já classificado como não elegível e fora da Fase 3B.

Durante a execução normal do sistema foram criados, fora do manifesto, 49 produtos, 107 linhas
em `photo_faces` e 107 faces AWS. Os volumes do escopo aprovado não tiveram diferença em relação
ao dry-run.

## Buscas faciais

As três validações passaram usando o threshold de produção (90), sem alteração:

- Eventos: produto `01b35631-612f-48aa-ba53-73846c5bd1d6`, evento
  `e57eca5f-6b09-4b8b-ad80-8026170cfc1b`, FaceId
  `d79f8393-fa7d-4c78-b048-ddc6a373cf9b`, similaridade 100%.
- Photographer: produto `0013c01a-a2fb-4725-8c3b-b4a23e6d4beb`, evento
  `79c4e1be-53f0-4117-83cb-1847f3163f5e`, FaceId
  `88c76f59-c196-42f6-b1ee-40bab49d9948`, similaridade 100%.
- Reconstrução: o produto `01b35631-612f-48aa-ba53-73846c5bd1d6` foi retornado pelo filtro
  completo AWS → FaceId → evento → `photo_faces` → produto, similaridade 100%.

## Paradas seguras

O executor parou duas vezes antes de prosseguir para a etapa seguinte:

1. erro SQL na consulta somente leitura da validação (`SELECT DISTINCT`/`ORDER BY`);
2. ausência de amostra já mapeada antes da etapa de reconstrução.

As correções foram limitadas ao executor local. Nenhuma inconsistência de dados foi encontrada,
e a retomada foi idempotente.

## Operações AWS e restrições

Foram usadas somente `ListFaces` e `SearchFacesByImage`. O executor não importa nem chama
`IndexFacesCommand` ou `DeleteFacesCommand`. Nenhum FaceId AWS foi criado ou removido pela Fase 3B.
Frontend, upload, threshold, pipeline e arquitetura não foram alterados.

## Rollback e hashes

- Manifesto final SHA-256:
  `f113222d72d94b7b27aabe3ef8594a5a25023e55a14569416e3d7856839442fb`
- Auditoria final SHA-256:
  `4d0edec4db743e942a88e16eafa3a263860c515115fac1099524a050acda9d4c`
- O rollback permanece limitado aos valores do manifesto aprovado e não contém exclusão AWS.

## Conclusão

A Fase 3B foi concluída e aprovada. Os 2.707 problemas de evento e 4.654 vínculos de fotógrafo
restantes não pertencem ao conjunto automático seguro e devem seguir para a Fase 3C, com revisão
manual e sem reconciliação automática por aproximação.
