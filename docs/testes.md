# Testes e Validacoes do Projeto

Este arquivo concentra os comandos usados para validar o FunPace antes de desenvolvimento, deploy ou alteracoes sensiveis.

## 1. TypeScript / lint

```bash
npm run lint
```

Resumo:

- Executa `tsc --noEmit`.
- Valida tipos TypeScript.
- Detecta imports quebrados, tipos inconsistentes e erros de compilacao.
- Deve ser executado antes de qualquer deploy.

## 2. Testes automatizados

```bash
npm test
```

Resumo:

- Executa os testes em `tests/*.test.ts`.
- Atualmente cobre utilitarios como CPF e telefone.
- Deve ser executado depois de alterar regras de negocio, validacoes ou helpers compartilhados.

## 3. Build de producao

```bash
npm run build
```

Resumo:

- Gera o build Vite do frontend.
- Compila `server.ts` para `dist/server.cjs`.
- Detecta erros de bundle, imports invalidos e problemas que podem aparecer apenas em producao.
- Deve ser executado antes de deploy.

## 4. Rodar servidor local

```bash
npm run dev
```

Resumo:

- Inicia o servidor local com `tsx server.ts`.
- Sobe frontend e backend Express no mesmo processo.
- Use para testar fluxos completos localmente.

## 5. Rodar build em modo producao

```bash
npm start
```

Resumo:

- Executa `node dist/server.cjs`.
- Precisa rodar `npm run build` antes.
- Simula o start usado no deploy Node.

## 6. Teste de upload do bucket

```bash
npm run bucket:upload:test
```

Resumo:

- Executa `scripts/test-bucket-upload.mjs`.
- Faz 5 uploads de PNG minimo para o bucket configurado.
- Usa `BUCKET_API_BASE_URL`, `BUCKET_API_TOKEN` e `MEDIA_BUCKET`.
- Usa o valor de `MEDIA_BUCKET` exatamente como configurado no `.env`.
- Nao imprime o token no terminal.

Status atual:

- O comando foi criado e ja esta disponivel.
- A execucao usa `MEDIA_BUCKET=slug-do-bucket`, conforme os dados recebidos da API.

Variaveis obrigatorias:

```env
BUCKET_API_BASE_URL=https://99dev.pro/bucket/bucket/api
BUCKET_API_TOKEN=abt_f1785e2267d3.kxcZnf2EdRKLRMqzIyTvPVbacKLYJhZ4
MEDIA_BUCKET=slug-do-bucket
VITE_MEDIA_BUCKET=slug-do-bucket
```

Resultado esperado quando estiver configurado corretamente:

```txt
bucketUploadTest:start
bucketUploadTest:item
bucketUploadTest:item
bucketUploadTest:item
bucketUploadTest:item
bucketUploadTest:item
bucketUploadTest:done
```

## 7. Aplicar schema Supabase

```bash
npm run supabase:schema:apply
```

Resumo:

- Executa `scripts/apply-supabase-schema.mjs`.
- Aplica o SQL de `scripts/supabase-schema.sql`.
- Deve ser usado com cuidado, apenas quando houver alteracoes de schema.

## 8. Validar schema Supabase

```bash
npm run supabase:schema:validate
```

Resumo:

- Executa `scripts/validate-supabase-schema.mjs`.
- Confere tabelas, colunas, RLS e policies principais do banco.
- Nao valida mais bucket Supabase Storage, porque midias usam provider externo.

## 9. Definir admin no Supabase

```bash
npm run supabase:admin:set -- email@exemplo.com
```

Resumo:

- Executa `scripts/set-supabase-admin.mjs`.
- Define role de admin para um usuario.
- Use quando precisar liberar acesso ao painel administrativo.

## 10. Checklist antes de deploy

Execute nesta ordem:

```bash
npm run lint
npm test
npm run build
```

Se o bucket estiver configurado:

```bash
npm run bucket:upload:test
```

Conferir tambem:

- `.env` local ou variaveis do deploy estao completas.
- `MEDIA_BUCKET` esta preenchido.
- `BUCKET_API_TOKEN` existe apenas no backend/deploy.
- `VITE_DATA_MODE=production`.
- `SUPABASE_SERVICE_ROLE_KEY` esta configurada no backend.
- Fluxo de login, upload, checkout e download foi testado manualmente.

## 11. Comandos de diagnostico uteis

Buscar referencias ao bucket antigo:

```bash
rg -n "funpace-media|SUPABASE_BUCKET|VITE_SUPABASE_BUCKET|supabaseStorage|storage\\.objects|storage\\.buckets" -S .
```

Buscar pontos de upload/midia:

```bash
rg -n "media/upload|media/sign|storagePath|thumbnailUrl|MEDIA_BUCKET|BUCKET_API_TOKEN" -S src api server.ts scripts docs
```

Ver arquivos alterados:

```bash
git status --short
```

Ver resumo das alteracoes:

```bash
git diff --stat
```
