# Correções e diagnóstico — 06/11/2026

## Correções implementadas

AUTH-01: descoberta OIDC volta a ser possível depois de uma falha transitória. Uma tentativa partilhada por cliente, espera progressiva de 1 a 30 segundos, sem repetição automática de troca de códigos. SEC-01: `/api/auth` recebe no-store antes dos parsers, sessões e guards. UX-01: falhas temporárias da validação inicial apresentam recuperação explícita, ocultam o conteúdo dependente da sessão e cancelam pedidos abandonados; 401 conserva o percurso de sessão ausente.

Regressões reproduzidas antes das correções. Backend completo 2702 PASS/7 SKIP/0 FAIL; teste adicional do teto de backoff PASS separadamente. Frontend 811 PASS; build e sintaxe PASS. Não houve deploy, commit ou alterações às bases habituais.

## Diagnóstico autorizado

Comando: `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-contention/profile.ps1 -Report audit-remediation-contention-20261106`.

PostgreSQL17/Keycloak descartáveis, OIDC/PKCE real e dados sintéticos: 1000 candidaturas e 250 pessoas por tenant. Dois tenants. Processo exit 0; relatório COMPLETE sem cleanupError; nenhum contentor com label c4g.http-proof permaneceu após o cleanup. Fixtures verificaram isolamento/RLS, restrição do protocolo central e login/seleção de organização. Este diagnóstico não substitui testes de revogação concorrente de uma futura alteração.

| Cenário | Pedidos | Erros | p50 ms | p95 ms |
|---|---:|---:|---:|---:|
| Relatório C1 | 4 | 0 | 2305,94 | 2334,02 |
| Relatório C2 | 4 | 0 | 2367,26 | 2763,52 |
| Relatório C4 | 8 | 0 | 2850,18 | 3905,21 |
| Dashboard C1 | 4 | 0 | 5045,01 | 5145,06 |
| Dashboard C4 | 8 | 0 | 6238,30 | 7458,74 |
| Dashboard C4, dois tenants | 8 | 0 | 6225,69 | 6681,18 |

36 pedidos medidos, mais aquecimentos separados. Nenhum cenário apresentou fila de admissão (maxQueued=0). O custo acumulado médio das consultas classificadas como metadata foi 1591,49 ms no relatório C1 e 4411,74 ms no dashboard C4. Estes tempos não são uma decomposição exclusiva do tempo HTTP e não devem ser somados indiscriminadamente. Há esperas de locks observadas, mas este ensaio não sustenta atribuir a maior parte da latência ao bloqueio global ou ao pool.

Evidência: [resultados](results.json), [resumo](summary.json). Quantis de amostras pequenas e host instrumentado; não representam SLO de produção nem abertura visual das páginas. Não existe comparação antes/depois de otimização de desempenho nesta execução.

## Trabalho ainda aberto

- PERF-01: otimizar as consultas de metadados dominantes mantendo recolha fresca antes/depois dos locks, byte-equivalência dos snapshots, fingerprints e deteção de deriva. Ensaiar equivalência e revogação antes de ativar qualquer alteração ao protocolo.
- PERF-02: medir catálogo com filtros seletivos e planos SQL; este gate mede relatório/dashboard, não o catálogo isoladamente.
- PERF-03: redesenhar paginação do matching com contrato de completude/ordem; os contratos anteriores mantêm explicitamente o limite de 1000 por fonte. Não aumentar esse limite sem tratar o custo.

O incremento de autenticação/cache está validado. A remediação de desempenho permanece In Progress; não se declara a auditoria integralmente corrigida.
