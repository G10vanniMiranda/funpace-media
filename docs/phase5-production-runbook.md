# Fase 5 — Runbook definitivo de produção

## Estado de segurança obrigatório

- Backfill encerrado: `FACE_BACKFILL_ENABLED=false`.
- Reconciliação bloqueada: `INTEGRITY_RECONCILIATION_LOCKED=true` e `INTEGRITY_AUTO_RECONCILE_ENABLED=false`.
- Monitor somente auditoria: `INTEGRITY_SCHEDULER_ENABLED=true`.
- Intervalo recomendado: `INTEGRITY_SCAN_INTERVAL_MINUTES=15`.
- `GIT_COMMIT`, `APP_VERSION` e `BUILD_TIMESTAMP` definidos no processo PM2.

Em produção, o código mantém a reconciliação bloqueada mesmo se uma variável antiga solicitar sua ativação.

## Publicação na VPS

Na VPS, entre no diretório que o PM2 realmente executa e confirme `pm2 describe funpace-media`. Depois:

```bash
cd /diretorio/confirmado/pelo/pm2
git status --short
git fetch origin main --prune
git rev-parse origin/main
bash ops/deploy-backend-phase5.sh <SHA40_APROVADO>
pm2 describe funpace-media
pm2 logs funpace-media --lines 200 --nostream
curl -fsS https://api.funpace.media/api/health
```

O script bloqueia worktree sujo, pull não fast-forward, commit diferente, falha de lint/test/build ou health com SHA divergente.

## Rotação de segredos

Nunca cole valores em tickets, chats, commits ou comandos salvos no histórico. Faça a rotação nesta ordem:

1. Gere novos `OPERATIONS_SECRET` e `CRON_SECRET`, distintos, diretamente na VPS.
2. Atualize o `.env` com editor seguro, aplique `chmod 600 .env` e reinicie com `pm2 restart funpace-media --update-env`.
3. Crie nova chave IAM de runtime com privilégio mínimo, atualize `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, valide `ListFaces` e busca; só então desative a chave antiga no IAM.
4. Rotacione o token do bucket no provedor, atualize `BUCKET_API_TOKEN` e valide listagem/HEAD sem upload.
5. Rotacione a senha do banco e atualize `DATABASE_URL`; confirme health autenticado e auditoria.
6. Planeje a rotação de `SUPABASE_SERVICE_ROLE_KEY` conforme o procedimento do projeto Supabase, pois ela pode invalidar outros serviços.
7. Revise `INFINITEPAY_WEBHOOK_SECRET`, `RESEND_API_KEY`, `UPSTASH_REDIS_REST_TOKEN` e `DOWNLOAD_TOKEN_SECRET`; rotacione qualquer valor compartilhado durante a recuperação.
8. Remova valores antigos dos painéis e confirme que PM2 não manteve env anterior (`pm2 env <id>` apenas na sessão privada da VPS).

Registre somente data, responsável, identificador parcial/fingerprint e resultado — nunca o valor.

## Monitoramento contínuo

O scheduler executa auditoria com advisory lock. Alertas persistidos cobrem:

- `pending`, `processing`, `processing` preso e `failed`;
- `indexed` sem `photo_faces`;
- evento ou fotógrafo inválido;
- divergências face/produto/evento/fotógrafo;
- faces AWS órfãs;
- FaceIds duplicados no banco ou AWS;
- crescimento da fila humana.

Configure `INTEGRITY_ALERT_WEBHOOK_URL` para um adaptador de Discord, Slack, WhatsApp ou e-mail. Valide entrega sem incluir evidências sensíveis no payload.

## Testes pós-deploy

1. `/api/health` público retorna apenas `ok`, `version`, `commit`, `builtAt` e `time`.
2. `/api/health` com bearer novo retorna diagnósticos booleanos e estado do banco, sem mensagens internas.
3. `POST /api/face/backfill` retorna HTTP 410.
4. `POST /api/integrity/cron` executa modo `audit`.
5. `npm run integrity:guards:validate` passa com `persistentChanges: 0`.
6. `npm run integrity:audit` conclui com `autoFixed: 0`.
7. Busca facial com selfie real é validada em evento antigo e recente, registrando apenas IDs e resultado.

## Rollback

Se o backend falhar, faça rollback somente do código para o commit anterior conhecido, execute build e reinicie o PM2. Não remova triggers, faces AWS ou dados. Se um guard bloquear uma operação legítima, preserve o erro e abra revisão técnica; não desabilite a proteção durante a operação normal.
