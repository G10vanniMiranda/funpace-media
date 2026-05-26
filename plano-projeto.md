# Plano do Projeto FunPace

## 1. Visao Geral

O FunPace e uma plataforma para venda de fotos e videos de eventos esportivos, conectando atletas, fotografos e administradores em um fluxo unico. A vitrine publica permite que atletas encontrem suas capturas por numero de peito ou selfie, adicionem produtos ao carrinho e finalizem a compra. O fotografo gerencia suas capturas, acompanha seus ganhos e publica novos produtos. O administrador aprova fotografos, acompanha metricas gerais e controla configuracoes da plataforma.

Neste momento, o frontend ja possui uma base funcional com dados mocados, simulacao de upload local e interfaces principais para os tres perfis: publico, fotografo e administrador.

## 2. Objetivo do Projeto

Construir uma plataforma digital escalavel para comercializacao de midias esportivas, com foco em:

- facilitar a busca de fotos e videos pelos atletas;
- permitir que fotografos publiquem e gerenciem suas capturas;
- centralizar o controle administrativo da operacao;
- preparar a aplicacao para integracao com storage, banco de dados e checkout real;
- separar claramente o ambiente de testes com mocks do ambiente de producao.

## 3. Base Atual do Frontend

O frontend esta organizado em tres fluxos principais.

### 3.1 Vitrine Publica

Arquivo principal: `src/App.tsx`

Funcionalidades atuais:

- listagem de fotos e videos no formato `Product`;
- busca por numero de peito;
- busca por selfie com simulacao visual;
- carrinho de compras;
- cadastro de cliente com CPF opcional;
- checkout com CPF obrigatorio e validacao basica antes de iniciar pagamento;
- criacao de pedido real em `orders` e itens em `order_items` antes do redirecionamento de pagamento;
- fluxo de checkout via `/api/checkout/create-session`.

Este fluxo representa a experiencia principal do atleta: encontrar suas midias, selecionar os produtos desejados e iniciar a compra.

### 3.2 Painel do Fotografo

Arquivo principal: `src/components/PhotographerDashboard.tsx`

Funcionalidades atuais:

- login e cadastro de fotografo com necessidade de aprovacao;
- cadastro de fotografo com CPF obrigatorio;
- acesso ao dashboard do fotografo;
- visualizacao de produtos e ganhos;
- cadastro de produto pelo modal **Nova Captura**;
- upload local de imagens e videos;
- preview grande da imagem ou video antes da publicacao.

O painel do fotografo ja contempla o fluxo essencial de publicacao de midias, mas ainda depende de URLs temporarias do navegador enquanto o storage definitivo nao estiver implementado.

### 3.3 Painel do Administrador

Arquivo principal: `src/components/AdminDashboard.tsx`

Funcionalidades atuais:

- aprovacao de fotografos;
- consulta de metricas gerais;
- simulacao de informacoes financeiras;
- simulacao de configuracoes da plataforma.

O painel administrativo funciona como base para a gestao operacional da plataforma, mas ainda precisa evoluir para dados reais, controles financeiros efetivos e configuracoes persistentes.

## 4. Estrutura de Dados Mocados

Enquanto o storage definitivo e a persistencia real nao estiverem prontos, a aplicacao utiliza dados mocados para desenvolvimento e validacao visual.

Arquivo principal: `src/data.ts`

Dados disponiveis:

- `MOCK_PHOTOGRAPHERS`;
- `MOCK_PHOTOS`;
- `MOCK_VIDEOS`.

O modo de dados e controlado por variavel de ambiente:

- `VITE_DATA_MODE=production`: usa Supabase Auth, Supabase REST e a API de storage configurada por `MEDIA_STORAGE_PROVIDER`.
- `VITE_DATA_MODE=mock`: usa os dados de `src/data.ts`, sem depender de Supabase para carregar vitrine e paines.

No `PhotographerDashboard`, o preview local ainda utiliza `URL.createObjectURL(file)` para exibir a midia antes da publicacao. Ao publicar, o arquivo e enviado para `/api/media/upload`, que usa o provider definido em `MEDIA_STORAGE_PROVIDER`, e a tabela `products` recebe a URL permanente e o `storagePath`.

Essa abordagem permite testar:

- selecao de imagem;
- selecao de video;
- preview do arquivo;
- listagem visual do produto;
- cadastro visual antes do envio definitivo.

