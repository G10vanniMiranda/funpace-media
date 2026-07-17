# Checklist de produção — Fase 4

## Antes do deploy

- [ ] Revisar o diff e confirmar ausência de `IndexFacesCommand` e `DeleteFacesCommand` na camada de integridade.
- [ ] Executar `npm run lint`, `npm test` e `npm run build`.
- [ ] Fazer backup do banco e registrar commit do deploy.
- [ ] Definir `DATABASE_URL`, AWS, collection, bucket e credenciais de storage.
- [ ] Gerar `OPERATIONS_SECRET` exclusivo.
- [ ] Manter `INTEGRITY_SCHEDULER_ENABLED=false` e `INTEGRITY_AUTO_RECONCILE_ENABLED=false` no primeiro restart.

## Ativação controlada

- [ ] Aplicar `npm run integrity:schema:apply` e confirmar sete tabelas `integrity_*`.
- [ ] Executar `npm run integrity:audit` uma vez.
- [ ] Verificar que o inventário do banco, AWS e storage é plausível.
- [ ] Revisar findings críticos e confirmar que nenhuma tabela funcional foi alterada.
- [ ] Abrir o painel administrativo e validar métricas, fila, alertas e auditorias.
- [ ] Ativar somente o scheduler e observar pelo menos dois ciclos.
- [ ] Configurar/testar o adaptador de alerta.

## Reconciliação automática

- [ ] Definir `INTEGRITY_AUTO_RECONCILE_SINCE` exatamente no início da operação da Fase 4.
- [ ] Confirmar que todo legado é anterior à data de corte.
- [ ] Validar em dry-run quais itens novos atingem 99,9%.
- [ ] Só então definir `INTEGRITY_AUTO_RECONCILE_ENABLED=true` e reiniciar o PM2 preservando env.
- [ ] Confirmar logs antes/depois, origem, motivo, worker e chave idempotente.
- [ ] Reexecutar auditoria e confirmar idempotência.

## Aceite final

- [ ] Nenhum `processing` preso.
- [ ] Nenhum `indexed` recente sem `photo_faces` sem justificativa.
- [ ] Nenhuma duplicação de FaceId.
- [ ] AWS, banco e storage consistentes para os registros pós-corte.
- [ ] Busca facial real validada nos eventos selecionados.
- [ ] Upload, publicação, vendas e downloads continuam funcionando.
- [ ] Alarmes críticos chegam ao canal configurado.
- [ ] Runbook, arquitetura e limites entregues à operação.
