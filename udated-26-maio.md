# Revisao do fluxo do cliente - 26 de maio de 2026

## Objetivo

Revisar o fluxo do cliente desde cadastro/login ate compra de uma imagem, garantindo os pontos minimos:

- cadastro ou login antes do pagamento;
- carrinho e checkout com dados do comprador;
- recibo minimo da compra;
- area "Minhas Compras" com pedidos e downloads;
- link compartilhavel de imagem;
- favorito para comprar depois, inclusive sem compra;
- like em imagem para sinalizar interesse e futura estatistica.

## Fluxo revisado

### 1. Entrada na loja

1. Cliente acessa a vitrine.
2. Cliente pode buscar por numero de peito.
3. Cliente pode entrar em um evento pela listagem de eventos.
4. Cliente visualiza fotos publicadas com marca d'agua visual, preco, numero de peito, evento e ponto.

Status: coberto pela rota principal em `src/App.tsx`, `EventGrid` e `PhotoGrid`.

### 2. Interacao antes da compra

1. Cliente pode adicionar imagem ao carrinho.
2. Cliente pode favoritar imagem para comprar depois.
3. Cliente pode curtir imagem.
4. Cliente pode compartilhar uma imagem antes da compra usando um link do tipo `/?media=ID_DA_MIDIA`.
5. Ao abrir um link compartilhado, a loja tenta localizar a midia e abre o evento correspondente.

Status: revisado e reforcado em `PhotoGrid` e `src/lib/customer-engagement.ts`.

Observacao tecnica: favoritos e likes ficam em `localStorage` nesta etapa. Isso garante a rotina do usuario no navegador atual, mas estatisticas globais de likes ainda exigem persistencia em tabela propria no banco.

### 3. Carrinho

1. Cliente adiciona a foto ao carrinho.
2. Carrinho persiste no navegador via `localStorage`.
3. Cliente remove itens se necessario.
4. Para pagar, cliente precisa estar logado.

Status: coberto por `CartDrawer` e estado `cart` em `src/App.tsx`.

### 4. Cadastro/login de cliente

1. Se cliente nao estiver autenticado, a interface abre o modal de autenticacao.
2. Cadastro usa Supabase Auth com email, senha, nome e CPF.
3. Login usa Supabase Auth com email e senha.
4. Depois de autenticado, o cliente pode continuar o checkout.

Status: coberto por `AuthView`, `AuthContext` e `src/lib/supabase.ts`.

### 5. Checkout

1. Cliente abre `/checkout`.
2. Checkout exige nome completo, email, WhatsApp e CPF valido.
3. Total precisa ser maior que R$ 1,00 por exigencia da InfinitePay.
4. Backend cria pedido em `orders`.
5. Backend cria itens em `order_items`.
6. Backend cria link de pagamento InfinitePay.
7. Cliente e redirecionado para pagamento.

Status: coberto por `CheckoutPage`, `paymentService.createInfinitePayCheckout` e `/api/checkout/create-session`.

### 6. Retorno do pagamento

1. InfinitePay retorna para a aplicacao.
2. Aplicacao chama `/api/checkout/confirm`.
3. Se confirmado, pedido vira `paid`.
4. Carrinho e limpo.
5. Gaveta "Minhas Compras" abre com o pedido em destaque.

Status: coberto por `PagamentoSucesso`, efeito de retorno em `src/App.tsx` e endpoint `/api/checkout/confirm`.

### 7. Painel do cliente: Minhas Compras

1. Cliente autenticado abre "Compras".
2. Sistema lista pedidos do usuario logado.
3. Pedidos pagos liberam download.
4. Pedido pendente mostra botao para pagar novamente quando existe `checkoutUrl`.
5. Cliente pode copiar recibo minimo do pedido pago.
6. Cliente pode compartilhar link de item comprado.
7. Cliente pode favoritar item comprado.
8. Cliente pode remover item da lista local sem apagar o pedido real.
9. Favoritos aparecem no topo da gaveta para compra posterior.

Status: revisado e reforcado em `CustomerOrdersDrawer`.

## Checklist manual de teste

### Cadastro ate compra

1. Abrir `npm run dev`.
2. Acessar `http://localhost:3000`.
3. Buscar uma foto por evento ou numero de peito.
4. Clicar em "Comprar Foto".
5. Abrir carrinho.
6. Clicar em "Entrar para pagar".
7. Cadastrar uma conta ou fazer login.
8. Voltar ao carrinho e clicar em "Finalizar compra".
9. Preencher nome, email, WhatsApp e CPF valido.
10. Confirmar que o botao "Finalizar compra" habilita.
11. Gerar checkout InfinitePay.
12. Confirmar que o pedido foi criado e o usuario foi redirecionado.
13. Ao retornar do pagamento, confirmar que "Minhas Compras" abre.
14. Confirmar que pedido pago mostra download e recibo.

### Favorito sem compra

1. Abrir uma foto na vitrine.
2. Clicar no icone de coracao.
3. Abrir "Compras".
4. Confirmar que a foto aparece em "Favoritos".
5. Clicar no botao de adicionar ao carrinho.
6. Confirmar que a foto entra no carrinho.

### Compartilhamento sem compra

1. Clicar em "Compartilhar" em uma foto.
2. Confirmar que o link foi copiado ou aberto no compartilhamento nativo.
3. Abrir o link em uma nova aba.
4. Confirmar que a loja abre e tenta posicionar o usuario no evento da midia.

### Like

1. Clicar no icone de like em uma foto.
2. Recarregar a pagina.
3. Confirmar que o like continua marcado no mesmo navegador.
4. Clicar novamente para remover.

### Recibo e compra paga

1. Abrir "Compras".
2. Localizar pedido pago.
3. Clicar em "Recibo".
4. Colar em um editor de texto.
5. Confirmar que contem pedido, status, comprador, total, data e itens.
6. Clicar em "Baixar" ou "Baixar tudo".
7. Confirmar que o arquivo abre ou baixa.

## Garantias atuais

- Download exige pedido pago no backend.
- Download autenticado valida dono do pedido.
- Pedido pago gera historico visivel em "Minhas Compras".
- Recibo minimo pode ser copiado pelo cliente.
- Favoritos funcionam antes e depois da compra.
- Compartilhamento funciona antes e depois da compra por URL publica da loja.
- Likes funcionam no navegador atual e podem orientar uma futura tabela de estatisticas.

## Pendencias recomendadas

1. Criar tabelas persistentes para `product_favorites`, `product_likes` e `product_share_events`.
2. Vincular favoritos/likes ao `userId` quando o cliente estiver logado.
3. Exibir contadores reais de likes no painel do fotografo e admin.
4. Criar uma rota dedicada `/media/:id` para compartilhamento mais preciso.
5. Gerar recibo em HTML/PDF com numero fiscal ou identificador interno formal, caso seja requisito financeiro.
6. Adicionar testes E2E com Playwright para cadastro, checkout simulado, retorno de pagamento e download.

## Arquivos alterados

- `src/lib/customer-engagement.ts`
- `src/components/PhotoGrid.tsx`
- `src/components/CustomerOrdersDrawer.tsx`
- `src/App.tsx`

## Validacao executada

- `npm run lint`

Resultado: TypeScript passou sem erros.
