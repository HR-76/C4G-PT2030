# Compatibilidade do leitor e renovação de sessão

Pedido de 26/10/2026. **Gate completo: FAIL**, por sete falhas sob carga. Compatibilidade do leitor, renovação/epochs, OIDC, CSRF, roles/RLS e recusas de autoridade passaram nas 32 verificações funcionais. O benchmark terminou com 101/108 sucessos: seis `LEASE_TIMEOUT` e um `POOL_EXHAUSTED`. Não ocorreram `AUTHORITY_STALE` ou `AUTHORITY_WRITE_PENDING` neste ensaio. Evidência anterior preservada em [http-oidc-isolated](../http-oidc-isolated/README.md).

## Causas e correções

1. O leitor admitia apenas 029/030, embora o esquema canónico já estivesse em 032. A lista agora inclui explicitamente 031/032, mantendo fingerprint exato, verificação completa do esquema e recusa de revisões futuras/desconhecidas.
2. Cada `touch` do connect-pg-simple alterava `expire`. Os triggers classificam essa alteração como crítica; o wrapper registava uma escrita de autoridade e avançava o epoch da sessão. Leituras concorrentes ficavam obsoletas durante o próprio processamento. O novo adaptador conserva a expiração física no limite absoluto e renova apenas o prazo idle no payload, sob a mesma transação e lock de autoridade. Recarrega o valor persistido, verifica identidade e sessão central ativa, e mantém auth/expiração física inalterados. Não foi alterado o protocolo SQL nem desativado qualquer trigger.
3. A autoridade passa a incluir o prazo idle observado no deadline das operações protegidas. Continuam as validações de sessão, revogação, membership, organização, versão de autorização e epochs, na admissão e na validação final. Logout/rotação continuam a usar o escritor e a avançar epochs. Sessões antigas são convertidas através do escritor; pedidos antigos não podem recriar um SID eliminado.
4. Depois de corrigido o leitor, o primeiro ensaio revelou `AUTHORITY_OPERATION_INVALID` na validação final do dashboard: havia verificações adicionais de diretório sem intenção admitida. A composição agora declara `APPLICATION_DASHBOARD_CONTEXT`; o coordenador admite essa intenção apenas com os tipos/operações já autorizados para o relatório. Todas as permissões e limites organizacionais continuam a ser avaliados.
5. Na revisão após o benchmark, um teste adicional demonstrou que o prazo idle podia terminar durante o `await` da validação central. A renovação volta agora a verificar o prazo imediatamente antes de gravar. O teste falhou antes da correção ([evidência](idle-boundary-red.log)) e passou depois. Esta última verificação temporal foi seguida de nova suite backend e gate isolado focado de sessões; o benchmark abaixo precede apenas essa correção de fronteira e não foi repetido após ela.

## Ficheiros deste incremento

