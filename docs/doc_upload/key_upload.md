# FunPace - Storage de imagens e videos

Este documento concentra as informacoes do bucket usado para salvar fotos, videos e thumbnails do FunPace.

## Provider atual

- Provider: API externa `99dev.pro`
- Base URL: `https://99dev.pro/bucket/api`
- Header de autenticacao: `X-API-Token`
- Token atual: configurado apenas em `.env`/deploy como `BUCKET_API_TOKEN`
- Bucket atual no `.env`: `slug-do-bucket`

> Status atual: estes sao exatamente os dados recebidos da API. O campo `bucket=slug-do-bucket` sera usado como valor de `MEDIA_BUCKET` e `VITE_MEDIA_BUCKET`.

## Variaveis no .env

```env
MEDIA_STORAGE_PROVIDER=external_bucket
BUCKET_API_BASE_URL=https://99dev.pro/bucket/api
BUCKET_API_TOKEN=<token-gerado-no-provedor>
MEDIA_BUCKET=slug-do-bucket
VITE_MEDIA_BUCKET=slug-do-bucket
MEDIA_PUBLIC_BASE_URL=
VITE_MEDIA_PUBLIC_BASE_URL=
```

Variaveis importantes:

- `MEDIA_STORAGE_PROVIDER`: define o storage ativo. No fluxo atual, use `external_bucket` para a API `99dev.pro`.
- `BUCKET_API_BASE_URL`: URL base da API externa.
- `BUCKET_API_TOKEN`: token secreto usado pelo backend. Nao criar versao `VITE_` desta chave.
- `MEDIA_BUCKET`: slug do bucket usado pelo backend.
- `VITE_MEDIA_BUCKET`: slug visivel no frontend apenas para montar URLs publicas quando necessario.
- `MEDIA_PUBLIC_BASE_URL`: opcional. Use se a API externa nao retornar URL publica depois do upload.
- `VITE_MEDIA_PUBLIC_BASE_URL`: versao publica para o frontend montar preview quando salvar apenas caminhos relativos.

## Fluxo implementado no projeto

1. O fotografo escolhe imagens ou videos no painel.
2. O frontend gera o caminho interno no formato:

```text
<photographerId>/<timestamp>-<uuid>-<arquivo>
<photographerId>/thumbs/<timestamp>-<uuid>-<arquivo>
```

3. O frontend envia o arquivo para `/api/media/upload` com o token de sessao Supabase do fotografo.
4. O backend valida o usuario pelo Supabase Auth.
5. O backend envia o arquivo para `POST https://99dev.pro/bucket/api/upload`.
6. A tabela `products` continua salvando `url`, `thumbnailUrl` e `storagePath`.

## Endpoints da API externa

Listar arquivos:

```bash
curl "https://99dev.pro/bucket/api/files?bucket=slug-do-bucket" \
  -H "X-API-Token: <token-gerado-no-provedor>"
```

Enviar arquivo:

```bash
curl -X POST "https://99dev.pro/bucket/api/upload" \
  -H "X-API-Token: <token-gerado-no-provedor>" \
  -F "bucket=slug-do-bucket" \
  -F "arquivo=@arquivo.jpg"
```

## Arquivos do projeto envolvidos

- `src/lib/services.ts`: chama `/api/media/upload` ao publicar produto.
- `server.ts`: rota Express `/api/media/upload` e assinatura/fallback de URLs.
- `api/media/upload.ts`: rota serverless equivalente para deploy que usa pasta `api`.
- `api/media/sign.ts`: resolve URLs de midia para checkout, vitrine e downloads.
- `src/components/CheckoutPage.tsx`: monta preview de item no carrinho quando a URL salva for relativa.
- `.env`: define provider, token e bucket ativo.

## Checklist para trocar de bucket no futuro

1. Atualizar `MEDIA_BUCKET` e `VITE_MEDIA_BUCKET` se o fornecedor trocar o slug.
3. Se mudar de provider, atualizar `MEDIA_STORAGE_PROVIDER`.
4. Se mudar a API externa, atualizar `BUCKET_API_BASE_URL`.
5. Se a API externa retornar URL publica no upload, nao precisa configurar `MEDIA_PUBLIC_BASE_URL`.
6. Se a API retornar apenas caminho/arquivo, preencher `MEDIA_PUBLIC_BASE_URL` e `VITE_MEDIA_PUBLIC_BASE_URL`.
7. Reiniciar o servidor depois de qualquer alteracao no `.env`.
8. Rodar `npm run bucket:upload:test` para fazer 5 uploads pequenos de validacao.
9. Fazer um upload real de imagem e um upload real de video pelo painel do fotografo.
10. Conferir no banco se `products.url`, `products.thumbnailUrl` e `products.storagePath` foram salvos.
11. Conferir a vitrine, o checkout e o download de compra paga.

## Cuidados de seguranca

- Nunca exponha `BUCKET_API_TOKEN` com prefixo `VITE_`.
- Rotacione o token se ele tiver sido compartilhado fora do ambiente de desenvolvimento.
- O backend valida se o upload esta indo para a pasta do proprio fotografo.
- O Supabase continua necessario para login, aprovacao do fotografo, produtos, pedidos e autorizacao de downloads.
