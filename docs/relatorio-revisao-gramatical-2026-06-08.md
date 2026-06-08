# Relatório de revisão gramatical - Funpace Media

Data: 2026-06-08

## Resumo

Revisão gramatical aplicada em textos visíveis da plataforma, mensagens de erro, alertas, labels, placeholders, e-mails automáticos, WhatsApp automático e respostas públicas de API.

- Arquivos alterados: 48
- Linhas revisadas/substituídas no diff: 587 inserções e 593 remoções
- Regras de negocio alteradas: nenhuma
- Validação executada: `npm run build`
- Resultado: build concluído com sucesso

## Arquivos revisados

- `src/App.tsx`
- `src/components/AdminDashboard.tsx`
- `src/components/AuthView.tsx`
- `src/components/CartDrawer.tsx`
- `src/components/CheckoutPage.tsx`
- `src/components/CustomerAccountPage.tsx`
- `src/components/CustomerOrdersDrawer.tsx`
- `src/components/EventGrid.tsx`
- `src/components/FaceSearchModal.tsx`
- `src/components/Footer.tsx`
- `src/components/Hero.tsx`
- `src/components/PhotoGrid.tsx`
- `src/components/PhotographerDashboard.tsx`
- `src/components/PhotographerLogin.tsx`
- `src/components/PhotographerPasswordSetup.tsx`
- `src/components/ProtectedMedia.tsx`
- `src/components/ProtectedVideoPreview.tsx`
- `src/components/VideoGrid.tsx`
- `src/lib/customer-engagement.ts`
- `src/lib/services.ts`
- `src/lib/supabase.ts`
- `src/routes/Contato.tsx`
- `src/routes/Faq.tsx`
- `src/routes/ParaFotografos.tsx`
- `src/routes/Precos.tsx`
- `src/routes/Privacidade.tsx`
- `src/routes/Termos.tsx`
- `src/routes/pagamento/sucesso.tsx`
- `server/shared/emailTemplates.ts`
- `server/shared/utils.ts`
- `server/_utils.ts`
- `server/face/face-handlers.ts`
- `server/api/admin/orders/status.ts`
- `server/api/admin/payments/recovery.ts`
- `server/api/admin/photographers/action.ts`
- `api/_security.ts`
- `api/admin.ts`
- `api/checkout/confirm.ts`
- `api/checkout/create-session.ts`
- `api/downloads/authorize.ts`
- `api/face.ts`
- `api/media/sign.ts`
- `api/media/storage-stats.ts`
- `api/media/upload.ts`
- `api/photographers/claim.ts`
- `api/photographers/request.ts`
- `api/system.ts`
- `api/webhooks/infinitepay.ts`

## Principais textos alterados

- `Nao foi possivel...` -> `Não foi possível...`
- `Fotografo` / `fotografo` -> `Fotógrafo` / `fotógrafo`
- `Midia` / `midia` / `midias` -> `Mídia` / `mídia` / `mídias`
- `confirmacao`, `liberacao`, `recuperacao`, `solicitacao` -> formas acentuadas
- `Preco`, `Comissao`, `Historico`, `Configuracoes` -> formas acentuadas
- `item(ns)`, `foto(s)`, `produto(s)`, `evento(s)` -> plural dinâmico em telas críticas
- Status de pagamento em inglês no admin -> `Pago`, `Pendente`, `Recusado`, `Cancelado`, `Reembolsado`
- Mensagens técnicas de API foram reescritas com português correto quando podem chegar ao usuário

## Problemas encontrados

- Ausência de camada única de i18n; os textos estão espalhados entre componentes, serviços e APIs.
- Uso recorrente de texto sem acentuação em mensagens de erro e sucesso.
- Inconsistencia entre `fotografo`, `Fotografo`, `Fotógrafo` e `fotógrafo`.
- Inconsistencia entre `midia`, `Midias`, `mídia` e `mídias`.
- Plurais genéricos como `item(ns)`, `produto(s)` e `foto(s)`.
- Alguns status operacionais apareciam em inglês no painel administrativo.
- Mensagens técnicas de backend poderiam aparecer diretamente para usuários finais.

## Padronização aplicada

- Termo padrão para assets vendidos: `mídia` / `mídias`.
- Termo padrão para profissional: `fotógrafo` / `fotógrafos`.
- Termo padrão para funcionalidade: `busca facial`.
- Termos de pagamento: `pagamento confirmado`, `pagamento aprovado`, `checkout seguro`, `downloads liberados`.
- Mensagens de erro no padrao: `Não foi possível [ação]. Tente novamente...`

## Sugestões de UX Writing

- Criar um arquivo central de mensagens, mesmo sem i18n completo, para evitar textos duplicados.
- Adotar helpers de pluralização para `foto`, `mídia`, `evento`, `pedido`, `produto` e `item`.
- Mapear status técnicos para labels de interface em uma única função.
- Evitar expor detalhes como `HTTP`, `schema`, `provider` e nomes de colunas em mensagens para comprador.
- Separar mensagens internas de log das mensagens públicas exibidas em tela.
