# FunPace Media — Fase 3A: auditoria histórica facial

Data da auditoria: 2026-07-15  
Modo: somente leitura  
Mutações em banco, AWS e storage: 0

## Resumo executivo

A Fase 2 eliminou todo o saldo elegível do pipeline moderno. A Fase 3A encontrou 35.058 violações de regras, distribuídas por 19.238 entidades únicas. Os dados permaneceram inalterados antes e depois da auditoria.

O principal encadeamento legado é:

1. 2.066 produtos estão marcados como `indexed`, mas não possuem `photo_faces` e não têm `eventId` válido.
2. A AWS contém 3.037 faces para esses produtos; os objetos das 2.066 fotos existem no storage.
3. Para 322 desses produtos, o evento pode ser inferido por nome exato + fotógrafo único com confiança de 98%; eles representam 393 faces AWS.
4. Os outros 1.744 produtos, que representam 2.644 faces AWS, exigem validação humana do evento.
5. Há 13.142 linhas históricas em `photo_faces` sem `photographer_id`. Em 8.488, produto e evento concordam sobre o fotógrafo; 4.654 têm evidência insuficiente ou conflitante.

## Inventário global

| Item | Total |
|---|---:|
| Products | 8.131 |
| Fotos (`IMG`) | 8.089 |
| Indexed | 7.343 |
| Pending | 1 |
| Processing | 0 |
| No face | 297 |
| Failed | 4 |
| `photo_faces` | 16.655 |
| Faces AWS | 19.692 |
| Objetos no storage | 16.321 |
| Objetos bucket externo | 16.292 |
| Objetos Supabase Storage | 29 |
| Eventos | 16 |
| Fotógrafos | 24 |

O único `pending`, `35ef862b-239b-4b32-8a09-4c1a631e0b17`, está com publicação `removed`. O arquivo existe e tem tamanho e checksum corretos, mas o registro não é elegível para o pipeline validado.

## Auditoria de `photo_faces`

- Indexed sem `photo_faces`: 2.066.
- Todos têm objeto de storage íntegro.
- Todos têm faces correspondentes na AWS: 3.037 faces no total.
- Todos estão bloqueados pela ausência de um `eventId` válido.
- 322 produtos / 393 faces: evento inferível com 98% de confiança.
- 1.744 produtos / 2.644 faces: evento não identificável automaticamente.
- FaceIds duplicados no banco: 0.
- Pares `photo_id + face_id` duplicados: 0.

## Auditoria AWS

| Classificação | Total | Risco |
|---|---:|---|
| Válida e totalmente vinculada | 3.513 | Baixo |
| Órfã de `photo_faces`, mas com produto e storage | 3.037 | Médio |
| Inconsistente por vínculo legado incompleto | 13.142 | Médio |
| Duplicada | 0 | — |
| Sem referência de produto | 0 | — |

A AWS não fornece data de criação nem último uso por meio de `ListFaces`; esses campos estão explicitamente marcados como indisponíveis nos detalhes.

## Eventos

- `eventId` ausente: 2.444 produtos.
- `eventId` inválido apontando para evento inexistente: 0.
- Divergência entre fotógrafo do produto e fotógrafo do evento: 612 produtos.
- Correção automática segura, confiança 98%: 349 produtos.
- Não identificável automaticamente: 2.707 produtos, sendo 2.095 sem evento e 612 divergentes.

## Fotógrafos

- Produto com divergência produto/evento: 612.
- `photo_faces.photographer_id` ausente: 13.142.
- Preenchimento automático seguro, porque produto e evento concordam: 8.488.
- Necessita revisão humana: 4.654.
- Produtos sem resolução automática: 612.

## Storage

- Fotos auditadas: 8.089.
- Objetos encontrados: 8.086.
- Checksum disponível: 8.073.
- Checksum comparado com o produto: 8.067.
- Divergência de tamanho/checksum: 0.
- Objetos não encontrados: 3.

Os três objetos não encontrados usam deliberadamente `https://controlled-failure.invalid/face-e2e.jpg` e são artefatos de testes controlados. Os 13 caminhos relativos inicialmente não resolvidos foram encontrados em `storage.objects` do Supabase.

## Matriz de reconciliação dependente

### Grupo A — seguro e imediato

- 349 produtos: preencher `eventId` inferido por correspondência única de nome + fotógrafo, confiança 98%.
- 8.488 `photo_faces`: preencher `photographer_id` quando produto e evento concordarem.
- Total de atualizações de campo seguras: 8.837.
- Risco: baixo.

### Grupo B — seguro após pré-requisito do Grupo A

