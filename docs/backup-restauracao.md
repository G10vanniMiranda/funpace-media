# Backup e Restauracao

Este documento define o procedimento operacional minimo para proteger banco e midias do FunPace Media.

## Comandos

Backup JSON do banco via Supabase REST:

```bash
npm run backup:db
```

Manifesto do bucket externo:

```bash
npm run backup:bucket
```

Backup completo do bucket, baixando os arquivos publicos listados:

```bash
npm run backup:bucket -- --download-files
```

Rodar banco e manifesto do bucket no mesmo diretorio:

```bash
npm run backup:db -- --out=backups/operacao-YYYY-MM-DD
npm run backup:bucket -- --out=backups/operacao-YYYY-MM-DD
```

## Variaveis Necessarias

Banco:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Bucket:

```env
BUCKET_API_BASE_URL=https://99dev.pro/bucket/api
BUCKET_API_TOKEN=
MEDIA_BUCKET=
```

## O Que E Gerado

`npm run backup:db` cria:

- `backups/<timestamp>/database/<tabela>.json`
- `backups/<timestamp>/backup-manifest.json`

`npm run backup:bucket` cria:

- `backups/<timestamp>/bucket-manifest.json`

Com `--download-files`, tambem cria:

- `backups/<timestamp>/bucket-files/*`

## Frequencia Recomendada

- Antes de deploy: backup do banco e manifesto do bucket.
- Diario em operacao real: backup do banco.
- Diario ou semanal, conforme volume: manifesto do bucket.
- Semanal ou antes de eventos grandes: backup fisico dos arquivos do bucket.

## Restauracao Recomendada

1. Criar ambiente staging separado.
2. Aplicar schema atualizado com `npm run supabase:schema:apply`.
3. Restaurar dados JSON em ordem de dependencia:
   - `photographers`
   - `customers`
   - `events`
   - `products`
   - `orders`
   - `order_items`
   - `payments`
   - `payment_events`
   - `download_access`
   - `download_events`
   - `downloads`
   - `product_likes`
   - `customer_favorites`
   - `withdrawal_requests`
   - `photographer_wallets`
   - `photographer_transactions`
   - `platform_settings`
   - `coupons`
   - `admin_activity_logs`
4. Conferir `products.url`, `thumbnailUrl` e `storagePath` contra `bucket-manifest.json`.
5. Se o bucket foi recriado, reenviar arquivos de `bucket-files` pelo provider e atualizar URLs quando necessario.
6. Rodar `npm run supabase:schema:validate`.
7. Testar login, vitrine, checkout, painel do cliente, download protegido, painel do fotografo e admin.

## Observacoes Importantes

- O backup JSON nao substitui `pg_dump` oficial do Supabase quando ele estiver disponivel.
- O manifesto do bucket ajuda auditoria e restauracao, mas nao contem os bytes dos arquivos sem `--download-files`.
- Os comandos nao apagam nem alteram dados.
- Guarde backups fora do repositorio Git e com acesso restrito, pois contem dados pessoais e operacionais.
