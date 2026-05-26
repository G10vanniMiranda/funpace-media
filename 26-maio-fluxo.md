# Analise do fluxo pos-compra - 26 de maio de 2026

## Objetivo

Garantir que, depois de comprar e pagar, o cliente seja redirecionado para uma experiencia clara, direta e facil:

- confirmar que o pagamento foi recebido;
- abrir o painel do cliente automaticamente;
- destacar o pedido comprado;
- mostrar itens comprados;
- mostrar status do pedido;
- permitir baixar, copiar recibo e compartilhar;
- evitar que o cliente volte perdido para a loja ou checkout.

## Fluxo atual revisado

### 1. Cliente compra

1. Cliente adiciona imagem ao carrinho.
2. Cliente entra/cadastra conta.
3. Cliente abre `/checkout`.
4. Cliente preenche nome, email, WhatsApp e CPF.
5. Backend cria pedido `pending`.
6. Backend cria itens em `order_items`.
7. Backend gera link InfinitePay.
8. Cliente e enviado para pagamento externo.

Status: funcional.

### 2. Cliente paga

1. InfinitePay retorna para `/pagamento/sucesso`.
2. A rota confirma o pagamento via `/api/checkout/confirm`.
3. Se confirmado, pedido vira `paid`.
4. O cliente precisa ser conduzido para "Minhas Compras".

Status anterior: parcialmente fluido. A tela de sucesso confirmava, mas o botao principal dizia "Ir para loja", o que podia deixar o cliente sem acesso imediato ao que comprou.

Status apos ajuste: melhorado. Ao confirmar pagamento, `/pagamento/sucesso` redireciona para `/minhas-compras?order=ID&status=paid`, abrindo uma pagina dedicada com o pedido destacado.

### 3. Painel do cliente

O painel "Minhas Compras" mostra:

- pedidos do usuario logado;
- status do pedido;
- total;
- data;
- itens comprados;
- botao de pagar novamente se pedido estiver pendente;
- botao "Recibo" em pedido pago;
- botao "Baixar tudo";
- botao "Baixar" por item;
- botao para copiar link;
- botao de favoritar;
- favoritos no topo.

Status: funcional, mas ainda pode melhorar em clareza visual e organizacao pos-pagamento.

## Melhorias aplicadas

Arquivo alterado:

- `src/routes/pagamento/sucesso.tsx`
- `src/components/CustomerOrdersDrawer.tsx`
- `src/App.tsx`
- `src/lib/customer-flow.ts`
- `src/lib/customer-engagement.ts`
- `tests/customer-flow.test.ts`
- `tests/customer-engagement.test.ts`

Mudanca:

- quando o pagamento e confirmado, a rota redireciona automaticamente para:

```txt
/minhas-compras?order=ID_DO_PEDIDO&status=paid
```

Impacto:

- o usuario nao fica parado em uma tela intermediaria;
- a aplicacao abre uma pagina dedicada "Minhas Compras";
- o pedido fica destacado;
- o carrinho e limpo;
- o cliente ve imediatamente o que comprou.
- existe botao "Atualizar status" para recarregar pedidos;
- o painel mostra banner de pagamento confirmado, pendente ou cancelado;
- foram adicionados testes para os links de pos-pagamento e compartilhamento.

## Pontos de atrito encontrados

### 1. Painel de compras e uma gaveta lateral

Problema:

- em desktop funciona bem;
- em mobile pode ficar apertado para recibo, varios itens, botoes e downloads;
- apos pagamento, uma tela dedicada passa mais confianca do que uma gaveta.

Melhoria aplicada:

- criar rota `/minhas-compras`;
- manter a gaveta para acesso rapido;
- usar a rota dedicada depois do pagamento.

Status: implementado.

### 2. Modal de pagamento e gaveta podem disputar atencao

Problema:

- hoje o fluxo pode abrir aviso de pagamento e tambem abrir "Minhas Compras";
- o cliente pode precisar fechar um modal para ver os arquivos.

Melhoria recomendada:

- no pos-pagamento aprovado, nao usar modal sobreposto;
- mostrar um banner dentro do painel:
  - "Pagamento confirmado";
  - numero do pedido;
  - total;
  - "Baixar tudo";
  - "Copiar recibo".

Prioridade: alta.

### 3. Pedido pendente precisa ser mais claro

Problema:

- se a InfinitePay ainda nao confirmou, o usuario ve mensagem pendente, mas pode nao entender o que fazer.

Melhoria recomendada:

- mostrar estado "Aguardando confirmacao da operadora";
- incluir texto curto:
  - "Isso pode levar alguns minutos";
  - "Voce pode fechar esta tela e voltar em Minhas Compras";
  - "Se o pagamento foi aprovado, o download libera automaticamente".
- adicionar botao "Atualizar status".

Prioridade: alta.

### 4. Recibo minimo existe, mas poderia ser mais completo

Problema:

- o recibo atual e copiavel em texto;
- nao existe tela/arquivo formal de recibo.

Melhoria recomendada:

- criar rota `/pedidos/:id/recibo`;
- permitir imprimir/salvar PDF pelo navegador;
- exibir:
  - nome do comprador;
  - email;
  - CPF mascarado;
  - id do pedido;
  - id externo do pagamento;
  - data;
  - itens;
  - total;
  - status;
  - observacao de entrega digital.

Prioridade: media.

### 5. Downloads precisam estar acima da dobra

Problema:

