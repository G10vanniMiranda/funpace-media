# Prompt de seguranca, auditoria e recuperacao - Funpace Media

## Prompt principal

Use este prompt para revisar, melhorar e validar a seguranca completa da plataforma Funpace Media.

```md
Voce e um engenheiro senior de seguranca e produto revisando a plataforma Funpace Media.

Objetivo:
Fazer uma analise completa de seguranca, operacao, administracao, backup e recuperacao do projeto, cobrindo frontend, backend, Supabase, banco Postgres, bucket de midias, pagamentos, painel admin, painel do fotografo e painel do cliente.

Entregue:
1. Diagnostico do estado atual.
2. Riscos por severidade.
3. Checklist de validacao por etapa.
4. Melhorias obrigatorias antes de producao.
5. Melhorias recomendadas para evolucao.
6. Plano de backup do banco.
7. Plano de backup do bucket de imagens/videos.
8. Plano de restauracao caso seja necessario subir tudo novamente.
9. Requisitos minimos para o painel admin.
10. Testes manuais e automatizados que precisam ser executados antes de deploy.

Regras:
- Nao confie no frontend para autorizacao, preco, dono do pedido, status de pagamento ou permissao admin.
- Toda acao sensivel deve ser validada no backend ou no banco por RLS.
- Nao exponha tokens, service role keys, senhas, dados de cartao ou URLs privadas permanentes.
- Downloads pagos devem exigir pedido pago e usuario dono do pedido.
- Uploads devem pertencer ao fotografo autenticado.
- Admin deve ter permissao separada e auditavel.
- Pagamentos devem depender de confirmacao confiavel da InfinitePay/webhook.
- Backups precisam ser testados com restauracao, nao apenas gerados.
```

## Analise geral do que precisa ser garantido

### 1. Autenticacao

Validar:

- Cliente cria conta e faz login via Supabase Auth.
- Fotografo cria conta, confirma email e aguarda aprovacao.
- Admin acessa somente se `app_metadata.role = admin`.
- Sessao admin fica isolada da sessao comum.
- Logout remove sessao local corretamente.
- Convites e redefinicao de senha expiram e nao podem ser reutilizados indefinidamente.

Melhorias:

- Exigir senha forte no cadastro.
- Habilitar MFA para administradores.
- Criar lista de admins revisada mensalmente.
- Registrar data, IP e user-agent de login admin.

### 2. Autorizacao e RLS

Validar:

- RLS ligado em tabelas sensiveis.
- Cliente so le seus pedidos.
- Fotografo so edita seus produtos.
- Admin consegue ler dados operacionais, mas apenas quando autenticado como admin.
- `orders`, `order_items`, `payment_events`, `platform_settings`, `withdrawal_requests` e `download_events` tem policies corretas.
- Frontend nao consegue alterar status de pedido, comissao, saldo, saque ou permissao admin.

Comandos:

```bash
npm run supabase:schema:validate
npm run lint
npm test
npm run build
```

Melhorias:

- Adicionar testes automatizados de negacao para RLS.
- Testar tentativa de leitura cruzada entre dois usuarios.
- Testar tentativa de fotografo editar produto de outro fotografo.
- Testar tentativa de cliente alterar status de pedido.

### 3. Painel admin

Informacoes importantes que o admin deve mostrar:

- Pedidos por status: pendente, pago, falhou, cancelado e reembolsado.
- Receita bruta e taxa da plataforma.
- Produtos publicados, removidos e rascunhos.
- Fotografos pendentes de aprovacao.
- Saques pendentes, aprovados, pagos e recusados.
- Uso do bucket: total de arquivos, tamanho usado, limite e percentual.
- Eventos recentes de pagamento/webhook.
- Downloads por produto.
- Alertas de falha em webhook, falha de bucket, token expirado e pedidos pendentes antigos.
- Botao/exportacao de relatorio administrativo.

Melhorias de seguranca para admin:

