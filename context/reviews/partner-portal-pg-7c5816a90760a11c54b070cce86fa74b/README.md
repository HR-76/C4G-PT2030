# Gate PostgreSQL — sexta execução

28/10/2026 — **interrupção validada em PostgreSQL; gate global FAIL pelos timeouts e cobertura interrompida.** Uma única execução autorizada, sem repetição. [Evidência original](evidence.json), [fontes](sources.json), [verificação](verification.json).

## Resultado

- Início `2026-10-28T20:26:01.918Z`; fim `2026-10-28T20:29:10.686Z`; **188,768 s**, exit 1. PostgreSQL 17, READ COMMITTED, setup READY e 1014 fontes verificadas.
- Mesma imagem local imutável `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`. Contentor próprio, daemon local fixado, sem mounts do utilizador; SQL/migrations/grants e dados sintéticos exclusivamente nele.
- Repositório **14/14 PASS**, autoridade **9/9 PASS**. Mantêm-se as duas rejeições de armazenamento previstas na matriz, sem as apresentar como leituras aprovadas ou cobertura integral de leitura.
- Capacidade: **20 medições e 12 aquecimentos**. Volumes 0/25/26/100/101 completos; volume-10000 INCOMPLETE; sete cenários posteriores NOT_RUN. Os dois aquecimentos de volume-10000 falharam com LEASE_TIMEOUT; não arrancaram medições desse volume.

## Interrupção comprovada

| Aquecimento volume-10000 | Operação (ms) | Cleanup tenant (ms) | Spans após cleanup | Decisão |
| --- | ---: | ---: | --- | --- |
| Baseline | 9872,12 | 49,14 | Nenhum | Continuar; timeout conservado |
| Candidato | 9825,01 | 23,27 | READER, AUTHORIZATION, AUTHORIZATION_DATA, SQL_CENTRAL | Parar |

A pendência do baseline no settlement terminou durante o cleanup; não justificava interrupção. O candidato foi a primeira operação com pendência após cleanup e a última operação registada. O guard em `test/integration/partner-portal/capacityProbe.js:185` registou `CAPACITY_CLEANUP_UNCONFIRMED` e `CAPACITY_FIXTURE_ARCHIVE_DEFERRED`, conservou a amostra/LEASE_TIMEOUT e adiou o arquivo da fixture para o fecho exterior. Nenhuma variante, par ou cenário posterior foi iniciado.

Reavaliação offline reproduziu **FAIL/exit 1**, com `CAPACITY_OBSERVER_ERRORS`, `MISSING_WARMUPS` e `CAPACITY_INCOMPLETE`. A falta de cobertura é consequência intencional da interrupção; não foi contornada. Revisão independente sem bloqueios. Capacidade produtiva e integração continuam não aprovadas.

## Custo e duração

Nas duas operações interrompidas, autorizações sem cache já concluídas ocuparam 8283,39/8801,16 ms; hits 26,61/23,16 ms. São durações inclusivas, sem atribuição exclusiva de causalidade. O custo da autorização continua por corrigir; esta execução valida a interrupção do harness.

Comparação operacional com a quinta tentativa: **78→32 operações**, **531,406→188,768 s**. Foram omitidas 46 operações previstas por causa da interrupção. Isto não demonstra melhoria de desempenho da aplicação: a matriz executada é diferente e o ambiente não é um ensaio controlado.

## Cleanup e preservação

Environment fechado e contentor removido, sem erros. Ausência confirmada independentemente por ID completo e label no mesmo daemon. Remoção com `--volumes` solicitada pelo runner; sem inventário independente dos volumes.

Nenhum código ou teste alterado neste turno; suites/build não repetidos. Validação imediatamente anterior da correção: seis regressões novas, foco 68 PASS, backend 1553 PASS/0 FAIL/7 SKIP preexistentes, frontend 346 PASS/build PASS e sintaxe PASS.

Alterados apenas este novo diretório (`evidence.json`, `sources.json`, `README.md`, `verification.json`), `context/current-work.md`, `context/features/partner-postgres-gate.md` e o runbook. Baseline: branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, 2637 entradas no worktree e 31011 ficheiros. Cinco execuções anteriores, pré-condição e relatório da correção preservados por hash.

**Runtime/protótipo, fontes de migrations/grants/permissões e dados Dev preservados.** Nenhum serviço existente foi alterado; SQL confinado ao contentor autorizado e removido. Sem commit, merge, push, deploy ou integração.

**Próximo passo:** corrigir o custo repetido das transações Central por decisão de autorização, começando por regressões de equivalência, revogação e auditoria, antes de repetir o gate.
