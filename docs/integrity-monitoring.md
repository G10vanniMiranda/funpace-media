# Monitoramento permanente de integridade — Fase 4

## Escopo

A camada monitora banco, AWS Rekognition e storage sem alterar upload, indexação, busca facial, vendas ou downloads. O único comando AWS utilizado é `ListFaces`. A camada não contém chamadas a `IndexFaces` nem `DeleteFaces`.

## Componentes

- `server/integrity/integrity-service.ts`: snapshot consistente, auditoria, métricas, alertas, fila e correções estritamente permitidas.
- `server/api/admin/integrity.ts`: painel e decisões protegidos por autenticação admin.
- `server/api/integrity/cron.ts`: execução por cron protegida por segredo operacional.
- `src/components/admin/IntegrityDashboard.tsx`: painel com atualização a cada 30 segundos.
- `scripts/add-integrity-monitoring.sql`: tabelas, índices, RLS, políticas e regras iniciais.

## Proteções da reconciliação

A reconciliação permanece desativada, mesmo quando solicitada pelo cron, até que as duas variáveis abaixo estejam válidas:

```env
INTEGRITY_AUTO_RECONCILE_ENABLED=true
INTEGRITY_AUTO_RECONCILE_SINCE=2026-07-16T00:00:00.000Z
```

A data de corte deve ser a ativação operacional da Fase 4. Registros anteriores ficam fora da correção automática e seguem para revisão humana. Uma correção também exige confiança mínima de 99,9%, evidência atual consistente, transação atômica e chave idempotente.

As únicas correções automáticas permitidas são:

- preencher `photo_faces.photographer_id` vazio quando produto, evento, fotógrafo, AWS e storage concordam;
- reconstruir `photo_faces` de uma foto `indexed` usando apenas FaceIds já existentes e vinculados ao mesmo `ExternalImageId` na AWS.

## Configuração

```env
INTEGRITY_SCHEDULER_ENABLED=true
INTEGRITY_SCAN_INTERVAL_MINUTES=15
INTEGRITY_STALE_PROCESSING_MINUTES=15
INTEGRITY_WORKER_NAME=funpace-integrity-vps-1
INTEGRITY_ALERT_WEBHOOK_URL=https://seu-adaptador-de-alertas.example/webhook
OPERATIONS_SECRET=segredo-longo-e-exclusivo
```

O webhook recebe um JSON neutro que pode ser encaminhado por adaptadores para Discord, Slack, WhatsApp ou e-mail. Ausência do webhook não impede o registro do alerta no banco e nos logs.

## Instalação e operação

```bash
npm run integrity:schema:apply
npm run integrity:audit
npm run build
```

Após o deploy e a primeira auditoria somente leitura, ative o scheduler. Ative a reconciliação apenas depois de validar a data de corte e o painel. Para execução externa, envie `POST /api/integrity/cron` com `Authorization: Bearer <OPERATIONS_SECRET>`.

## Métricas permanentes

São persistidos saúde de integridade, volume de fotos/produtos/FaceIds/storage, indexadas/pendentes/processando/falhas, `processing` preso, órfãs AWS, `indexed` sem face, fotos e faces por hora, sucesso e erro facial, duração média do processamento, eventos/fotógrafos ativos, pedidos pagos em 24 horas, duração da auditoria e tamanho da fila humana.

## Limites conhecidos

- O painel é quase em tempo real, limitado ao intervalo de auditoria; a interface atualiza a cada 30 segundos.
- A correspondência de storage usa URL, caminho, nome armazenado e identificador expostos pela API do bucket.
- Itens ambíguos, históricos ou com evidência abaixo de 99,9% nunca são corrigidos automaticamente.
- Aprovar um item registra a decisão; a aplicação manual da proposta deve seguir procedimento operacional separado e auditado.