Observacao importante: URLs criadas com `URL.createObjectURL(file)` continuam sendo temporarias e devem ser usadas apenas para preview. O armazenamento final deve usar a URL gerada pela API de storage configurada no backend.

## 5. Fluxo de Cadastro de Produto

O fluxo atual de cadastro de produto pelo fotografo segue as etapas abaixo:

1. O fotografo acessa o painel.
2. Clica em **Nova Captura**.
3. Seleciona uma ou mais imagens ou videos.
4. Cada arquivo selecionado aparece em uma lista com:
   - miniatura;
   - nome do arquivo;
   - preco individual;
   - opcao de selecao para preview.
5. O painel lateral exibe o preview antes da publicacao:
   - imagens sao renderizadas com `img`;
   - videos sao renderizados com `video` e controles nativos.
6. O fotografo preenche as informacoes complementares:
   - evento ou colecao;
   - checkpoint ou localizacao.
   - numero de peito.
7. Clica em **Publicar Produtos**.
8. O produto e salvo por meio de `productService.addProduct`.

Esse fluxo ja valida a experiencia principal de publicacao, mas ainda precisa receber campos adicionais e persistencia real para estar pronto para producao.

## 6. Modelo Atual do Produto

O modelo oficial da midia vendavel e a entidade unificada `Product`, definida em `src/types.ts` e persistida na tabela `products` do Supabase. Fotos e videos nao devem ser salvos em tabelas separadas; a diferenca entre eles deve ser controlada pelo campo `type`.

Campos principais:

- `id`;
- `name`;
- `price`;
- `url`;
- `type`: `IMG`, `VIDEO` ou `VIEW`;
- `vendedorId`;
- `bib`;
- `event`;
- `checkpoint`;
- `thumbnailUrl`;
- `duration`.
- `storagePath`;
- `status`: `draft`, `published` ou `removed`.

Convencoes do modelo:

- fotos usam `type: IMG`;
- videos usam `type: VIDEO`;
- visualizacoes especiais usam `type: VIEW`;
- a vitrine separa fotos e videos apenas por filtro de `type`;
- `vendedorId` representa o fotografo dono do produto;
- `event` representa o nome do evento ou colecao;
- `checkpoint` representa o ponto de captura ou localizacao;
- `bib` representa o numero de peito do atleta.

Esse modelo cobre os dados basicos de uma midia vendavel. Para producao, recomenda-se validar se serao necessarios campos adicionais, como status de publicacao, data de criacao, identificador do storage, metadados do evento e controle de propriedade da midia.

## 7. Analise Tecnica

### Pontos Positivos

- A aplicacao ja esta dividida por perfil de usuario: publico, fotografo e administrador.
- O fluxo de publicacao de produtos ja possui uma experiencia visual testavel.
- A estrutura de mocks permite evoluir a interface sem bloquear o desenvolvimento por falta de backend.
- O modelo `Product` ja contempla imagens, videos e dados de evento.
- A presenca de carrinho e checkout indica que a jornada de compra ja esta desenhada.
- As tabelas Supabase `products` e `photographers` ja foram criadas com colunas compativeis com o frontend.
- As policies RLS basicas para `products` e `photographers` ja foram aplicadas e validadas.
- O upload de produto passa pelo endpoint `/api/media/upload`, mantendo o token do storage apenas no backend.
- O upload de produto ja envia arquivos reais para o storage configurado e salva `url`/`storagePath` permanentes em `products`.
- Videos publicados pelo painel do fotografo ja geram thumbnail JPEG automaticamente e salvam `thumbnailUrl`.
- O modo mock e o modo producao ja foram separados por `VITE_DATA_MODE`.
- O modal de cadastro ja possui campo de numero de peito e salva o valor em `Product.bib`.
- O checkout ja valida produtos reais no banco, recalcula total no servidor e registra pedido pendente antes do pagamento.
- A estrutura tecnica para eventos de pagamento existe, mas o webhook nao sera usado como requisito nesta fase.
- O painel do fotografo ja permite editar dados de produtos publicados, incluindo nome, preco, evento, checkpoint, numero de peito e status.
- O painel do fotografo ja permite remover produtos da vitrine por status `removed`, preservando historico e referencias de pedidos.
- O painel administrativo ja carrega metricas reais de pedidos e produtos: GMV pago, fees da plataforma, pedidos pendentes, total de pedidos, produtos publicados/removidos e logs financeiros recentes.
- Clientes autenticados ja conseguem abrir **Minhas Compras** para visualizar historico de pedidos, status, total e retomar pagamento pendente quando houver `checkoutUrl`.
- O painel do fotografo ja possui busca e filtros por texto, tipo de midia e status na listagem de produtos.
- O painel administrativo ja permite confirmar manualmente pagamentos pendentes ou cancelar pedidos quando nao houver webhook.
- Pedidos agora carregam seus itens comprados (`order_items`) e exibem detalhes no historico do cliente e no painel financeiro do administrador.
- As configuracoes administrativas da plataforma ja sao persistidas no Supabase em `platform_settings`.
- O painel administrativo ja possui relatorios reais de receita por evento e por fotografo com base nos pedidos pagos.

