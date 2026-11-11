# Gate PostgreSQL — quarta tentativa

**28/10/2026 — FAIL na capacidade; setup, repositório, autoridade e cleanup concluídos.** [Evidência original](evidence.json), [manifest](sources.json), [verificação e preservação](verification.json). As três falhas anteriores permanecem intactas.

## Execução e resultado

Execução explicitamente autorizada do runbook após a [correção da configuração inicial UTC](../partner-session-configuration/README.md). Mesma imagem local imutável sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3; novo contentor próprio, daemon local fixado, porta dinâmica apenas em loopback e sem bind mounts. Migrations/grants e dados sintéticos exclusivamente nesse contentor. Sem pull, uso de Dev, alteração de serviços existentes ou integração.

- Branch feat/f13-organizational-profile; HEAD 0cf519ea22de929d2e52d0b3edb4d72364aa6220. Baseline: 2616 entradas no worktree, 30990 ficheiros.
- 1013 fontes conferidas. PostgreSQL 17 e READ COMMITTED confirmados.
- Início 2026-10-28T00:43:49.740Z, fim 2026-10-28T00:50:20.417Z; duração 390,677 s. Lisboa em UTC nesta data. Exit code 1.
- Setup READY: os tenants foram preparados com o validador estrito original. O sucesso atual não identifica retroativamente qual campo divergiu na terceira tentativa.
- Repositório: 14/14 probes PASS, com LOGIN limitado/FORCE RLS, conexões cruzadas recusadas, equivalência/cursor/collation, três pontos de snapshot e cleanup de portais/sessões.
- Matriz interna: 14 cenários de leitura PASS e duas EXPECTED_STORAGE_REJECTION. authorization-trace: zero leituras, 23514/application_exact_origin; canonical-input: quatro leituras parciais, 22P02. completeReadCoverage permanece false; não declarar 16/16 leituras aprovadas.
- Autoridade: 9/9 PASS, incluindo membership/política nas duas ordens, sessão revogada, equipa/cache e falha F7. Sessões autenticadas sintéticas; writers concorrentes de equipa são SQL sintético direto, sem prova OIDC/browser ou do endpoint concorrente auditado.
- Capacidade: 13 cenários completos, 52 amostras medidas e 26 aquecimentos preservados. 40 medições e 20 aquecimentos concluíram; 12 medições e seis aquecimentos tiveram LEASE_TIMEOUT.
- Reavaliação offline com as mesmas fontes: FAIL, exit 1; sem evidência incompleta. integrationAuthorized e productionCapacityApproved continuam false.

## Falha observada e investigação necessária

**P2 — capacidade insuficiente no âmbito local testado.** Os cenários volume-10000, volume-10001 e profile-distinct-origins falham em baseline e candidato, nas duas ordens AB/BA e nos aquecimentos. Os 10000 candidatos não chegam a produzir a resposta; os 10001 não chegam à recusa esperada LIMIT_EXCEEDED. Não atribuir a falha exclusivamente ao protótipo nem concluir capacidade produtiva.

Evidência: [samples e warmups](evidence.json), recolhidos por test/integration/partner-portal/capacityProbe.js:118–139. Nas 12 medições falhadas, BEGIN→settlement foi 9864,02–9931,13 ms. O deadline integral começa antes desse intervalo; ficar abaixo de 10000 ms nesta métrica não contradiz LEASE_TIMEOUT. backend/src/security/tenantLeaseExecutor.js:321–329 conserva o prazo mais restritivo e emite a recusa.

Impacto: a operação não cumpre o resultado esperado nesses volumes/perfis dentro do prazo atual. A causa raiz do custo ainda não está identificada. As fontes mostram leitura em lotes e autorização sequencial por linha em backend/src/applications/partners.js:74–85 e backend/prototypes/partnerSqlPortal.js:86–96; isto orienta a investigação, mas não mede a contribuição de SQL, autoridade, guard, auditoria ou instrumentação.

O avaliador conservou 12 UNEXPECTED_OUTCOME, 12 CANDIDATE_COUNT_MISMATCH e seis AUTHORITY_MISMATCH. As contagens de linhas/autorizações diferem porque as operações foram interrompidas em pontos distintos; isso não prova acesso indevido. CAPACITY_OBSERVER_ERRORS agrega aqui seis UNEXPECTED_WARMUP_FAILURE; não significa que faltaram métricas.

Correção recomendada: ainda por decidir após localizar o custo; não aumentar timeouts, retirar autoridade, limitar silenciosamente resultados ou alterar cursor/digest para obter PASS. Teste necessário antes de qualquer correção: regressão do percurso identificado, preservando autoridade fresca, contrato de 10000/10001, cancelamento e cleanup, seguida de medição isolada comparável.