- 322 produtos indexed, dentre os 349 acima: reconstruir 393 linhas de `photo_faces` a partir dos FaceIds já existentes na AWS.
- Não chamar `IndexFaces`.
- Risco: baixo a médio, porque o escopo de busca depende do evento inferido.

### Grupo C — revisão humana

- 1.744 produtos indexed sem evento: escolher evento para liberar reconstrução de 2.644 faces.
- 351 outros produtos sem evento não identificável.
- 612 produtos com divergência entre fotógrafo do produto e do evento.
- 4.654 `photo_faces` com fotógrafo não resolvível automaticamente.
- Risco: médio a alto.

### Grupo D — não recuperável como mídia real

- 3 URLs artificiais de falha controlada sem objeto de storage.
- Não há FaceId AWS sem referência de produto.
- Risco: baixo operacional; são artefatos de teste e devem permanecer intocados até autorização específica.

## Plano proposto para a Fase 3B

### 0. Preparação e bloqueios

1. Congelar manifests de entrada com IDs, valor atual, valor proposto e evidências.
2. Exportar snapshot das linhas afetadas antes de cada checkpoint.
3. Revalidar `pending`, `processing`, duplicações e contagens AWS/banco.
4. Abortar se qualquer valor atual divergir do snapshot da Fase 3A.

### 1. Resolver eventos seguros

- Processar 349 produtos em checkpoints de 25.
- Atualizar somente quando `eventId IS NULL` e o candidato continuar único.
- Não alterar nome, fotógrafo, storage ou status facial.
- Validar após cada checkpoint: produto/evento/fotógrafo, storage e contagem de faces AWS.

Idempotência: segunda execução não encontra `eventId IS NULL`.  
Rollback: restaurar o `eventId` anterior a partir do manifest assinado do checkpoint.

### 2. Reconstruir as 393 linhas seguras

- Processar os 322 produtos liberados pela etapa anterior em checkpoints de 25.
- Usar exclusivamente `ListFaces`/FaceIds existentes; não chamar `IndexFaces`.
- Inserir `photo_faces` com `ON CONFLICT (face_id) DO NOTHING`.
- Exigir correspondência exata entre `ExternalImageId`, produto, evento e fotógrafo.

Idempotência: chave única `face_id` e comparação prévia.  
Rollback: remover somente os FaceIds explicitamente registrados no manifest de inserções da execução; nenhuma face AWS é removida.

### 3. Completar fotógrafos seguros

- Atualizar 8.488 linhas em checkpoints de 500.
- Condição: `photographer_id IS NULL`, produto existente e `product.vendedorId = event.photographerId`.
- Não modificar linhas que já tenham fotógrafo.

Idempotência: guarda `IS NULL`.  
Rollback: restaurar os valores anteriores do snapshot, que devem ser nulos.

### 4. Validação intermediária

- Comparar FaceIds AWS e banco.
- Confirmar ausência de duplicações.
- Confirmar que nenhum status entrou em `processing`.
- Executar buscas faciais em pelo menos 20 amostras de cada evento afetado.
- Interromper se qualquer busca retornar produto de evento incorreto.

### 5. Fluxo manual

- Produzir planilha/manifest para 2.707 produtos com evento não resolvido ou divergente.
- Exigir aprovação humana de `eventId` e fotógrafo, com dupla conferência para confiança abaixo de 95%.
- Aplicar somente manifests aprovados, em checkpoints de 25.
- Depois do evento aprovado, reconstruir as 2.644 faces dos 1.744 produtos indexed sem `photo_faces`.

### 6. Resíduos AWS

- Executar nova auditoria após toda reconstrução.
- Não excluir faces na Fase 3B inicial.
- Qualquer FaceId ainda órfão deve entrar em uma autorização separada, com prova de ausência no banco, produtos, eventos e storage.

## Critérios de parada da Fase 3B

- candidato deixou de ser único;
- valor atual diverge do snapshot;
- erro de banco ou AWS;
- diferença de contagem entre manifest, AWS e banco;
- FaceId ou linha duplicada;
- vínculo produto/evento/fotógrafo divergente;
- busca facial retorna evento incorreto;
- qualquer operação exigiria reindexação ou exclusão AWS não autorizada.

## Estimativa

- Preparação e snapshots: 1–2 horas.
- Grupo A e validações: 2–4 horas.
- Reconstrução das 393 faces: 1–2 horas.
- Revisão humana: depende da identificação dos 2.707 produtos; estimativa de 1–3 dias úteis.
- Reconstrução pós-revisão e auditoria final: 3–6 horas.

