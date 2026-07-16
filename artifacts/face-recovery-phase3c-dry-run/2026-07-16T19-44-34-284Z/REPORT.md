# Fase 3C — Relatório do dry-run final

Dry-run concluído em 2026-07-16, sem mutação no banco, AWS ou storage.

Manifesto SHA-256:
`2e096a39f3851fc76791b01c457c1a0214a9a165602007599097900cc892c747`.

## Propostas automáticas ≥99,9

| Operação | Registros |
|---|---:|
| Preencher `events.photographerId` nulo | 1 |
| Corrigir `products.eventId` | 0 |
| Corrigir `products.vendedorId` | 0 |
| Preencher `photo_faces.photographer_id` | 4.654 |
| Reconstruir `photo_faces` | 0 |

Evento proposto: `0df4be4f-0c8c-404b-94a8-3a179f423f99`, “NightRun #30 by
FUNPACE”. Valor atual nulo; valor proposto
`e996a6b5-fb69-4e79-bd73-80a92ea3ea39`.

Evidências simultâneas:

- 481/481 mídias publicadas pertencem ao fotógrafo proposto;
- 462/462 fotos indexadas com faces pertencem ao fotógrafo proposto;
- 4.654/4.654 faces persistidas concordam com produto, evento, AWS e storage;
- álbum e checkpoint são correspondências exatas;
- storage das fotos indexadas está íntegro e não ambíguo;
- fotógrafo ativo e aprovado;
- 15 produtos conflitantes estão removidos, desabilitados, sem faces e são
  anteriores ao conjunto indexado de produção.

O score 99,9 é determinístico e baseado em hard gates; não representa probabilidade
estatística. Nenhum valor preenchido será sobrescrito.

## Impacto previsto

| Indicador | Antes | Depois previsto | Redução |
|---|---:|---:|---:|
| Problemas de evento | 2.707 | 2.110 | 597 (22,05%) |
| Problemas de fotógrafo | 5.266 | 15 | 5.251 (99,72%) |
| `indexed` sem `photo_faces` | 1.744 | 1.744 | 0 |
| Faces AWS órfãs | 2.644 | 2.644 | 0 |

Redução prevista de problemas de evento + fotógrafo: 5.848/7.973 (73,35%).
Incluindo também fotos indexadas sem vínculo e faces órfãs: 47,31%.

## Revisão manual

Fila gerada: 2.110 produtos, todos abaixo de 98%:

| Motivo | Registros |
|---|---:|
| `eventId` ausente e `indexed` sem `photo_faces` | 1.744 |
| `eventId` ausente | 351 |
| Conflito de fotógrafo no NightRun #30 | 15 |

Os 2.095 registros sem evento pertencem a álbuns históricos sem evento exato no banco.
Nenhum evento foi criado ou aproximado. Cada item contém ProductId, candidato, motivos,
evidências, score, vizinhos de upload, storage, link, álbum e FaceIds AWS.

## Checkpoints, busca e rollback

- 188 checkpoints simulados de até 25 registros: 1 de evento e 187 de faces.
- `/api/face/search` não foi chamado no dry-run porque o estado reconciliado ainda não existe.
- Após aprovação, a validação deverá cobrir o NightRun #30 e evento recente de controle.
- O rollback restaura somente valores nulos originais e não contém operação AWS.

## Cadeia de auditoria

O snapshot contém `products`, `photo_faces`, `events`, `photographers`, FaceIds AWS,
storage e os manifestos assinados das fases anteriores. Também registra PostgreSQL 17.6,
commit `0efce23f04baf283eae357e8fd09ed9d3b7a95f4` e hash do motor de inferência
`fd20c466a74fd4da016be819ce1e7e2c66b53d532709b678c68cef752403c91d`.

Foram usados somente PostgreSQL `READ ONLY`, AWS `ListFaces` e leitura de metadados do
storage. Não houve `IndexFaces`, `DeleteFaces`, reindexação, exclusão ou alteração funcional.

## Gate

Estado: aguardando validação explícita. Token vinculado ao manifesto:

`PHASE3C_APPLY_2E096A39F385`