| Ficheiro | Ponto alterado |
|---|---|
| [catalogReaderSchema.js](../../../backend/src/security/catalogReaderSchema.js#L2) | Compatibilidade explícita 031/032 |
| [coordinatedSessionStore.js](../../../backend/src/security/coordinatedSessionStore.js#L6) | Adaptador de expiração, renovação e compatibilidade de sessões antigas |
| [sessionSecurity.js](../../../backend/src/security/sessionSecurity.js#L22) | Composição do adaptador com o registo central |
| [authenticatedAuthority.js](../../../backend/src/security/authenticatedAuthority.js#L46) | Prazo idle e deadline do guard |
| [composition.js](../../../backend/src/applications/composition.js#L119) | Intenção explícita da validação final do dashboard |
| [authorityCoordinator.js](../../../backend/src/security/authorityCoordinator.js#L212) | Admissão estrita dessa intenção, mantendo avaliação de cada permissão |
| [coordinatedSessionStore.test.js](../../../backend/test/coordinatedSessionStore.test.js) | Sete testes novos de concorrência, expiração, revogação, compatibilidade e deadline |
| [applicationResponsiblesAuthority.test.js](../../../backend/test/applicationResponsiblesAuthority.test.js#L30) | Revisões aceites e recusa de drift/futuro |
| [sessionEpochProof.js](../../../test/integration/http-oidc/sessionEpochProof.js) | Provas com PostgreSQL e roles reais |
| [gate.js](../../../test/integration/http-oidc/gate.js), [gate.ps1](../../../test/integration/http-oidc/gate.ps1), [README](../../../test/integration/http-oidc/README.md) | Provas integradas, seleção da pasta de evidência e instruções |

Contrato e estado atual atualizados em `context/features/http-flows-performance.md` e `context/current-work.md`.

## Verificação

- Backend focado: 86/86; dashboard/autoridade focados: 14/14 (sete testes partilhados entre comandos).
- Suite backend após as últimas alterações: 1247 PASS, 3 FAIL, 7 SKIP, de 1257 testes. As três falhas são as mesmas da baseline: cancelamento ClamAV, fixture de binding F12/F11 e correspondência histórica do catálogo SQL. Não foram alteradas. Os sete skips exigem uma fixture SQL específica; o gate desta tarefa usa contentores exclusivos e não aponta esses testes à base Dev.
- Frontend: 337/337; build Vite PASS.
- Sintaxe: dez ficheiros JavaScript e o script PowerShell PASS.
- Gate isolado final de sessões, depois da última correção temporal: **PASS, 22 verificações**, exit 0; [resultado](results-sessions.json) e [log](gate-sessions.log). Usa o mesmo PostgreSQL/Keycloak, roles reais e composição HTTP/OIDC, incluindo expiração durante a consulta central. Não é um novo benchmark nem elimina o FAIL de carga.
- Primeiro ensaio de quatro amostras: browse/report 24/24 respostas 200, mas FAIL pelo contrato do dashboard. Preservado em [smoke-before-dashboard-fix.json](smoke-before-dashboard-fix.json) e [gate-smoke.log](gate-smoke.log).
- Primeiro ensaio com a correção do dashboard: percurso autorizado PASS; terminou antes do benchmark numa expectativa demasiado restrita da nova fixture. A prova de browse revogado já tinha removido o contexto da sessão. A repetição confirmou `409 ORGANIZATION_SELECTION_REQUIRED` no pedido seguinte, de acordo com o middleware existente. A fixture passou a admitir essa recusa específica, além de 401/403, e a guardar status/código. Nenhuma validação do produto foi relaxada. Evidência preservada em [fixture-expectation-failure.json](fixture-expectation-failure.json).
- Logs completos: [backend focado](focused.log), [dashboard focado](dashboard-focused.log), [suite backend](backend-suite.log), [suite frontend](frontend-suite.log), [build](vite-build.log), [gate final](gate-final.log).

## Medições HTTP

Comando: `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-oidc/gate.ps1 -Samples 12 -Report http-session-epochs`. Execução completa entre 23:12:09 e 23:21:32 UTC. Quatro pedidos simultâneos da mesma sessão, 12 amostras por percurso/volume e um aquecimento. [Resultados integrais](results.json). p50/p95 abaixo incluem **apenas respostas 200**; as falhas não foram transformadas em latências de sucesso. Com esta amostra pequena, p95 aproxima-se do máximo observado.

| Percurso | Candidaturas | Sucessos | Erros | p50 (ms) | p95 (ms) |
|---|---:|---:|---:|---:|---:|
| Browse | 25 | 12/12 | 0 | 6384,92 | 10744,88 |
| Report | 25 | 11/12 | 1 | 8971,80 | 11110,26 |
| Dashboard | 25 | 12/12 | 0 | 17411,26 | 21374,77 |
| Browse | 1000 | 12/12 | 0 | 6136,52 | 10382,15 |
| Report | 1000 | 11/12 | 1 | 8865,01 | 10851,96 |
| Dashboard | 1000 | 10/12 | 2 | 17098,39 | 18617,82 |
| Browse | 10000 | 12/12 | 0 | 6869,65 | 11205,30 |
| Report | 10000 | 11/12 | 1 | 9469,66 | 9922,12 |
| Dashboard | 10000 | 10/12 | 2 | 15072,58 | 20700,74 |

Comparação com as [12 amostras anteriores](../http-oidc-isolated/benchmark-12.json):

| Indicador | Antes | Depois |
|---|---:|---:|
| Falhas de report | 31/36 | 3/36 |
| Dashboard | bloqueado no leitor; sem quantis válidos | 32/36 sucessos; 4 falhas sob carga |
| Browse 25, p50/p95 (ms) | 9664,97 / 10740,19 | 6384,92 / 10744,88 |
| Browse 1000, p50/p95 (ms) | 10052,24 / 10561,84 | 6136,52 / 10382,15 |
| Browse 10000, p50/p95 (ms) | 10565,79 / 11193,71 | 6869,65 / 11205,30 |

Não há melhoria demonstrada do p95 do browse. Os quantis anteriores do report assentavam em apenas 1/2/2 sucessos; não são uma comparação de latência equivalente. Ambas as execuções usam fixtures locais independentes, sem controlo de carga da máquina que permita inferência de capacidade produtiva.

Browse conserva uma seleção de candidaturas, 25 detalhes e 1074 chamadas `pg` por pedido, nos três volumes. Report bem-sucedido usa 1159 chamadas; dashboard, 2703. O payload máximo com 10000 candidaturas foi 20389/19587/21079 bytes para browse/report/dashboard. O matching serial de 25 pessoas passou com um carregamento agregado de pessoas, 4204 chamadas `pg` e 23,745 s; não constitui p95 de matching.

O gate permanece reprovado por disponibilidade sob concorrência. O único bloqueio final registado é `HTTP performance acceptance`; não há erro de fixture nem erro de cleanup nessa execução. A revogação durante bloqueio SQL foi exercitada na admissão tenant, com commit da revogação antes da libertação do lock; o pedido não publicou sucesso. Este resultado não prova todas as fronteiras possíveis de revogação.

## Limites e riscos

Os números são locais: Windows/Docker, PostgreSQL 17 e Keycloak 26.8.0, dados sintéticos, 25/1000/10000 candidaturas e 25/250/1000 pessoas. Uma membership operacional por identidade, uma oportunidade por tenant e distribuição simples. O leitor central não coordenado da fixture usa `pg_read_all_data`; não se afirma paridade completa de privilégios centrais produtivos. Não foram testados OTP, R2, Resend, antivírus, worker de importação, topologia ou SLO produtivos.

O novo leitor de sessão aceita o formato anterior e converte-o por escrita coordenada. Durante essa conversão, leituras concorrentes antigas podem ser invalidadas de forma conservadora. Não foi validada coexistência com réplicas do runtime anterior nem rollback para o leitor antigo: esse leitor não conhece o novo prazo idle no payload. A validação de rollout/rollback e a revisão de segurança continuam necessárias antes de produção.

Os metadados e revalidações centrais continuam a representar muitas chamadas SQL. Não se introduziu cache de autoridade, fila HTTP global, aumento de timeouts do produto ou bypass de validações para reduzir os números.

## Preservação

Baseline: HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, branch `feat/f13-organizational-profile`, 2123 entradas de estado e 2573 ficheiros com hash. O worktree já estava alterado. Não houve commit, merge, push ou deploy. Nenhuma migration, definição de grants/permissões ou configuração Dev/deploy foi editada. Dados sintéticos foram criados apenas nos contentores exclusivos do gate.

Comparação final: 2562 ficheiros inventariados inalterados; 11 alterações intencionais e três novos ficheiros de código/testes, além da evidência nesta pasta. Zero ficheiros desaparecidos ou alterações inesperadas; 195 ficheiros inventariados de migrations/grants/permissões/deploy sem alterações. HEAD e branch mantidos. Não restaram contentores com a label do gate. [Preservação](preservation.json), [verificação consolidada](verification.json), [hashes finais](final-file-hashes.json) e [pesquisa de segredos nos artefactos](artifact-scan.json). Esta comparação cobre os ficheiros inventariados, não afirma imutabilidade integral de ficheiros ignorados ou do ambiente.

Próximo passo: investigar a duração das revalidações de autoridade e a contenção do pool sob concorrência; manter as validações, os deadlines e a recusa segura até existir evidência para uma alteração dirigida.