- Exigir MFA.
- Tela de auditoria com acoes administrativas:
  - aprovacao de fotografo;
  - alteracao de taxa;
  - marcacao de saque como pago;
  - alteracao manual de pedido;
  - exclusao/remocao de midia;
  - reenvio de convite.
- Registrar `adminUserId`, data, acao, entidade afetada e payload resumido.
- Criar permissao por nivel:
  - suporte: le pedidos e clientes;
  - financeiro: ve pagamentos e saques;
  - operador: aprova fotografo e produtos;
  - superadmin: altera configuracoes e admins.

### 4. Checkout e pagamentos

Validar:

- Preco final e calculado no backend, usando produtos atuais do banco.
- Cliente nao envia preco confiavel pelo frontend.
- Pedido nasce como `pending`.
- Pedido so vira `paid` apos confirmacao confiavel.
- Webhook da InfinitePay valida assinatura quando segredo estiver configurado.
- Eventos de pagamento sao salvos para auditoria.
- Retorno do checkout nao libera download sozinho se houver duvida.

Melhorias:

- Bloquear pedido com produto removido ou rascunho.
- Criar rotina para reconciliar pedidos pendentes consultando InfinitePay.
- Alertar admin sobre pedidos pendentes ha mais de 24 horas.
- Salvar recibo/identificador externo quando InfinitePay retornar.

### 5. Downloads e midias pagas

Validar:

- Download exige usuario autenticado.
- Download exige pedido do usuario logado.
- Download exige pedido `paid`.
- URL assinada tem expiracao curta.
- Evento de download e registrado.
- Cliente nao recebe `storagePath` privado sem autorizacao.

Melhorias:

- Limitar quantidade de geracoes de link por minuto.
- Criar log de download por IP/user-agent.
- Bloquear downloads suspeitos por excesso.
- Exibir no admin produtos com muitos downloads incomuns.

### 6. Upload e bucket

Validar:

- Upload exige fotografo autenticado.
- Caminho do arquivo comeca com o id do fotografo.
- Caminhos com `..` ou barra inicial sao recusados.
- Token do bucket fica apenas no backend.
- `BUCKET_API_TOKEN` nunca aparece no frontend.
- `MEDIA_BUCKET` e `VITE_MEDIA_BUCKET` estao corretos.
- Produto salva `url`, `thumbnailUrl` e `storagePath`.

Comando:

```bash
npm run bucket:upload:test
```

Melhorias:

- Validar tamanho maximo por arquivo.
- Validar MIME real do arquivo.
- Gerar thumbnail no backend.
- Fazer varredura de arquivos orfaos no bucket.
- Fazer relatorio de produtos sem arquivo correspondente.

## Backup do banco de dados

### O que precisa entrar no backup

- `auth.users` ou export equivalente permitido pelo Supabase.
- `public.photographers`.
- `public.customers`.
- `public.products`.
- `public.orders`.
- `public.order_items`.
- `public.payment_events`.
- `public.download_events`.
- `public.withdrawal_requests`.
- `public.platform_settings`.
- futuras tabelas de favoritos, likes e compartilhamentos.

### Frequencia recomendada

- Backup completo diario.
- Backup incremental ou point-in-time recovery quando disponivel.
- Retencao minima de 30 dias.
- Retencao mensal por 12 meses para auditoria financeira.

### Validacao do backup

Todo backup precisa ter:

- data/hora;
- ambiente: producao, staging ou local;
- tamanho do arquivo;
- checksum;
- responsavel;
- status: gerado, enviado, validado, restaurado em teste.

Checklist:

```md
- [ ] Backup gerado.
- [ ] Arquivo criptografado.
- [ ] Checksum salvo.
- [ ] Arquivo enviado para local externo.
- [ ] Restauracao testada em ambiente separado.
- [ ] Login, pedidos e produtos conferidos apos restauracao.
```

## Backup do bucket de imagens e videos

### O que precisa ser salvo

- Arquivos originais de fotos.
- Arquivos originais de videos.
- Thumbnails.
- Mapeamento entre `products.id`, `storagePath`, `url`, `thumbnailUrl`, fotografo, evento e data.
- Manifesto JSON/CSV com lista de arquivos.

