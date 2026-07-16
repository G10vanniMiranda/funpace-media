# Fase 3C — Relatório do dry-run

Dry-run concluído em 2026-07-16, sem qualquer mutação no banco, AWS ou storage.

Manifesto SHA-256:
`1b6b9441a9fba27773b47ce39d589afb0f77c9005cf246088b7c86631287abfe`.

## Propostas automáticas ≥99,9

| Operação | Registros |
|---|---:|
| Preencher `events.photographerId` nulo | 1 |
| Corrigir `products.eventId` | 0 |
| Corrigir `products.vendedorId` | 0 |
| Preencher `photo_faces.photographer_id` | 4.654 |
| Reconstruir `photo_faces` | 0 |

O único evento proposto é `0df4be4f-0c8c-404b-94a8-3a179f423f99`,
“NightRun #30 by FUNPACE”. O valor atual é nulo; o valor proposto é
`e996a6b5-fb69-4e79-bd73-80a92ea3ea39`.

Evidências simultâneas:

- 481/481 mídias publicadas pertencem ao fotógrafo proposto;
- 462/462 fotos indexadas com faces pertencem ao fotógrafo proposto;
- 4.654/4.654 FaceIds persistidos concordam com produto, evento e fotógrafo;
- álbum e checkpoint são correspondências exatas;
- storage de todas as fotos indexadas está íntegro e não ambíguo;
- o fotógrafo está ativo e aprovado;
- os 15 produtos conflitantes estão todos removidos, desabilitados, sem faces e
  são anteriores ao conjunto indexado de produção.

A pontuação 99,9 é um score determinístico de política, não uma probabilidade estatística.
Nenhum `photographerId` preenchido será sobrescrito.

## Impacto previsto

| Indicador | Antes | Depois previsto | Redução |
|---|---:|---:|---:|
| Problemas de evento | 2.707 | 2.110 | 597 (22,05%) |
| Problemas de fotógrafo | 5.266 | 15 | 5.251 (99,72%) |
| `indexed` sem `photo_faces` | 1.744 | 1.744 | 0 |
| Faces AWS órfãs no banco | 2.644 | 2.644 | 0 |

Considerando problemas de evento e fotógrafo, a redução prevista é 5.848 de
7.973 ocorrências (73,35%). Incluindo também `indexed` sem vínculo e faces órfãs,
a redução é 47,31%.

## Fila de revisão manual

Foram gerados 2.110 itens, todos abaixo de 98% e sem alteração automática:

| Motivo | Registros |
|---|---:|
| `eventId` ausente e `indexed` sem `photo_faces` | 1.744 |
| `eventId` ausente | 351 |
| Conflito de fotógrafo no evento NightRun #30 | 15 |

Os 2.095 registros sem evento referenciam álbuns históricos para os quais não existe
evento exato no banco. A Fase 3C não cria eventos e não aproxima esses registros a um
evento semelhante. Cada item da fila contém candidatos, evidências, score, vizinhos de
upload, storage, link da foto, álbum e FaceIds AWS disponíveis.

## Checkpoints e rollback

O dry-run simulou 188 checkpoints de até 25 registros:

- 1 checkpoint para o evento;
- 187 checkpoints para os 4.654 vínculos de fotógrafo.

O rollback restaura o `photographerId` do evento e das faces para seus valores nulos
originais. Não contém operação AWS nem exclusão de registro.

## Buscas faciais

Nenhuma chamada `/api/face/search` foi realizada no dry-run, pois o estado reconciliado
ainda não existe. Após eventual aprovação, a execução real deverá validar o evento antigo
NightRun #30 e um evento recente de controle. Para cumprir literalmente o teste com selfies
reais, as imagens correspondentes precisam estar disponíveis no momento da execução.

## Restrições confirmadas

O dry-run usou apenas PostgreSQL `READ ONLY`, AWS `ListFaces` e listagem de metadados do
storage. Não executou `IndexFaces`, `DeleteFaces`, reindexação, exclusão ou qualquer alteração
em frontend, upload, threshold, pipeline, Redis, filas ou arquitetura.

## Gate

Estado: aguardando validação explícita. Nenhuma proposta deve ser aplicada sem aprovação
vinculada ao hash deste manifesto.

Token de confirmação:
`PHASE3C_APPLY_1B6B9441A9FB`.
