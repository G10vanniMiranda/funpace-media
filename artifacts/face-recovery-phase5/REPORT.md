# Fase 5 — Hardening, publicação final e encerramento

Data: 2026-07-17 — America/Manaus

## Conclusão executiva

O hardening de código e banco foi implementado e validado. Os guards preventivos estão ativos no banco e persistiram zero mudanças nos canários. O backend final ainda não foi publicado na VPS porque este ambiente não possui host/chave SSH. A API pública continua executando o health antigo e não informa commit.

O encerramento oficial **não está aprovado**. A auditoria final confirmou 11.752 achados históricos, contrariando o pressuposto de integridade total. As restrições desta fase impedem corrigi-los.

## Versões

- Commit de partida em `main`/`origin/main`: `5dad4c7`.
- Commit final do hardening: consultar o SHA do commit da Fase 5 e confirmar via `/api/health` após deploy.
- Commit em execução na VPS: não determinável; endpoint antigo não publica SHA.

## Auditoria final de produção

- Run ID: `b3c9f1f2-5f93-4cd0-afcb-8c3c969f4feb`.
- Modo: `audit`.
- Duração: 51.881 ms.
- Produtos/fotos/faces DB/faces AWS/storage: 8.200 / 8.158 / 17.263 / 19.907 / 16.430.
- Indexed/pending/processing/failed: 7.403 / 1 / 0 / 4.
- Processing preso: 0.
- Duplicações DB/AWS: 0 / 0.
- Achados: 11.752; críticos: 1.747.
- `indexed_without_faces`: 1.744.
- `aws_orphan_faces`: 2.644.
- `invalid_product_events`: 2.095.
- `face_photographer_invalid`: 4.654.
- Correções automáticas: 0.
- IndexFaces/DeleteFaces/backfill/reconciliação: 0.
- Saúde calculada: 26,28%.

## Hardening concluído

- Backfill e scripts de execução legada bloqueados.
- Reconciliação travada por código em produção.
- Health público sem indicadores de env/banco e com identidade de build.
- Redação de credenciais, bearer, JWT, chave AWS e URL PostgreSQL nos logs estruturados.
- Triggers preventivos aplicados.
- Quatro canários de rejeição aprovados, `persistentChanges: 0`.
- Regras adicionais de alerta aplicadas.
- Auditor de segredos: 735 arquivos, zero achados.
- Oito logs temporários removidos.
- 116/116 testes aprovados antes da consolidação documental.

## Pendências bloqueadoras

1. Publicar o commit final na VPS e comprovar SHA pelo novo health.
2. Rotacionar segredos nos provedores e VPS; não há acesso a esses painéis neste ambiente.
3. Validar selfies reais de evento antigo e recente; nenhuma selfie/ID de teste foi fornecida nesta fase.
4. Classificar o passivo histórico sem violar a proibição de alteração desta fase.

## Declaração técnica

O sistema está mais protegido contra novas inconsistências e pronto para deploy controlado. Não pode ser declarado oficialmente encerrado ou totalmente recuperado enquanto as pendências acima permanecerem.
