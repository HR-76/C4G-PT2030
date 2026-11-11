# Diagnóstico PERF-001 — 09/11/2026

Diagnóstico autorizado concluído; a segunda execução terminou com código 0, cleanup automático e zero contentores com label `c4g.browse-fingerprint` na verificação final. PostgreSQL 18.6, imagem identificada em `image.txt`. Hashes do SQL do ensaio e `browseSql.js` inalterados após execução.

## Resultado

Medianas de quatro amostras por variante e volume, ordem A/B/B/A repetida duas vezes. Planos em `plans.txt`, dados extraídos em `measurements.json`, hashes em `sources.json`.

| Registos sintéticos | Com fingerprint | Controlo sem fingerprint | Diferença de medianas |
| --- | ---: | ---: | ---: |
| 1 000 | 3,65 ms | 0,94 ms | 2,71 ms |
| 10 000 | 41,33 ms | 9,36 ms | 31,97 ms |
| 50 000 | 202,36 ms | 48,98 ms | 153,38 ms |

O custo cresce com o volume. Na primeira execução, os planos mostram escrita temporária de 1468/7360 blocos com fingerprint contra 714/3578 no controlo para 10 mil/50 mil registos. A segunda execução reproduz a ordem de grandeza dos tempos.

O controlo devolve NULL em vez do digest e não é uma implementação aceitável. A fixture usa uma projeção simplificada com notas de 512 caracteres, não usa RLS, joins, histórico, autoridade nem o percurso HTTP. Não comparar estes números diretamente com latência da aplicação ou inferir capacidade de produção. A pequena amostra não suporta um p95 robusto.

## Decisão

Preservar o SQL produtivo. O ensaio confirma o custo incremental, mas não demonstra que seja o gargalo das aberturas de vários segundos. Alterar/remover o digest sem medir a consulta completa arriscaria a invalidação de cursores. PERF-001 permanece em diagnóstico, associado à investigação PERF-02; não foi corrigido nem demonstrado ganho na aplicação.

Próximo trabalho: recolher EXPLAIN ANALYZE/BUFFERS da consulta real na fixture isolada representativa, incluindo primeira página/página profunda, filtros e visibilidade, e correlacionar com o tempo HTTP. Só selecionar uma otimização após essa prova; exigir equivalência de dados/digests, alterações fora da página, mudança de permissões, revogação e concorrência, além das suites/build. Não há autorização implícita para bases habituais.

## Ocorrências e integridade

O primeiro acesso Docker foi recusado pela sandbox; a execução autorizada prosseguiu com acesso elevado. A primeira medição terminou mas o cleanup falhou por aspas no template Docker em Windows PowerShell. O contentor foi identificado pelo nome/UUID e label, removido com o volume próprio, e a ausência foi confirmada. A correção usa JSON das labels, sem aspas internas. A segunda execução validou o cleanup automático. A evidência original permanece em `../browse-fingerprint-20261109/`.

Não houve alteração ao runtime, migrações, bases habituais ou fornecedores externos. Não foram repetidas suites/build: nesta fase só se corrigiu o harness e executou o diagnóstico. Os 13 testes focados aprovados anteriormente continuam registados separadamente, não como validação PostgreSQL deste ensaio.
