# Auditoria financeira — vendas do fotógrafo Gustavo Olyver

Gerado em: 2026-07-17T17:14:44 (America/Porto_Velho)  
Banco consultado até: 2026-07-17T17:14:38 (America/Porto_Velho)  
Modo: transação PostgreSQL REPEATABLE READ, READ ONLY.

## A. Resumo executivo

| Indicador | Resultado |
|---|---:|
| Fotógrafo | FOTÓGRAFO OFICIAL FUNPACE |
| Photographer ID | `e996a6b5-fb69-4e79-bd73-80a92ea3ea39` |
| User/Auth ID | `e996a6b5-fb69-4e79-bd73-80a92ea3ea39` |
| E-mail cadastrado | criativastudiobr@gmail.com |
| Telefone |  |
| Username / slug | gustavoolyver / gustavoolyver |
| Nome no Auth | Criativa Studio |
| Cadastro / status | 2026-05-22T17:36:27 / active |
| Período analisado | 2026-05-26T18:46:00 a 2026-07-15T19:39:13 |
| Primeira venda | 2026-05-26T18:46:00 |
| Última venda | 2026-07-15T19:39:13 |
| Pedidos pagos definitivos | 36 |
| Fotos/itens vendidos definitivos | 50 |
| Subtotal original alocado (estimado) | R$ 708,69 |
| Valor bruto cobrado nos itens | R$ 612,48 |
| Descontos alocados (estimados) | R$ 96,21 |
| Valor efetivamente recebido atribuído aos itens | R$ 612,48 |
| Taxas financeiras do gateway | Não persistidas de forma normalizada |
| Comissão FunPace comprovada | R$ 244,96 |
| Valor total devido ao fotógrafo antes de repasses | R$ 367,52 |
| Valor já repassado com evidência mínima | R$ 0,00 |
| Saldo final pendente comprovável | **R$ 367,52** |
| Estornos/reembolsos/chargebacks | 0 itens / R$ 0,00 líquidos |
| Itens em pedidos cancelados | 26 |
| Divergências/observações | 50 |
| Nível de confiança | **Medio** |

## B. Identificação do fotógrafo

- ID `e996a6b5-fb69-4e79-bd73-80a92ea3ea39`: FOTÓGRAFO OFICIAL FUNPACE / criativastudiobr@gmail.com; username `gustavoolyver`; slug `gustavoolyver`; score 45; 8176 produtos; 12 eventos; **selecionado**.

O cadastro selecionado possui 8176 produtos (8134 fotos) e 13 eventos associados. Contas candidatas adicionais não foram somadas automaticamente.

## C. Estrutura e relacionamentos

A venda nasce em `orders`; cada mídia vendida é congelada em `order_items`, ligada ao fotógrafo por `vendedorId`/`ownerId`, à foto por `productId` e ao evento por `eventId` ou pelo snapshot textual `event`. O pagamento é ligado ao pedido por `payments.orderId`; os webhooks ficam em `payment_events.orderId`; e a comissão líquida por item fica em `photographer_transactions.orderItemId`. Saques são registrados em `withdrawal_requests`, mas o schema não possui vínculo entre saque e vendas específicas.

Tabelas financeiras e relacionadas consultadas:

- `coupons` (estimativa estatística: 2 registros)
- `download_access` (estimativa estatística: 54 registros)
- `download_events` (estimativa estatística: 170 registros)
- `download_tokens` (estimativa estatística: 63 registros)
- `downloads` (estimativa estatística: 122 registros)
- `events` (estimativa estatística: 16 registros)
- `order_items` (estimativa estatística: 91 registros)
- `orders` (estimativa estatística: 88 registros)
- `payment_events` (estimativa estatística: 107 registros)
- `payments` (estimativa estatística: 82 registros)
- `photographer_referrals` (estimativa estatística: 0 registros)
- `photographer_transactions` (estimativa estatística: 55 registros)
- `photographer_wallets` (estimativa estatística: 0 registros)
- `photographers` (estimativa estatística: 24 registros)
- `platform_settings` (estimativa estatística: 1 registros)
- `product_likes` (estimativa estatística: 80 registros)
- `products` (estimativa estatística: 8200 registros)
- `run-events` (estimativa estatística: 1 registros)
- `run-payment-events` (estimativa estatística: 406 registros)
- `run-payment-reconciliations` (estimativa estatística: 39 registros)
- `run-payments` (estimativa estatística: 314 registros)
- `withdrawal_requests` (estimativa estatística: 2 registros)

Foram examinados 8665 registros nas nove tabelas centrais contabilizadas (ordens, itens, pagamentos, webhooks, transações, saques, produtos, eventos e fotógrafos).

### Registros legados/adicionais

- `run-events`: 1 registros; 0 correspondências por ID/e-mail/nome do fotógrafo; colunas: `id`, `name`, `slug`, `status`, `date`, `start_time`, `location_name`, `city`, `state`.
- `run-payment-events`: 406 registros; 0 correspondências por ID/e-mail/nome do fotógrafo; colunas: `id`, `payment_id`, `provider_event_id`, `event_type`, `payload`, `received_at`.
- `run-payment-reconciliations`: 39 registros; 0 correspondências por ID/e-mail/nome do fotógrafo; colunas: `id`, `run_id`, `issue_key`, `issue_code`, `severity`, `resolution_status`, `registration_id`, `payment_id`, `gateway_transaction_id`, `expected_amount_cents`, `gateway_amount_cents`, `details`, `first_detected_at`, `last_detected_at`, `resolved_at`, `resolved_by`, `resolution_notes`.
- `run-payments`: 314 registros; 0 correspondências por ID/e-mail/nome do fotógrafo; colunas: `id`, `registration_id`, `provider`, `status`, `amount_cents`, `provider_payment_id`, `checkout_url`, `created_at`, `updated_at`, `expires_at`, `paid_at`, `gateway_status`, `gateway_transaction_id`, `gateway_payload`.

