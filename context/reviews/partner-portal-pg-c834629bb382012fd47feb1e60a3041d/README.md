# Gate PostgreSQL — quinta execução

**28/10/2026 — FAIL na capacidade; custo localizado no percurso fresco de autorização, com limitação de quiescência por amostra.** [Evidência original](evidence.json), [manifest](sources.json), [agregação temporal](analysis.json), [verificação](verification.json).

## Execução autorizada e resultado

Retoma após o utilizador disponibilizar o Docker Desktop. A [falha anterior de pré-condição](../partner-portal-precondition-20261028-01/README.md) continua intacta e não é contada como execução PostgreSQL. Preservadas também as quatro execuções anteriores. Uma única nova execução real, sem repetição para procurar PASS.

- 1014 fontes verificadas, imagem local imutável sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3, daemon local fixado e contentor próprio, sem mounts do utilizador. SQL, migrations/grants e dados sintéticos exclusivamente nele.
- Início 2026-10-28T19:59:29.690Z; fim 2026-10-28T20:08:21.096Z; duração 531,406 s. Exit 1. PostgreSQL 17/READ COMMITTED e setup READY.
- Repositório 14/14 e autoridade 9/9 PASS. Matriz interna conserva 14 cenários de leitura PASS e duas EXPECTED_STORAGE_REJECTION; completeReadCoverage false. Não declarar 16/16 leituras nem prova OIDC/browser.
- 13 cenários completos, 52 medições e 26 aquecimentos preservados. 40 medições e 20 aquecimentos concluíram; 12 medições e seis aquecimentos falharam com LEASE_TIMEOUT em volume-10000, volume-10001 e profile-distinct-origins, nas duas variantes.
- 18 operações instrumentadas: três diagnósticos VALID e 15 INCOMPLETE (dez medições e cinco aquecimentos). O veredito global permanece FAIL; incomplete vazio no nível exterior não elimina os TEMPORAL_DIAGNOSTIC_INCOMPLETE presentes em observationErrors.
- Reavaliação offline reproduziu FAIL/exit 1. Nenhum contrato ou limite foi alterado para obter outro resultado. integrationAuthorized e productionCapacityApproved continuam false.

## Localização do custo

**P2 — custo dominante nas autorizações sem cache.** Nas 12 medições falhadas, a duração de autorizações já concluídas sem cache corresponde a **88,74–97,46%** do intervalo observado do reader até settlement. Incluindo a autorização ainda pendente, o port de autorização ocupa **90,47–97,64%** desse intervalo. Os hits de cache têm custo agregado pequeno; não são o caminho dominante observado.

Médias de duas amostras por variante, em ms. Reader e autorização incluem totalMs + pendingMs no snapshot atSettlement. Misses, hits e SQL mostram apenas durações concluídas nesse snapshot. Os tempos são inclusivos e sobrepostos; não somar colunas. São operações interrompidas, não ganhos de operações concluídas.

| Cenário | Reader baseline → candidato | Autorização | Misses concluídos | Hits | SQL Central global | SQL tenant |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| volume-10000 | 9354 → 9340 | 8610 → 8795 | 8423 → 8597 | 26 → 31 | 8371 → 8293 | 1212 → 906 |
| volume-10001 | 8518 → 9045 | 7860 → 8358 | 7745 → 8150 | 18 → 26 | 8522 → 8585 | 1707 → 1147 |
| profile-distinct-origins | 9467 → 9474 | 9230 → 9090 | 9172 → 8982 | 0 → 0 | 8903 → 8324 | 822 → 630 |

Membership e carregamento de dados da autorização representam os maiores subtotais desse percurso: médias concluídas de aproximadamente 3,72–4,58 s por dependência/grupo. Auditoria observada: médias 149–189 ms; política de recurso: valores muito menores. SQL Central global representa milhares de consultas por operação interrompida (médias de 1504 a 3138), incluindo resolve/protect e outros passos, pelo que não deve ser atribuído integralmente ao reader ou à autorização.

Evidência de código: backend/src/applications/composition.js:179–180 reutiliza decisões existentes e revalida o guard nos hits; para decisões novas chama o autorizador. backend/src/authorization/authorityDataRepository.js:8–12 e :24–29 consultam membership/estado F5 através do pool coordenado. backend/src/security/authorityCoordinator.js:24–67 e :71–84 mostram que, fora de withAuthority, cada consulta abre uma transação com admission/security e protocolo próprios. Isto identifica um mecanismo concreto de repetição a investigar, consistente com o custo observado. A contribuição exclusiva de cada comando, aquisição, fixture, host ou instrumentação ainda não foi isolada.

Impacto: os volumes 10000 e 10001 só leram 1600–3700 linhas nas medições; o cenário 10001 não alcançou LIMIT_EXCEEDED. Origens distintas interrompeu no primeiro lote de 100. O tempo de entrada completa OPERATION inclui preparação anterior à lease; não aplicar a esse agregado o limite da métrica BEGIN principal→settlement.

Correção de desempenho recomendada: ainda por desenhar/testar. Após resolver a quiescência do gate, avaliar validações Central adjacentes frescas por decisão, preservando todas as chamadas, locks, auditoria e revogação. Não ampliar cache entre recursos/pedidos, eliminar validações ou aumentar timeouts com base nesta prova. Regressões necessárias: resultado e ordem de autoridade equivalentes, writer/guard nas duas ordens, revogação, timeout e cleanup.

