# Inventário de scripts após a Fase 5

## Mantidos — operação permanente

- `run-integrity-monitor.ts`: auditoria permanente.
- `report-integrity-state.mjs`: relatório somente leitura.
- `validate-face-integrity-guards.mjs`: canários com rollback.
- `audit-secret-hygiene.mjs`: detecção de segredos sem imprimir valores.
- `apply-integrity-monitoring.mjs` e migrations SQL: instalação reproduzível.
- `audit-face-search-readonly.mjs`: diagnóstico facial sem escrita.
- scripts de backup de banco e bucket.

## Isolados e bloqueados

- `backfill-face-indexing.ts`;
- `validate-face-backfill-pilot.ts`;
- modo `--apply` de `reconcile-face-recovery-phase3b-apply.ts`;
- endpoint `POST /api/face/backfill`.

Esses caminhos chamam uma trava permanente ou retornam HTTP 410. Os atalhos `faces:backfill` e `integrity:reconcile` foram removidos do `package.json`.

## Preservados como evidência histórica

Dry-runs, auditorias e relatórios das Fases 2/3 permanecem versionados para rastreabilidade, mas não possuem atalho operacional. Migrations antigas permanecem como registro reprodutível do schema.

## Removidos

Oito logs locais temporários de desenvolvimento/produção foram verificados e removidos. Nenhum continha segredo. Nenhum relatório de auditoria foi excluído.
