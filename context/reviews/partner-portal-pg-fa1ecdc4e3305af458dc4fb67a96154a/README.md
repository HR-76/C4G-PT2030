# Gate PostgreSQL — sétima execução

28/10/2026 — **FAIL; redução observada do custo por autorização, ainda insuficiente para concluir volume-10000.** Uma execução isolada autorizada, sem repetição. [Evidência](evidence.json), [comparação com a sexta](comparison.json), [fontes](sources.json), [verificação](verification.json).

## Execução e interrupção

Início `2026-10-28T20:44:19.504Z`; fim `2026-10-28T20:47:40.572Z`; **201,068 s**, exit 1. PostgreSQL 17/READ COMMITTED, setup READY, 1014 fontes verificadas e imagem local imutável `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`. SQL, migrations/grants e dados sintéticos exclusivamente no novo contentor próprio, sem mounts do utilizador.

Repositório **14/14 PASS** e autoridade **9/9 PASS**. A matriz interna mantém duas rejeições de armazenamento previstas; não são leituras aprovadas nem prova de cobertura integral. Capacidade: **20 medições e 11 aquecimentos**, cinco cenários COMPLETE, volume-10000 INCOMPLETE e sete cenários seguintes NOT_RUN.

O primeiro aquecimento de volume-10000, variante baseline (`before`), terminou com **LEASE_TIMEOUT** após 9864,75 ms desde o BEGIN principal. Após cleanup tenant de 85,68 ms persistiam spans READER, AUTHORIZATION e SQL_CENTRAL. Foi a última operação: erro conservado, `CAPACITY_CLEANUP_UNCONFIRMED` e `CAPACITY_FIXTURE_ARCHIVE_DEFERRED` registados, sem iniciar o candidato nem medições desse volume ou cenários posteriores. Limites inalterados.

Reavaliação offline reproduziu FAIL/exit 1 com `CAPACITY_OBSERVER_ERRORS`, `MISSING_WARMUPS` e `CAPACITY_INCOMPLETE`. A interrupção explica a cobertura em falta; não foi contornada. Revisão independente sem bloqueios.

## Efeito observado da correção

Comparação **sexta→sétima execução**, mesmo aquecimento volume-10000/baseline. Os nomes `before`/`after` identificam os adaptadores baseline/portal; ambos usam a correção na sétima execução. Não confundir esta comparação temporal com a comparação entre adaptadores.

| Métrica no aquecimento interrompido | Sexta | Sétima |
| --- | ---: | ---: |
| Linhas lidas | 3700 | 5800 |
| Autorizações sem cache concluídas | 37 | 58 |
| Duração média inclusiva dessas autorizações | 223,88 ms | 141,99 ms |
| SQL Central concluído no settlement, operação inteira | 2839 | 2288 |
| Tempo BEGIN→settlement | 9872,12 ms | 9864,75 ms |
| Resultado | LEASE_TIMEOUT | LEASE_TIMEOUT |

Custo médio observado por autorização **−36,58%**; linhas lidas antes do timeout **+56,76%**. Continuam sem concluir os 10000 registos. É um único aquecimento interrompido em cada execução, sem controlo do host: não atribuir exclusivamente à alteração toda a variação nem declarar throughput produtivo. As contagens SQL Central incluem etapas exteriores à autorização. Não comparar diretamente membership/F5 como ganho isolado: o agrupamento deslocou parte do custo para fora desses subspans; o miss inclusivo é a comparação adequada.

Nas **20 medições pequenas comuns**, todas concluídas, o tempo médio subiu de **1805,88 para 1936,85 ms (+7,25%)**. Queries tenant, linhas e chamadas de autorização mantiveram as contagens. Não há melhoria global de latência demonstrada. Médias de duas amostras por variante, em ms:

| Cenário | Baseline sexta→sétima | Portal sexta→sétima |
| --- | ---: | ---: |
| volume-0 | 1425,08→1529,07 | 1376,03→1588,09 |
| volume-25 | 1628,72→2009,36 | 1975,53→2111,46 |
| volume-26 | 1908,54→1890,01 | 1896,39→1975,06 |
| volume-100 | 1754,48→1886,09 | 1902,86→1897,32 |
| volume-101 | 2090,35→2404,19 | 2100,86→2077,82 |

A duração total passou de 188,768 s/32 operações para 201,068 s/31 operações; inclui setup, probes e fixtures, com cobertura distinta. Não usar este total como ganho ou regressão atribuível do endpoint. O candidato de volume-10000 não foi executado nesta tentativa; capacidade e integração permanecem não aprovadas.

## Cleanup e preservação

Environment fechado e contentor removido, sem erros. Ausência confirmada independentemente por ID completo e label no mesmo daemon local. Runner solicitou remoção com `--volumes`; sem inventário independente dos volumes.

Apenas documentação e artefactos alterados: este diretório, `context/current-work.md`, `context/features/partner-postgres-gate.md`, `context/features/partner-authorization-read-group.md` e o runbook. Nenhum código/teste novo ou suite/build repetida nesta execução. Validação anterior da correção: 12 casos adicionais, foco 166 PASS, backend 1565 PASS/0 FAIL/7 SKIP preexistentes, frontend 346 PASS/build PASS e sintaxe PASS.

Baseline: branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, 2645 entradas no worktree e 31019 ficheiros. Seis execuções anteriores, pré-condição e relatórios das correções preservados por hash. Fontes correntes coincidem com o manifest aprovado; comparado à sexta execução, só diferem os três módulos autorizados da correção.

**Runtime e fontes de migrations/grants/permissões sem novas alterações; dados Dev preservados.** SQL confinado ao contentor descartável autorizado. Sem alteração de serviços existentes, integração do protótipo, commit, merge, push ou deploy.

## Próxima intervenção concreta

A leitura de `backend/src/security/authoritySecurityManifest.js:58` confirma preflight fresco por admissão; `centralMigrationPreflight.js:24` chama `assertCentralSchema`. Em `centralSchemaManifest.js:29`, o snapshot de catálogo faz pelo menos sete consultas separadas. É uma fonte concreta de roundtrips a reduzir, sem atribuir a esta rotina todo o custo restante.

**Próximo passo:** agregar as consultas de catálogo de centralSchemaSnapshot num comando, começando pelas regressões de equivalência de snapshot/fingerprint e drift antes/depois do lock; preservar admissão fresca e verificação pós-lock, sem cache, migrations ou redução de validações. Não repetir o mesmo gate antes dessa correção.
