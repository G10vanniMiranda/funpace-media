# Arquitetura de integridade

```mermaid
flowchart LR
  S[Scheduler interno ou cron protegido] --> L[Advisory lock PostgreSQL]
  A[Admin: execução manual] --> L
  L --> Q[Snapshot read-only do banco]
  L --> W[AWS Rekognition: ListFaces]
  L --> B[Inventário da API de storage]
  Q --> E[Motor de evidências]
  W --> E
  B --> E
  E --> F[Findings + métricas + alertas]
  E -->|confiança menor que 99,9% ou legado| R[Fila de revisão]
  E -->|confiança maior ou igual a 99,9% + data de corte| C[Reconciliação allowlist]
  C --> T[Transação + chave idempotente]
  T --> G[Audit log antes/depois]
  F --> D[Painel administrativo]
  R --> D
  G --> D
```

O lock impede auditorias simultâneas. O snapshot do banco usa transação `REPEATABLE READ READ ONLY`. A reconciliação abre uma transação separada, relê o alvo com bloqueio e só executa operações da allowlist. O pipeline facial validado não importa nem chama este serviço.

## Fronteiras

- Entrada: scheduler, cron autenticado ou administrador autenticado.
- Dependências somente leitura: produtos, eventos, fotógrafos, `photo_faces`, AWS `ListFaces` e inventário do storage.
- Escritas próprias: tabelas `integrity_*`.
- Escritas reconciliadoras limitadas: `photo_faces.photographer_id` vazio e inserção idempotente de `photo_faces` a partir de FaceIds existentes.
- Proibido: `IndexFaces`, `DeleteFaces`, mudanças em produto, evento, upload, threshold ou pipeline.