## D. Critério de venda válida e conciliação

O total definitivo inclui somente item cujo pedido está `paid`, possui ao menos uma evidência financeira adicional (payment/webhook aprovado ou transação do fotógrafo), não foi marcado como duplicado e possui comissão monetária persistida em `photographer_transactions` ou snapshot do item. Pedidos pendentes, falhos, cancelados, reembolsados, duplicados ou sem comissão comprovada ficam fora do total.

Itens conciliados/avaliados: 80; itens válidos com evidência financeira: 50; itens incluídos no total definitivo: 50; itens excluídos: 30.

### Conciliação atual com a InfinitePay

Foram tentados 36 pedidos pagos: 6 confirmados como paid pelo endpoint `payment_check`, 11 sem identificadores suficientes, 0 falhas de consulta e 19 respostas não pagas. A consulta foi somente de verificação e não alterou pedidos ou pagamentos. Detalhes: `auditoria-gustavo-olyver-infinitepay.csv`.

## E. Regra de comissão

O código atual calcula por item `platformFee = price × platformFeePercent` e `netAmount = price - platformFee`. A implementação efetiva usa o percentual global de `platform_settings` no fulfillment; o documento arquitetural menciona override por `photographers.commissionPercent`, mas esse override não é aplicado pela implementação atual. Configuração atual: 40.00%; comissão específica do Gustavo: nula. Fontes/rates observadas nos itens definitivos: 40.00|photographer_transactions, 40.02|photographer_transactions, 39.97|photographer_transactions. Uma cópia de 2026-06-01 registra percentual global de 40%, evidenciando que o valor global pode ter mudado; por isso os valores persistidos por item/transação prevalecem sobre a configuração atual.

## F. Total por evento

Arquivo: `auditoria-gustavo-olyver-eventos.csv` (13 linhas).

## G. Total por mês

Arquivo: `auditoria-gustavo-olyver-mensal.csv` (3 linhas).

## H. Relatório detalhado por venda

Arquivo: `auditoria-gustavo-olyver-vendas.csv` (80 itens). Nomes e e-mails de clientes foram mascarados; CPF, telefone do cliente, chave PIX e payload bruto não foram exportados.

## I. Pedidos excluídos e divergências

Excluídos: 30. Divergências/observações: 50. Consulte `auditoria-gustavo-olyver-excluidos.csv` e `auditoria-gustavo-olyver-divergencias.csv`.

## J. Repasses anteriores

Solicitações localizadas: 1; pendentes: 1, total R$ 359,47; marcadas como pagas: 0; com evidência mínima (status paid + data processada + nota/log): 0, total R$ 0,00. O saque pendente não foi abatido. Vendas confirmadas depois da solicitação pendente somam R$ 8,05 líquidos. O banco não vincula saques a vendas individuais e não armazena comprovante bancário estruturado; portanto isso exige conferência documental externa antes do pagamento.

## K. Valor final recomendado

| Cálculo | Valor |
|---|---:|
| Total bruto cobrado nas vendas do Gustavo | R$ 612,48 |
| (-) Comissão da FunPace | R$ 244,96 |
| (-) Taxas atribuídas ao fotógrafo | R$ 0,00 (não comprovadas) |
| (-) Estornos/reembolsos líquidos | R$ 0,00 |
| (-) Repasses anteriores comprovados no sistema | R$ 0,00 |
| (=) Saldo final pendente comprovável | **R$ 367,52** |

Recomendação: não pagar automaticamente. Antes do repasse, conferir no portal/extrato InfinitePay as taxas e os pagamentos listados, anexar comprovantes dos saques anteriores e validar as divergências excluídas.

## L. Nível de confiança

**Medio.** A confiança considera a presença de pedido pago, evidência adicional e comissão persistida por item. Ela é reduzida quando faltam webhook, taxa de gateway normalizada, histórico temporal da configuração ou comprovante externo de saque.

## M. Confirmações manuais pendentes

- Confirmar no extrato/portal InfinitePay as taxas financeiras, pois o schema não persiste uma taxa de gateway normalizada por pagamento.
- Confirmar a política histórica quando o percentual global mudou; o banco guarda snapshots/transações, mas não uma tabela temporal de configurações.
- Revisar os itens excluídos por falta de evidência ou comissão comprovada.

## N. Limitações e trilha de auditoria

A auditoria não executou UPDATE, DELETE, INSERT, RPC mutante, deploy ou chamada de pagamento. A leitura ocorreu em snapshot repetível. Valores monetários foram convertidos para centavos inteiros. Descontos por item são alocações estimadas porque o pedido persiste o subtotal/desconto total e o item já com preço líquido. Taxas do gateway não são tratadas como zero; ficam em branco/não comprovadas.