- se o pedido tiver muitos itens, os botoes podem ficar visualmente dispersos.

Melhoria recomendada:

- no pedido destacado apos pagamento, colocar no topo:
  - thumbnail principal;
  - quantidade de itens;
  - botao "Baixar tudo";
  - botao "Ver recibo";
  - status "Pago".

Prioridade: alta.

### 6. Usuario deslogado no retorno do pagamento

Problema:

- se a sessao local expirar ou o pagamento for aberto em outro navegador, o painel nao consegue listar compras.

Melhoria recomendada:

- ao receber `payment=success&order=ID` sem usuario logado:
  - abrir login;
  - apos login, abrir "Minhas Compras";
  - destacar pedido se pertencer ao usuario.

Prioridade: alta.

### 7. Compartilhamento de item comprado ainda usa link publico da vitrine

Problema:

- isso e bom para recomendar imagem, mas nao compartilha o arquivo comprado.
- deve ficar claro que o link compartilhado e da vitrine, nao do download privado.

Melhoria recomendada:

- renomear acao para "Compartilhar vitrine";
- manter download privado separado.

Prioridade: media.

## Fluxo ideal recomendado

### Fluxo aprovado

1. Cliente paga na InfinitePay.
2. InfinitePay redireciona para `/pagamento/sucesso`.
3. Aplicacao confirma pagamento.
4. Aplicacao redireciona para `/minhas-compras?order=ID&status=paid`.
5. Tela mostra banner:

```txt
Pagamento confirmado
Pedido #12345678
Suas imagens estao liberadas.
```

6. Pedido comprado aparece primeiro e destacado.
7. Acoes principais aparecem imediatamente:
   - Baixar tudo;
   - Baixar item;
   - Ver recibo;
   - Compartilhar vitrine;
   - Favoritar.

### Fluxo pendente

1. Cliente volta da InfinitePay.
2. Aplicacao tenta confirmar.
3. Se ainda nao confirmado:

```txt
Confirmacao pendente
Estamos aguardando a InfinitePay confirmar o pagamento.
```

4. Mostrar:
   - botao "Atualizar status";
   - botao "Voltar para loja";
   - link para "Minhas Compras".

### Fluxo cancelado

1. Cliente cancela pagamento.
2. Aplicacao abre painel com pedido pendente.
3. Mostrar botao "Pagar novamente".
4. Carrinho nao deve perder os itens se o pedido nao foi pago.

## Melhorias priorizadas

### Alta prioridade

1. Se usuario estiver deslogado no retorno, abrir login automaticamente e continuar para o pedido apos login.
2. Evoluir `/minhas-compras` para uma estrutura com abas: Compras, Favoritos e Pendentes.
3. Criar endpoint de consulta de status por pedido para o botao "Atualizar status" verificar InfinitePay, nao apenas recarregar a lista.
4. Melhorar estados vazios e erro com acoes mais especificas.

### Media prioridade

1. Criar pagina de recibo imprimivel.
2. Enviar email de confirmacao de compra com link para o painel.
3. Separar abas no painel:
   - Compras;
   - Favoritos;
   - Pendentes.
4. Mostrar dados do comprador de forma resumida e segura.
5. Adicionar auditoria de visualizacao/download no painel do cliente.

### Baixa prioridade

1. Adicionar avaliacao/feedback apos download.
2. Mostrar recomendacoes baseadas em favoritos e likes.
3. Criar historico de downloads para o cliente.

## Checklist manual para validar o fluxo

### Pagamento aprovado

```md
- [ ] Adicionar uma foto ao carrinho.
- [ ] Entrar/cadastrar cliente.
- [ ] Finalizar checkout.
- [ ] Pagar na InfinitePay.
- [ ] Retornar para `/pagamento/sucesso`.
- [ ] Confirmar redirecionamento automatico para loja/painel.
- [ ] Confirmar abertura de "Minhas Compras".
- [ ] Confirmar pedido destacado.
- [ ] Confirmar status "Pago".
- [ ] Confirmar botao "Baixar tudo".
- [ ] Confirmar botao "Baixar" por item.
- [ ] Confirmar botao "Recibo".
- [ ] Confirmar que carrinho foi limpo.
```

### Pagamento pendente

```md
- [ ] Simular retorno sem confirmacao completa da InfinitePay.
- [ ] Confirmar mensagem de pendencia.
- [ ] Confirmar que pedido aparece em "Minhas Compras".
- [ ] Confirmar que nao existe download liberado.
- [ ] Confirmar que ha opcao de pagar novamente ou atualizar status.
```

### Pagamento cancelado

```md
- [ ] Cancelar pagamento na InfinitePay.
- [ ] Confirmar mensagem de cancelamento.
- [ ] Confirmar pedido pendente/cancelado no painel.
- [ ] Confirmar botao "Pagar" quando houver checkoutUrl.
```

## Conclusao

O fluxo atual ja tem a base correta: pedido, pagamento, confirmacao, painel, recibo e download. A melhoria mais importante e transformar o pos-pagamento em uma experiencia de painel clara, sem depender de o usuario procurar onde estao os arquivos.

Foi implementada uma rota dedicada `/minhas-compras`, com banner de retorno de pagamento, pedido destacado, recibo, download e favoritos. A proxima evolucao recomendada e tratar automaticamente o usuario deslogado no retorno do pagamento e criar uma verificacao ativa de status junto a InfinitePay para pedidos pendentes.
