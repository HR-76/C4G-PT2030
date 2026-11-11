# Diagnóstico de domínio e subetapas de TENANT_ENSURE

**Review — 28/10/2026.** Instrumentação isolada validada offline; nenhuma nova execução PostgreSQL. [Contrato](../../features/partner-postgres-gate.md), [runbook](../../../test/integration/partner-portal/README.md), [verificação](verification.json). As [primeira](../partner-portal-pg-f8ca4c45e35a826640ac25d2f8fa97ef/README.md) e [segunda](../partner-portal-pg-a7dc74a8441914bb00646b077a009ce9/README.md) falhas permanecem intactas.

## Alteração e evidência

O diagnóstico anterior perdeu a classificação dos erros de migração: estes têm identidade privada e `internalCode` não enumerável, em vez de `error.code`. A observação de `TENANT_ENSURE` também não distinguia as operações internas do provisionador. Estas lacunas estão corrigidas; a causa concreta da segunda tentativa continua desconhecida.

`setupErrorDiagnostic.js` reconhece códigos de domínio por listas verificadas nas fontes, incluindo erros de migração cuja identidade é confirmada pelo módulo original. Agregados conservam a ordem primária/cleanup e são limitados a oito causas e profundidade três. Conteúdo desconhecido é recusado; getters/proxies não são invocados. Nos helpers legados com identificadores fixos na mensagem, esta é apenas chave de lookup exato, nunca texto livre exportado.

`provisioningDiagnostic.js` carrega o provisionador exato num módulo privado e observa apenas as dependências. Regista subetapa, estado e primeira classificação de falha; não exporta SQL, parâmetros, identificadores ou credenciais. Binding/reserva, aquisição/lock, roles/base, configuração, migração, identidades, preflight/LOGINs, publicação Central e cleanup têm fronteiras próprias. O observador usa a mesma sequência do setup; não se declara suporte a chamadas concorrentes no mesmo observador.

O código do provisionador e das suas dependências não foi editado. Um percurso completo com doubles comprovou a mesma sequência de operações, argumentos, resultado e cleanup — zero queries adicionais nessa fixture. A identidade do erro devolvido é preservada, inclusive o comportamento preexistente em que uma falha de `pool.end()` pode substituir a falha primária; nesse caso `substepFailure` conserva a primeira falha observada. O diagnóstico não transforma uma falha em sucesso nem substitui provas de cleanup físico.

## Revisão e regressões

| Prioridade / evidência | Impacto e causa | Correção / teste |
| --- | --- | --- |
| P2 — `backend/src/security/tenantMigrationErrors.js:11` e `setupErrorDiagnostic.js:60` | `internalCode` privado não era reconhecido, produzindo UNKNOWN. | Classificação branded/allowlist, agregados limitados e testes de falsificação, ciclos, proxies/getters e canários. |
| P2 — `provisioningDiagnostic.js:51` | Wrappers por Proxy sobre as factories reais congeladas violariam invariantes e lançariam TypeError. | Facade separada; doubles frozen reproduziram RED antes da correção. |
| P2 — `provisioningDiagnostic.js:116` | Falhas em métodos transacionais Central poderiam ser atribuídas ao cleanup posterior. | Wrappers dos cinco repositórios privados e regressão de falha num método após a query inicial. |
| P2 — `provisioningDiagnostic.js:99` | Recusa síncrona de ownership entre queries podia perder a subetapa durante rollback/unlock. | Captura de `contracts.fail` no módulo privado; contraexemplo falhou antes da correção. |
| P2 — `provisioningDiagnostic.js:74` | Falha síncrona de release era atribuída a unlock. | Wrapper síncrono preserva valor/throw; RED/green específico. |

Os módulos novos começaram por RED de carregamento ausente. Acrescentaram-se contraexemplos funcionais durante a revisão; não se apresenta RED de carregamento como prova PostgreSQL. A integração no environment também teve RED por classificação UNKNOWN antes de reconhecer o erro branded e conservar a subetapa durante o fecho local.

27 testes novos: 19 de observação de ensure, sete de classificação e um de integração no environment. Incluem falhas injetadas em 13 pontos, equivalência de percurso completo e comportamento com erros de cleanup/observador. As regressões anteriores mantêm as expectativas; a fixture apenas acompanha a nova fronteira privada do provisionador.

| Validação final | Resultado |
| --- | --- |
| Diagnóstico novo e regressões anteriores relacionadas | 34 PASS |
| Foco de parceiros | 186 PASS / 0 FAIL / 0 SKIP |
| Backend `npm test` | 1524 PASS / 0 FAIL / 7 SKIP; baseline 1497/0/7 |
| Frontend `npm test` | 346 PASS, 55 ficheiros |
| Frontend `npm run build` | PASS |
| `node --check` | PASS em seis ficheiros |
| Manifest | 1013 fontes; uma fonte anterior e dois módulos novos revistos |

Os sete SKIP PostgreSQL e mensagens esperadas jsdom/chunk sintético são preexistentes. Uma primeira suite backend passou 1523 testes; foi repetida integralmente após a última regressão/correção de release, resultando nos 1524 acima. Sem falhas pendentes nas suites.

## Achado preexistente separado

**P2 — `test/integration/partner-portal/environment.js:144`:** o preflight exterior chama `preflightTenant(pool, expected)` sem `timeoutMs`. `backend/src/security/tenantMigrationPreflight.js:566` exige esse argumento e recusa a chamada antes de adquirir ligação. Reprodução offline com pool controlado confirmou TypeError e zero tentativas de conexão. Este defeito não foi introduzido pelo diagnóstico e não explica a falha registada em `TENANT_ENSURE`; a fase seguinte ainda não foi atingida no ensaio real.

Correção recomendada: fornecer um orçamento de preflight explícito, dentro dos limites existentes do gate, e acrescentar primeiro uma regressão que comprove o argumento, a aquisição permitida apenas após validação e o fecho em erro. Não se alterou esse comportamento neste incremento de diagnóstico.

## Ficheiros e preservação

- Novos: `test/integration/partner-portal/provisioningDiagnostic.js`, `setupErrorDiagnostic.js`; `backend/test/partnerEnsureDiagnostic.test.js`, `partnerSetupErrorDiagnostic.test.js`.
- Alterados: `test/integration/partner-portal/environment.js`, `sources.json`, `README.md`; `backend/test/partnerSetupDiagnostic.test.js`; `context/features/partner-postgres-gate.md`, `context/current-work.md`.
- Registo: `context/reviews/partner-ensure-diagnostic/README.md`, `verification.json`.

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline 2600 entradas no worktree e 30974 ficheiros. Inventário de metadados e manifest conferidos; build/cache frontend regenerados pela validação. Sem alterações inesperadas ou remoções. As duas evidências de execução e os seus manifests arquivados não foram reescritos.

**Runtime, protótipo, migrations, grants/permissões e dados Dev preservados.** Sem Docker/SQL real, commit, merge, push, deploy ou integração. Sem medições PostgreSQL antes/depois; equivalência de operações com doubles não prova latência ou capacidade. A futura execução pode revelar outros erros; listas desconhecidas continuam a produzir diagnóstico limitado, sem exposição de conteúdo bruto.

**Próximo passo:** corrigir a omissão de `timeoutMs` no preflight exterior com regressão primeiro, antes de outra tentativa isolada.
