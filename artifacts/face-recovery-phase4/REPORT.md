# Fase 4 — Monitoramento permanente de integridade

Data: 2026-07-16 (America/Manaus)

## Resultado executivo

A camada permanente foi implementada e validada localmente, e o schema aditivo foi aplicado ao banco de produção. A primeira auditoria completa em produção terminou em modo `audit`, sem correções funcionais (`autoFixed = 0` e `integrity_audit_logs = 0`).

O monitor está pronto para deploy controlado, mas a integridade global do acervo **não está aprovada**: o scan encontrou passivo histórico que deve permanecer na fila humana ou seguir uma fase de reconciliação explicitamente aprovada. O scheduler e a reconciliação automática não foram ativados.

## Evidência da execução concluída

- Run ID: `e5ba8df4-1191-410f-ae0d-39d2c5e9a9b8`
- Modo: `audit`
- Estado: `completed`
- Início UTC: `2026-07-16T21:30:51.445Z`
- Fim UTC: `2026-07-16T21:31:42.140Z`
- Duração: 51.066 ms
- Saúde calculada: 26,28%
- Correções automáticas: 0
- Runs ainda em execução: 0
- Chamadas `IndexFaces`: 0
- Chamadas `DeleteFaces`: 0

## Inventário

| Entidade | Total |
|---|---:|
| Produtos | 8.200 |
| Fotos | 8.158 |
| `photo_faces` | 17.263 |
| Faces AWS | 19.907 |
| Objetos no storage | 16.430 |
| Eventos | 16 |
| Fotógrafos | 24 |

## Estado facial

| Métrica | Valor |
|---|---:|
| Indexed | 7.403 |
| Pending | 1 |
| Processing | 0 |
| Processing preso | 0 |
| Failed | 4 |
| Sucesso calculado | 90,75% |
| Erro calculado | 0,05% |

## Achados reais

| Categoria | Severidade predominante | Quantidade |
|---|---|---:|
| `face_photographer_invalid` | warning | 4.654 |
| `aws_orphan_face` | warning | 2.644 |
| `product_event_invalid` | warning | 2.095 |
| `indexed_without_photo_faces` | critical | 1.744 |
| `product_event_photographer_mismatch` | warning | 612 |
| `storage_object_missing` | critical | 3 |
| **Total** | 1.747 critical / 10.005 warning | **11.752** |

Todos os 11.752 itens estão com status `pending` na fila de revisão. Nenhum deles foi incorporado à reconciliação automática.

## Alertas criados

- `aws_orphan_faces = 2644` — warning;
- `integrity_critical_findings = 1747` — critical;
- `review_queue_pending = 11752` — warning.

Os alertas estão persistidos. O envio externo depende da configuração do webhook/adaptador.

## Ocorrências durante a implantação

1. A persistência sequencial do primeiro scan excedeu o limite operacional e foi interrompida. O run foi encerrado como `failed` com `worker_interrupted_before_completion`.
2. O persistidor foi convertido para lotes de até 1.000 evidências e passou a recuperar runs interrompidos. O ciclo completo caiu para 51,1 segundos.
3. O segundo scan detectou serialização de array SQL em uma coluna JSONB de alertas. A serialização foi corrigida explicitamente e a execução seguinte concluiu.
4. Uma função serverless adicional ultrapassaria o limite de 12 funções do plano Vercel Hobby. O cron foi consolidado no dispatcher `api/system.ts`; a suíte voltou a passar.

## Validações de software

- TypeScript: aprovado (`npm run lint`).
- Testes: 112/112 aprovados (`npm test`).
- Testes específicos da camada: 4/4 aprovados.
- Build frontend e backend: aprovado (`npm run build`).
- Limite de funções Vercel Hobby: preservado.
- Build contém `processPhotoFaceIndex` e `claim_photo_face_index`.
- A camada de integridade importa somente `ListFacesCommand`; não contém `IndexFacesCommand` ou `DeleteFacesCommand`.

## Estado de ativação

- Schema `integrity_*`: aplicado.
- Auditoria manual: concluída.
- Dashboard/API: implementados, aguardando deploy do código.
- Scheduler: não ativado.
- Reconciliação automática: não ativada.
- Webhook externo: não configurado nesta execução.

## Decisão técnica

A **implementação da camada de monitoramento está aprovada para deploy controlado em modo somente auditoria**. O sistema **não pode ser considerado totalmente íntegro/recuperado** com base nesta auditoria, e a reconciliação automática não deve ser habilitada enquanto os 11.752 achados históricos não forem classificados e o corte pós-Fase 4 não for definido e validado.

Antes do deploy, o segredo operacional exposto durante um diagnóstico local deve ser rotacionado tanto na VPS quanto nos demais ambientes que o reutilizem.
