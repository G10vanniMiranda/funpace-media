# Arquitetura final do reconhecimento facial

## Fluxo funcional

```text
Upload autenticado
  -> products.pending
  -> claim atômico
  -> products.processing
  -> download interno do storage
  -> AWS Rekognition IndexFaces
  -> transação complete_photo_face_index
       -> photo_faces
       -> products.indexed ou no_face
  -> busca por selfie limitada ao evento
```

O pipeline funcional permanece em `server/face`. A Fase 5 não mudou threshold, upload, indexação, venda ou download.

## Camada preventiva

- FK e unicidade existentes continuam sendo a primeira barreira.
- `products_face_integrity_guard` impede novas fotos com evento/fotógrafo inválido e `indexed` sem faces.
- `photo_faces_integrity_guard` impede vínculos divergentes e `external_image_id` incorreto.
- `photo_faces_delete_integrity_guard` impede retirar a face de uma foto que continua `indexed`.
- Os canários usam transações revertidas e persistem zero alterações.

## Camada de detecção

O serviço `server/integrity/integrity-service.ts` usa snapshot consistente do banco, `ListFaces` e inventário do storage. Ele grava somente `integrity_*`, métricas, alertas e fila humana. Em produção, a reconciliação é bloqueada por código.

## Operações proibidas após encerramento

- backfill ou reindexação histórica;
- reconciliação automática;
- `DeleteFaces` operacional;
- alteração automática de eventId/photographerId legado;
- execução dos scripts legados bloqueados.

Uma futura exceção exige nova mudança de código, revisão, manifesto e aprovação explícita.
