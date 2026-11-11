# Auditoria e admissão do dashboard

Incremento autorizado em 27/10/2026, em Review. Implementa uma fila transacional limitada para observações de leitura e sequencia as fontes do dashboard por pedido. Preserva o append na mesma transação, os eventos críticos imediatos, todas as verificações finais e os limites de duração/capacidade. As provas focadas passaram; a matriz local terminou com 42/42 sucessos. O gate integral anterior de 108 pedidos não foi repetido neste incremento, e não existe aprovação produtiva.

## Causas e alterações

O append observacional adquiria `audit.chain_head` durante a autorização e mantinha o lock durante o restante processamento e as revalidações. O dashboard iniciava duas leases tenant em paralelo, podendo disputar oito slots com quatro pedidos para uma capacidade de cinco. O `Promise.all` também permitia responder ao erro de uma fonte enquanto outra continuava a trabalhar.

| Ficheiro | Alteração |
|---|---|
| [readAuditBuffer.js](../../../backend/src/audit/readAuditBuffer.js#L8) | Fila privada de candidatos validados, máximo 128 eventos/256 KiB, cópia do material, ordem sequencial, erro persistente e descarte |
| [tenantLeaseExecutor.js](../../../backend/src/security/tenantLeaseExecutor.js#L19) | Políticas fechadas por operação e cliente preparado; flush obrigatório antes do reset de role e das verificações finais; sem sucesso perante falha |
| [audit.js](../../../backend/src/authorization/audit.js#L84) | `TRANSACTION_PENDING` interno só para observações; não significa aceitação durável e nunca satisfaz auditoria crítica |
| [editorialUiAudit.js](../../../backend/src/organizationalProfile/editorialUiAudit.js#L21) | Opt-in explícito; candidatos criados no instante da decisão; prefixo persistido antes de um evento imediato |
| [applications/composition.js](../../../backend/src/applications/composition.js#L24) | Só browse/report/dashboardContext ativam a fila; reportExport e escritas ficam fora |
| [httpComposition.js](../../../backend/src/opportunities/httpComposition.js#L47) | Só o resumo privado do dashboard ativa a fila; falhas continuam a invalidar a operação |
| [organizationDashboardRoutes.js](../../../backend/src/routes/organizationDashboardRoutes.js#L29) | Report → resumo privado → resumo central → contexto final, sem fila entre pedidos |

A fila pertence ao cliente/transação preparados, e não ao pedido global, ligação reutilizável ou processo. Candidatos conservam identificador, observedAt, digest e ordem; os eventos de leitura são vinculados ao tenant físico validado. Os produtores imediatos fora desse opt-in conservam o comportamento anterior. Erros anteriores ao enqueue propagam-se pelo `auditTail`/`drain` das candidaturas ou por `auditFailed` das oportunidades. Erros no buffer são fatais mesmo se o F5 absorver uma rejeição observacional.

A ordem final permanece: resultado validado → primeira revalidação → flush → RESET ROLE → verificação física → segunda revalidação de autoridade/diretório → lease/fence/guard → commit → conclusão do guard → retorno. Não se eliminou qualquer verificação, nem se moveu o append para depois do commit/resposta. Assim, a redução do lock é parcial: as verificações finais continuam a ocorrer enquanto ele está retido. Eventos críticos/recusas fazem append imediato e, quando necessário, descarregam primeiro o prefixo observacional.

## Testes e revisão

- [Focados](focused.log): **91 PASS**, incluindo 25 testes novos distribuídos por [preparedReadAudit](../../../backend/test/preparedReadAudit.test.js), [readAuditOutcomes](../../../backend/test/readAuditOutcomes.test.js) e [httpDashboardScheduling](../../../backend/test/httpDashboardScheduling.test.js).
- [Suite backend final](backend-suite-final.log): **1284 PASS, três falhas históricas e sete SKIP**, de 1294 testes. Permanecem os casos ClamAV, fixture F12/F11 e catálogo SQL já registados na [baseline](../authority-metadata-dedup/README.md); não foram alterados.
- [PostgreSQL 17.11](postgres-proof.json): **10 verificações PASS** com roles reais, resolver/pool/executor F4, funções F7 e guards centrais duráveis. Confirmam persistência após sucesso, cadeia íntegra, rollback integral quando falha o segundo append, caminho crítico imediato, e recusa após alterações observadas de membership/fence/lease ou expiração do guard durante espera real em `audit.chain_head`.
- Perda simulada da confirmação de commit: a base contém dois eventos, mas a aplicação devolve `COMMIT_UNCERTAIN` e mantém `TENANT_COMMIT_UNKNOWN`. Não se interpreta `READ_TERMINAL` como prova de persistência da auditoria.
- [HTTP/OIDC de revogação](results-revocation.json): **nove verificações PASS**, com roles/RLS reais. A revogação central durante bloqueio na admissão tenant fez commit antes da libertação; a leitura respondeu 503 e as leituras seguintes foram recusadas. Esta corrida não prova todas as fronteiras de revogação.
- Revisão independente do âmbito, finalização e contratos HTTP sem problemas bloqueantes. Cliente frontend confirmado em `frontend/src/api/api.js:185`, sem alteração de formato/endpoint. Frontend/build não foram repetidos neste incremento exclusivamente backend.

Os testes unitários usam um client simulado para observar a ordem dos efeitos; não são prova de durabilidade PostgreSQL. A prova PostgreSQL usa um módulo de leitura com evidência sintética de autorização e probes negativos controlados nas dependências. A espera pelo lock e o ledger são reais; a perda de membership/fence/clock é injetada nessa fixture, complementar à revogação real HTTP/F5. O [runner](../../../test/integration/audit-dashboard/README.md) cria e remove exclusivamente o seu contentor. A primeira execução passou; a repetição reforçou os códigos de erro esperados. O JSON completo inicial foi substituído antes de o arquivar; apenas o [resumo observado](postgres-proof-initial-summary.json) foi preservado, identificado como tal.

## Medições

Comparação das matrizes [standard](../audit-dashboard-standard/results.json)/[capacity](../audit-dashboard-capacity/results.json) com [authority-metadata-contention](../authority-metadata-contention/results.json) e [authority-metadata-capacity](../authority-metadata-capacity/results.json): mesmo harness sem alterações, 1000 candidaturas/250 pessoas por tenant e limites idênticos. [Comparação estruturada](comparison.json).

| Cenário | Sucessos antes → depois | p50 antes → depois (ms) | p95 antes → depois (ms) |
|---|---:|---:|---:|
| Report C1 | 4/4 → 4/4 | 4286,83 → 4005,91 | 4416,84 → 4295,36 |
| Report C2 | 4/4 → 4/4 | 5852,07 → 3370,72 | 6708,81 → 3752,47 |
| Report C4 | 8/8 → 8/8 | 7838,80 → 3655,03 | 11089,68 → 5075,35 |
| Dashboard C1 | 4/4 → 4/4 | 6344,50 → 8548,92 | 7401,16 → 9733,63 |
| Dashboard C4 | 8/8 → 8/8 | 15621,89 → 8230,86 | 18375,89 → 9835,05 |
| Dashboard dois tenants C4 | 8/8 → 8/8 | 12090,65 → 8187,02 | 15227,60 → 9415,73 |
| Dashboard C6 | 4/6 → 6/6 | 16055,42 → 10718,42 | 17576,00 → 12403,14 |

A retenção média somada de `audit-held` por HTTP passou de **1935,28 para 407,84 ms** no report C4 e de **4485,31 para 1251,35 ms** no dashboard C4. Este último tem três retenções por HTTP; o maior hold individual passou de cerca de 2968 para 490 ms. O tempo médio somado de `audit-prepare` passou de cerca de 4365 para 296 ms, e o de consultas do lock central de 2260 para 545 ms. Não se confundem os tempos de espera para adquirir um lock com os tempos em que ele já está retido.

No dashboard C4, o máximo de leases ativas observadas passou de cinco para quatro, a fila de três para zero e a maior espera de admissão de **4284,81 para 25,80 ms**. No burst C6, a fila máxima passou de sete para um, sem aumentar os cinco slots disponíveis; desapareceram os quatro timeouts de admissão que antes afetavam duas respostas 503. A maior admissão foi **2886,70 ms**, abaixo do limite preservado de cinco segundos. O checkout físico tenant máximo foi 23,85 ms neste burst, sem espera registada à entrada no pool físico. Não houve erros de admissão nem consultas concluídas após a resposta nos ensaios atuais.

As contagens das respostas bem-sucedidas mantiveram-se: report com **1117 consultas e 21 transações de autoridade**; dashboard com **2619 e 42**, respetivamente. Os eventos de auditoria mantiveram cinco prepares/appends por report e dez por dashboard. A melhoria não resulta de omitir verificações ou eventos.

Há uma regressão material com apenas um dashboard: p95 **7,40 → 9,73 s**. A atividade máxima por pedido passa de duas leases para uma e o tempo SQL somado fica próximo (8088 → 8192 ms), compatível com a perda de sobreposição entre fontes. A alteração favorece disponibilidade e concorrência nesta matriz, mas não melhora uniformemente a latência. Persistem contenção central e fila no C6: 55/122 frames com espera central e 34/122 com fila; frames não equivalem à fração integral do tempo bloqueado. O gate local standard/capacity passa; o gate integral anterior continua por repetir.

São medições instrumentadas locais, com dados sintéticos e amostras pequenas. Quantis incluem só respostas 200. A comparação mistura duas alterações coordenadas, não isola o efeito de cada uma. O segundo tenant começa frio no cenário misto, e a fixture usa um leitor central não coordenado com `pg_read_all_data`; não há prova de paridade integral de privilégios centrais, SLO ou capacidade produtiva.

## Preservação

Baseline: HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, branch `feat/f13-organizational-profile`, 2179 entradas de estado e 2629 ficheiros inventariados com hash. O worktree já estava alterado. [Baseline](baseline.json). Migrations, grants/permissões, limites do pool, dados Dev e deploy permanecem fora deste incremento. Toda a fixture é sintética e descartável; não houve commit, merge, push ou deploy.

Verificação final: [preservação](preservation.json), [hashes das fontes](source-hashes.json) e [validações](verification.json). Os oito ficheiros existentes alterados pertencem ao âmbito declarado; os restantes ficheiros inventariados e todos os ficheiros frontend preservam os hashes. Não houve alterações a migrations, grants/permissões, dados Dev ou deploy. Os contentores exclusivos das provas foram removidos.

Próximo passo: repetir o gate HTTP/OIDC integral e a matriz por volumes, incluindo a regressão de latência do dashboard C1, antes de fechar a feature global.
