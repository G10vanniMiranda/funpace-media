# Manual de Deploy - Bucket de Midias

Use este checklist sempre que for fazer deploy do FunPace com upload de imagens, videos e thumbnails.

## Status atual

O `.env` local ja possui:

```env
MEDIA_STORAGE_PROVIDER=external_bucket
BUCKET_API_BASE_URL=https://99dev.pro/bucket/bucket/api
BUCKET_API_TOKEN=preenchido
```

Bucket configurado conforme os dados recebidos da API:

```env
MEDIA_BUCKET=slug-do-bucket
VITE_MEDIA_BUCKET=slug-do-bucket
```

Esse valor veio no exemplo da API como `bucket=slug-do-bucket` e sera usado nos testes e no upload.

## 1. Variaveis obrigatorias

Configure estas variaveis no ambiente do deploy:

```env
MEDIA_STORAGE_PROVIDER=external_bucket
BUCKET_API_BASE_URL=https://99dev.pro/bucket/bucket/api
BUCKET_API_TOKEN=<token-gerado-no-provedor>
MEDIA_BUCKET=slug-do-bucket
VITE_MEDIA_BUCKET=slug-do-bucket
```

Se a API do bucket nao retornar uma URL publica no upload, configure tambem:

```env
MEDIA_PUBLIC_BASE_URL=
VITE_MEDIA_PUBLIC_BASE_URL=
```

## 2. Variaveis que nao devem ser usadas

Nao use mais estas variaveis para midias:

```env
SUPABASE_BUCKET
VITE_SUPABASE_BUCKET
```

O Supabase continua sendo usado para Auth, banco, produtos, pedidos e permissoes. O storage de midias passa pelo provider definido em `MEDIA_STORAGE_PROVIDER`.

## 3. Antes do deploy

Confira:

- `MEDIA_BUCKET` deve estar preenchido.
- `VITE_MEDIA_BUCKET` deve ter o mesmo slug de `MEDIA_BUCKET`.
- `BUCKET_API_TOKEN` deve estar configurado apenas no backend/deploy, nunca como variavel `VITE_`.
- `VITE_DATA_MODE=production`.
- `SUPABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SERVICE_ROLE_KEY` devem estar configuradas.
- `FRONTEND_URL`, `API_URL` e `VITE_API_URL` devem apontar para os dominios corretos.
- `INFINITEPAY_*` deve estar configurado no ambiente de producao.

## 4. Comandos locais de validacao

Rode antes de publicar:

```bash
npm run lint
npm test
npm run build
```

Todos devem passar.

## 5. Build e start recomendados

Para deploy em ambiente Node, use:

```txt
Build command: npm install && npm run build
Start command: npm start
```

O servidor de producao roda a partir de:

```txt
dist/server.cjs
```

## 6. Fluxo esperado do upload

1. O fotografo envia arquivo pelo painel.
2. O frontend chama `/api/media/upload`.
3. O backend valida a sessao Supabase do fotografo.
4. O backend envia o arquivo para a API do bucket usando `BUCKET_API_TOKEN`.
5. O produto salva `url`, `thumbnailUrl` e `storagePath` no Supabase.
6. A vitrine, carrinho, checkout e downloads usam as URLs salvas.

## 7. Teste obrigatorio depois do deploy

Antes de publicar, com o bucket configurado, rode:

```bash
npm run bucket:upload:test
```

O comando deve fazer 5 uploads pequenos no bucket. Depois de publicar, teste:

- Login de fotografo aprovado.
- Upload de uma imagem.
- Upload de um video.
- Geracao de thumbnail do video.
- Produto aparecendo na vitrine.
- Produto aparecendo no carrinho.
- Checkout carregando a miniatura.
- Compra paga liberando download em Minhas Compras.
- Painel admin carregando produtos e metricas.

## 8. Erros comuns

### MEDIA_BUCKET nao configurado

Significa que `MEDIA_BUCKET` esta vazio.

Corrija no `.env` local e no painel do deploy:

```env
MEDIA_BUCKET=slug-do-bucket
VITE_MEDIA_BUCKET=slug-do-bucket
```

Depois rode:

```bash
npm run bucket:upload:test
```

### BUCKET_API_TOKEN nao configurado

O backend nao consegue autenticar na API do bucket.

Corrija:

```env
BUCKET_API_TOKEN=<token-gerado-no-provedor>
```

### Credencial do bucket expirada ou invalida

O provider recusou o `BUCKET_API_TOKEN` atual. Gere um token novo no painel do provider, atualize o `.env` local e as variaveis do deploy, reinicie o backend e rode:

```bash
npm run bucket:upload:test
```

### Imagem aparece quebrada

Possiveis causas:

- A API do bucket retornou apenas caminho relativo.
- `MEDIA_PUBLIC_BASE_URL` e `VITE_MEDIA_PUBLIC_BASE_URL` nao foram configuradas.
- O arquivo foi salvo em um bucket privado sem URL publica.

### Upload retorna 401

O fotografo nao esta autenticado ou a sessao Supabase expirou.

Teste sair e entrar novamente no painel do fotografo.

### Upload retorna 403

O backend bloqueou o caminho do arquivo porque ele nao pertence ao usuario autenticado.

O caminho deve iniciar com:

```txt
<id-do-fotografo>/
```

## 9. Checklist final

Antes de considerar o deploy pronto:

- Build passou.
- Testes passaram.
- Variaveis do bucket foram configuradas no deploy.
- `MEDIA_BUCKET` esta preenchido.
- Upload real foi testado.
- Download de compra paga foi testado.
- Nenhuma variavel secreta foi exposta com prefixo `VITE_`.