### Manifesto minimo

```json
{
  "backupDate": "2026-05-26T00:00:00.000Z",
  "bucket": "slug-do-bucket",
  "files": [
    {
      "productId": "uuid-ou-id",
      "storagePath": "fotografo-id/arquivo.jpg",
      "thumbnailUrl": "fotografo-id/thumbs/arquivo.jpg",
      "event": "Nome do evento",
      "bib": "123",
      "vendedorId": "fotografo-id",
      "sizeBytes": 123456,
      "checksum": "sha256..."
    }
  ]
}
```

### Frequencia recomendada

- Backup diario para novos arquivos.
- Backup semanal completo.
- Retencao minima de 30 dias.
- Guardar uma copia fora do provedor principal.

### Validacao do bucket

- Comparar quantidade de arquivos no bucket com produtos do banco.
- Comparar `storagePath` salvo no banco com arquivo real.
- Baixar amostra aleatoria de arquivos.
- Validar checksum.
- Testar restauracao de pelo menos 5 fotos e 1 video.

## Plano de restauracao

Caso seja necessario subir tudo novamente:

1. Criar novo projeto Supabase ou novo banco.
2. Restaurar schema.
3. Restaurar dados do banco.
4. Restaurar usuarios/auth conforme ferramenta suportada.
5. Criar novo bucket ou reconfigurar provider externo.
6. Enviar arquivos do backup para o bucket.
7. Atualizar `MEDIA_BUCKET`, `VITE_MEDIA_BUCKET`, `BUCKET_API_TOKEN` e `MEDIA_PUBLIC_BASE_URL`, se necessario.
8. Validar que `products.storagePath`, `url` e `thumbnailUrl` apontam para arquivos existentes.
9. Rodar:

```bash
npm run supabase:schema:validate
npm run bucket:upload:test
npm run lint
npm test
npm run build
```

10. Testar manualmente:

- login cliente;
- login fotografo;
- login admin;
- upload de midia;
- vitrine;
- carrinho;
- checkout;
- webhook/confirmacao;
- download de pedido pago.

## Checklist antes de deploy

```md
- [ ] `.env` sem segredos expostos no frontend.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` apenas no backend.
- [ ] `BUCKET_API_TOKEN` apenas no backend.
- [ ] `DATABASE_URL` ou credenciais Postgres corretas.
- [ ] RLS validado.
- [ ] Admin real testado.
- [ ] Fotografo aprovado testado.
- [ ] Cliente comum testado.
- [ ] Checkout testado.
- [ ] Webhook testado.
- [ ] Download pago testado.
- [ ] Backup do banco gerado.
- [ ] Backup do bucket gerado.
- [ ] Restauracao testada em ambiente separado.
- [ ] `npm run lint` passou.
- [ ] `npm test` passou.
- [ ] `npm run build` passou.
```

## Riscos prioritarios

Alta prioridade:

- Admin sem MFA.
- Falta de auditoria detalhada de acoes admin.
- Likes/favoritos ainda locais, sem estatistica persistente.
- Backup do bucket ainda precisa de rotina automatizada.
- Restauracao de backup precisa ser testada regularmente.

Media prioridade:

- Criar rota dedicada `/media/:id` para compartilhamento.
- Criar rate limit para downloads e uploads.
- Criar reconciliacao automatica de pedidos pendentes.
- Criar alertas de storage perto do limite.

Baixa prioridade:

- Melhorar exportacao de relatorios.
- Criar painel de saude operacional.
- Criar historico visual de eventos de seguranca.

## Resultado esperado

Ao final da execucao deste prompt, o projeto deve ter:

- seguranca de acesso validada;
- RLS e permissoes revisadas;
- admin mais auditavel;
- pagamentos e downloads protegidos;
- bucket com rotina de backup;
- banco com rotina de backup;
- plano de restauracao documentado;
- checklist claro para deploy e recuperacao.