## Limitação identificada no harness

**P2 — carga pode avançar sem quiescência Central comprovada.** test/integration/partner-portal/capacityProbe.js:160–164 regista spans pendentes como diagnóstico incompleto; :185–190 só interrompe quando cleanupMs é null. Assim, cleanup tenant com duração finita permite amostras seguintes (:208) e arquivo de fixture (:218), apesar do trabalho Central pendente.

Nas 18 operações instrumentadas havia uma query client Central pendente no settlement. Em 15, reader/autorização e query Central continuavam pendentes no snapshot afterCleanup. Nas 12 medições concluíram mais 2–18 queries Central entre os dois snapshots. Isto prova ausência de quiescência demonstrada da operação completa; não prova que cada query ainda executava no servidor nem sobreposição efetiva com uma escrita específica de fixture, cujos timestamps não foram recolhidos.

Causa raiz da omissão: observeCleanup verifica pool/activity tenant, enquanto requireCleanup ignora o estado temporal incompleto. O FAIL global foi corretamente conservado, mas não substitui a interrupção local de carga. Existe risco de contaminação entre amostras; a remoção final do contentor não corrige retroativamente esta limitação.

Correção recomendada antes de nova medição: impedir novas amostras e adiar arquivo da fixture quando a operação mantém spans pendentes após cleanup, preservando a recusa original e delegando o fecho ao environment. Teste necessário primeiro: tenant quiet + cleanupMs finito + query Central pendente → timeout original conservado, nenhuma nova operação/arquivo da fixture e cleanup exterior executado. Não modificar o runtime neste incremento.

## Medições funcionais antes/depois

Médias BEGIN principal→settlement e queries tenant, duas amostras por variante. Valores de timeout são falhas. A comparação completa com a quarta execução está em analysis.json; não é um ensaio controlado de overhead ou causalidade, pois o host e a instrumentação diferem. A causa da variação entre execuções não está atribuída.

| Cenário | Tempo baseline → candidato (ms) | Queries médias | Resultado |
| --- | ---: | ---: | --- |
| volume-0 | 2107.83 → 1877.13 | 333 → 335 | Concluído |
| volume-25 | 3363.83 → 3028.27 | 337 → 339 | Concluído |
| volume-26 | 2969.17 → 2230.39 | 337 → 339 | Concluído |
| volume-100 | 2318.55 → 2960.06 | 338 → 340 | Concluído |
| volume-101 | 2572.57 → 3045.29 | 340 → 342 | Concluído |
| volume-10000 | 9821.45 → 9863.38 | 321.5 → 326.5 | LEASE_TIMEOUT nas duas variantes |
| volume-10001 | 9742.88 → 9796.21 | 279 → 296.5 | LEASE_TIMEOUT nas duas variantes |
| profile-denied | 2634.19 → 2906.94 | 340 → 342 | Concluído |
| profile-shared-origin | 2936.06 → 3098.83 | 340 → 342 | Concluído |
| profile-distinct-origins | 9871.11 → 9881.57 | 310 → 296 | LEASE_TIMEOUT nas duas variantes |
| profile-selective | 2191.90 → 2175.17 | 340 → 342 | Concluído |
| profile-historical-people | 2171.69 → 2003.39 | 340 → 342 | Concluído |
| profile-large-payload | 1485.71 → 1504.16 | 337 → 339 | Concluído |

Nas 78 operações: admissão máxima 42,7885 ms; cleanup tenant observado máximo 88,6633 ms; resposta máxima 775423 bytes; zero queries após sucesso. Pico RSS 323239936 bytes e heap 123451384 bytes do processo completo do gate. Temporários PostgreSQL observados: delta zero, sujeito a atraso estatístico. Estes valores não demonstram capacidade produtiva ou throughput HTTP concorrente. As duas rejeições de armazenamento e writers sintéticos de equipa mantêm os limites já documentados no runbook.

## Cleanup, alterações e preservação

Environment fechado e contentor removido, sem erros. Ausência confirmada por ID completo e label no mesmo daemon local. O runner solicitou --volumes; sem inventário independente dos volumes. Esta prova final é distinta da quiescência incompleta por amostra.

As 12 regressões temporais foram repetidas antes da tentativa e passaram. Nenhum código ou teste novo neste turno; suites/build não repetidos. Última validação do diagnóstico: foco 207 PASS; backend 1547 PASS/0 FAIL/7 SKIP preexistentes; frontend 346 PASS/build PASS. Revisão independente read-only concordou com o FAIL e os limites da análise.

Alterados apenas este novo diretório (evidence.json, sources.json, analysis.json, README.md e verification.json), context/current-work.md, context/features/partner-postgres-gate.md e o runbook. Branch feat/f13-organizational-profile, HEAD 0cf519ea22de929d2e52d0b3edb4d72364aa6220; baseline 2629 entradas no worktree e 31003 ficheiros. Os 20 ficheiros anteriores, incluindo a falha de pré-condição, mantêm os hashes.

**Runtime, protótipo, fontes de migrations/grants/permissões e dados Dev preservados.** SQL/permissões sintéticas exclusivamente no contentor autorizado e removido. Sem commit, merge, push, deploy, alteração de serviços existentes ou integração.

**Próximo passo:** adicionar regressão e corrigir a interrupção do gate quando há trabalho Central pendente após cleanup tenant, antes de repetir a medição ou otimizar a autorização.