### Pontos de Atencao

- Parte do financeiro do administrador ainda precisa evoluir para acoes reais de repasse e relatorios.
- Ainda faltam testes automatizados cobrindo os principais fluxos do frontend.
- O fluxo de login/cadastro de fotografo ja foi conectado ao Supabase Auth.
- O login administrativo ja usa Supabase Auth e exige `app_metadata.role = admin`.
- O usuario administrador real ja deve ter a claim `app_metadata.role = admin` aplicada no Supabase.

## 8. Proximas Etapas

### 8.1 Prioridade Alta

1. Compra real de ponta a ponta com link de pagamento da InfinitePay: concluida em 20/05/2026.
2. Confirmacao operacional sem depender de webhook nesta fase: usar a verificacao automatica no retorno do checkout quando disponivel e, como fallback operacional, o painel administrativo em **Fluxo de Caixa > Pagamentos Pendentes** para confirmar manualmente pedidos pagos ou cancelar pedidos nao pagos.

### 8.2 Prioridade Media

1. Validar em producao o fluxo completo apos pagamento confirmado: pedido pago, download protegido em **Minhas Compras**, venda no painel do fotografo e receita no admin.
2. Criar ou revisar testes automatizados para checkout, confirmacao de pagamento, historico de compras, historico financeiro do fotografo e download protegido.
3. Evoluir o fluxo de repasse/saque para fotografos com regras operacionais finais.

### 8.3 Prioridade Baixa

1. Melhorar filtros da vitrine publica.
2. Adicionar historico de vendas para o fotografo.
3. Adicionar relatorios administrativos.
4. Melhorar configuracoes operacionais da plataforma.

## 9. Plano de Testes

Os testes de frontend devem cobrir os principais fluxos de uso:

- selecionar imagem;
- selecionar video;
- trocar item no preview;
- publicar produto;
- bloquear publicacao sem arquivo;
- validar preenchimento de evento ou colecao;
- validar preenchimento de checkpoint ou localizacao;
- validar busca por numero de peito;
- validar comportamento do carrinho;
- validar inicio do checkout.

Com a evolucao para producao, tambem sera necessario testar upload real, persistencia no banco, geracao de thumbnails e integracao com checkout.

## 10. Painel do Administrador

O painel do administrador deve evoluir para centralizar a gestao da plataforma. As principais responsabilidades previstas sao:

- aprovar ou reprovar fotografos;
- acompanhar quantidade de produtos publicados;
- acompanhar vendas e receita;
- consultar metricas por evento;
- gerenciar configuracoes da plataforma;
- acompanhar indicadores financeiros;
- visualizar possiveis inconsistencias operacionais.

## 11. Painel do Fotografo

O painel do fotografo deve ser o ambiente principal de trabalho para quem publica midias. As principais responsabilidades previstas sao:

- cadastrar fotos e videos;
- cadastrar CPF do fotografo no credenciamento;
- informar evento, checkpoint e numero de peito;
- visualizar produtos publicados;
- editar produtos;
- remover produtos;
- acompanhar ganhos;
- consultar historico de vendas;
- acompanhar status de aprovacao do proprio cadastro.

## 12. Conclusao

O projeto FunPace ja possui uma base inicial consistente para validar a jornada principal da plataforma: busca de midias, publicacao por fotografos, carrinho, checkout e administracao. A proxima fase deve concentrar esforcos na substituicao dos mocks por integracoes reais, especialmente storage, banco de dados, thumbnails, checkout e regras administrativas.

Com essas evolucoes, a aplicacao deixara de ser apenas uma simulacao funcional de frontend e passara a operar como uma plataforma preparada para uso real em eventos esportivos.