## Medições antes/depois

Médias de duas amostras por variante/cenário, alternadas AB/BA. Queries incluem o protocolo tenant, excluem SQL Central e observações admin. Linhas são as observadas até ao settlement. Tempos de operações interrompidas são apresentados como falhas, sem alegar ganho.

| Cenário | Tempo médio baseline → candidato (ms) | Queries médias | Linhas médias | Resultado |
| --- | ---: | ---: | ---: | --- |
| volume-0 | 1215.31 → 1217.67 | 333 → 335 | 0 → 0 | Concluído |
| volume-25 | 1810.63 → 1599.70 | 337 → 339 | 25 → 25 | Concluído |
| volume-26 | 1658.19 → 1650.83 | 337 → 339 | 26 → 26 | Concluído |
| volume-100 | 1669.00 → 1540.99 | 338 → 340 | 100 → 100 | Concluído |
| volume-101 | 1963.72 → 2068.52 | 340 → 342 | 101 → 101 | Concluído |
| volume-10000 | 9888.88 → 9930.57 | 395.5 → 406 | 5700 → 6000 | LEASE_TIMEOUT nas duas variantes |
| volume-10001 | 9904.82 → 9926.61 | 406 → 412 | 6050 → 6200 | LEASE_TIMEOUT nas duas variantes |
| profile-denied | 1338.65 → 1387.68 | 340 → 342 | 101 → 101 | Concluído |
| profile-shared-origin | 1513.05 → 1427.85 | 340 → 342 | 101 → 101 | Concluído |
| profile-distinct-origins | 9894.52 → 9903.12 | 335.5 → 339.5 | 100 → 100 | LEASE_TIMEOUT nas duas variantes |
| profile-selective | 1440.08 → 1327.52 | 340 → 342 | 101 → 101 | Concluído |
| profile-historical-people | 1586.10 → 1592.47 | 340 → 342 | 101 → 101 | Concluído |
| profile-large-payload | 1509.21 → 1397.19 | 337 → 339 | 26 → 26 | Concluído |

Nos dez cenários concluídos, pares conservam digest/bytes de resposta e contagem de chamadas de autorização; o candidato acrescenta duas queries. Não elimina o scan integral. Com duas amostras por variante, p95 nearest-rank coincide com o máximo; não é uma estimativa robusta de produção.

Nas 78 operações: admissão máxima 11,866 ms; cleanup observado máximo 52,727 ms; maior resposta 775423 bytes; zero queries após sucesso. Pico RSS 317734912 bytes e heap 113577064 bytes do processo do gate, incluindo fixtures/instrumentação. Deltas de temporários PostgreSQL observados: zero, sujeitos ao atraso das estatísticas e sem equivaler a EXPLAIN/BUFFERS. Não houve reserva do host ou prova de throughput HTTP concorrente.

## Cleanup, validação e preservação

cleanup.environmentClosed e containerRemoved são true, sem erros. Ausência confirmada posteriormente por ID completo e label no mesmo daemon local. O runner solicitou --volumes; não existe inventário independente dos volumes anónimos. setupDiagnostic.localCleanup permanece NOT_STARTED porque esse campo acompanha o cleanup em falha de setup; não invalida o fecho final comprovado.

Oito regressões de configuração da sessão repetidas antes da execução: 8 PASS, zero falhas/SKIP. Nenhum teste ou código foi adicionado neste turno. Suites/build não repetidos por ausência de alteração de código; validação anterior da correção: foco 195 PASS, backend 1533 PASS/0 FAIL/7 SKIP preexistentes, frontend 346 PASS/build PASS. Esses resultados não substituem este FAIL PostgreSQL.

Alterados apenas este diretório novo (evidence.json, sources.json, README.md, verification.json), context/features/partner-postgres-gate.md e context/current-work.md. Os 12 ficheiros das três tentativas anteriores têm os mesmos SHA-256. Nenhuma remoção ou alteração inesperada; branch/HEAD preservados.

**Runtime, protótipo, fontes de migrations/grants/permissões e dados Dev preservados.** SQL e permissões sintéticas aplicados apenas no contentor autorizado, agora removido. Sem commit, merge, push, deploy, integração ou repetição para procurar PASS.

**Próximo passo:** preparar regressões e diagnóstico temporal por fase, SQL Central/tenant e hits/misses de autorização nos três cenários falhados, preservando limites, autoridade, contratos e as quatro tentativas, antes de outra execução.
