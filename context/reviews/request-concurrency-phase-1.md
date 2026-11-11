# Revisão da concorrência de pedidos — fase 1

Data: 2026-10-26

Ref revista: `0cf519ea22de929d2e52d0b3edb4d72364aa6220`

Estado recomendado: **Review**

Veredicto: **REQUEST CHANGES**

## Conclusão

O código da fase cumpre as invariantes unitárias e a prova PostgreSQL local confirma que leituras se sobrepõem sem adquirir o advisory lock de candidaturas, enquanto escritas da mesma organização continuam serializadas. Durante a revisão, a classificação frágil pelo sufixo `_READ` foi substituída por metadado explícito e fechado no catálogo.

A fase não deve passar para Done nesta execução: a API, o frontend e o IdP não estavam ativos, e os gates integrados existentes executam operações proibidas para esta revisão (criação de bases, migrations ou mutação de fixtures). Ficam por provar, através da stack HTTP/OIDC completa, o cancelamento real e a troca de organização sem resposta cruzada. Não se infere qualquer melhoria percentual de latência.

## Findings

1. **P1 — bloqueante de fecho: falta validação HTTP/OIDC integrada.** A prova atual mede PostgreSQL e os testes de componentes, mas não mede p50/p95 HTTP, cancelamento Axios→Express→PostgreSQL nem uma troca autenticada de organização. O script de baseline está em `test/integration/application-concurrency/current-baseline.js:1` e identifica expressamente o resultado como não SLO.
2. **P2 — gate global backend não verde, mas sem relação com a fase.** Permanecem três falhas reproduzidas: `backend/test/f11RealTransportAdapters.test.js:209`, `backend/test/f12Composition.test.js:20` e `backend/test/f5AuthorityCommitGuard.test.js:18`. O ficheiro rastreado `dev/local/check.js` está apagado antes desta revisão e o teste correspondente deixa de ser descoberto pela suite.
3. **P3 — cancelamento intencionalmente parcial.** A adoção em effects está em `frontend/src/pages/Applications/ApplicationBrowse.jsx:22`, `frontend/src/pages/Partners.jsx:53` e `frontend/src/pages/Opportunities/OpportunityApplicationCount.jsx:11`. Outros wrappers aceitam sinal, mas os restantes consumidores não foram convertidos nesta fase; não existe cancelamento global.

Não foram encontrados defeitos de código conhecidos na barreira ou na aquisição do lock depois das correções desta revisão.

## Invariantes verificadas

| Invariante | Evidência | Resultado |
|---|---|---|
| Trabalho comum pode sobrepor-se | `OrganizationRequestQueue.test.jsx`; duas Promises admitidas antes de resolver | PASS |
| Mudança espera por trabalho anterior | `sessionQueue.test.jsx`; rotação não inicia antes da leitura | PASS |
| Trabalho posterior espera pela mudança | `sessionQueue.test.jsx`; segunda leitura inicia após a rotação | PASS |
| Mudanças mantêm ordem de admissão | teste com duas seleções pendentes | PASS |
| Rejeição não bloqueia a fila | testes de mudança rejeitada e leitura rejeitada | PASS |
| Organização explícita não depende do contexto implícito | leitura do diretório progride durante mudança pendente | PASS |
| Upload não entra na barreira | upload pendente e GET concluído | PASS |
| Sem unhandled rejection criada pelo coordenador | handlers de sucesso e rejeição removem cada Promise do `Set`; `allSettled` neutraliza trabalho anterior | PASS estático |
| Sem crescimento ilimitado do coordenador | trabalho concluído é removido; apenas a tail neutralizada mais recente permanece | PASS estático |

## Catálogo de operações

`documentTransportAccess` não altera diretamente a linha de candidatura, mas autoriza um transporte mutável e permanece deliberadamente no caminho WRITE.

| Método | Operação | Acesso | Altera estado? | Lock? |
|---|---|---|---|---|
| report | APPLICATION_READ | READ | não | não |
| reportExport | APPLICATION_READ | READ | não | não |
| noticesContext | NOTIFICATION_READ | READ | não | não |
| noticesHistory | ORGANIZATION_NOTICE_READ | READ | não | não |
| noticesGet | ORGANIZATION_NOTICE_READ | READ | não | não |
| noticesSend | ORGANIZATION_NOTICE_SEND | WRITE | sim | sim |
| alertsList | NOTIFICATION_READ | READ | não | não |
| alertsRead | NOTIFICATION_ACK | WRITE | sim | sim |
| alertsReadAll | NOTIFICATION_ACK | WRITE | sim | sim |
| alertsRefresh | NOTIFICATION_SYNC | WRITE | sim | sim |
| partnersGet | APPLICATION_READ | READ | não | não |
| partnersHistory | APPLICATION_READ | READ | não | não |
| partnersBrowse | APPLICATION_READ | READ | não | não |
| partnerCreate | APPLICATION_EDIT | WRITE | sim | sim |
| partnerEdit | APPLICATION_EDIT | WRITE | sim | sim |
| partnerRemove | APPLICATION_EDIT | WRITE | sim | sim |
| create | APPLICATION_CREATE | WRITE | sim | sim |
| edit | APPLICATION_EDIT | WRITE | sim | sim |
| transition | APPLICATION_TRANSITION | WRITE | sim | sim |
| get | APPLICATION_READ | READ | não | não |
| history | APPLICATION_READ | READ | não | não |
| list | APPLICATION_READ | READ | não | não |
| browse | APPLICATION_READ | READ | não | não |
| opportunitySummaries | APPLICATION_READ | READ | não | não |
| responsibles | APPLICATION_READ | READ | não | não |
| workGet | APPLICATION_WORK_READ | READ | não | não |
| workHistory | APPLICATION_WORK_READ | READ | não | não |
| participantAdd | APPLICATION_WORK_EDIT | WRITE | sim | sim |
| participantRemove | APPLICATION_WORK_EDIT | WRITE | sim | sim |
| taskCreate | APPLICATION_WORK_EDIT | WRITE | sim | sim |
| taskEdit | APPLICATION_WORK_EDIT | WRITE | sim | sim |
| taskComplete | APPLICATION_WORK_EDIT | WRITE | sim | sim |
| taskCancel | APPLICATION_WORK_EDIT | WRITE | sim | sim |
| documentCandidates | APPLICATION_DOCUMENT_READ | READ | não | não |
| documentGet | APPLICATION_DOCUMENT_READ | READ | não | não |
| documentHistory | APPLICATION_DOCUMENT_READ | READ | não | não |
| documentDownload | APPLICATION_DOCUMENT_READ | READ | não | não |
| documentTransportAccess | APPLICATION_DOCUMENT_EDIT | WRITE | autoriza mutação | sim |
| documentLink | APPLICATION_DOCUMENT_EDIT | WRITE | sim | sim |
| documentRemove | APPLICATION_DOCUMENT_EDIT | WRITE | sim | sim |
| reviewRequest | APPLICATION_DOCUMENT_EDIT | WRITE | sim | sim |
| reviewDecide | APPLICATION_REVIEW_DECIDE | WRITE | sim | sim |

A transação é aberta e preparada por `tenantLeaseExecutor` antes de `queryModule.execute`; o lock é adquirido em `composition.js:90` pelo mesmo cliente transacional, depois da resolução da autoridade e da organização. A autenticação, autoridade, tenant runtime e organização esperada permanecem inalterados. O lock WRITE continua organizacional; não foi reduzido para `applicationId`.

## Cancelamento coberto

| Fluxo UI | Cleanup aborta? | Ignora `ERR_CANCELED`? | Impede resposta antiga? |
|---|---|---|---|
| Listagem de candidaturas | sim | sim | sim, por `active` e abort |
| Parceiros | sim | sim | sim, por remount com chave da organização, `active` e abort |
| Contagem por oportunidade | sim | sim | sim, por remount com chave da organização, `active` e abort |

Os testes cobrem unmount, alteração rápida de filtros, mudança de organização, resposta fora de ordem e propagação do sinal ao cliente HTTP. Esta tabela não representa toda a camada HTTP.

## Baseline integrada disponível

Execução local, PostgreSQL real, `BEGIN`/`ROLLBACK`, sem migrations nem persistência:

| Métrica | Valor atual |
|---|---:|
| Warmup | 4 leituras |
| Amostras | 10 leituras, 5 pares |
| Pares com sobreposição | 5/5 |
| Duração de leitura p50 / p95 | 61,074 / 62,212 ms |
| Espera do pool p50 / p95 | 0,078 / 0,258 ms |
| Queries por leitura | 5 |
| Locks de candidatura em leituras | 0 |
| Erros | 0 |
| Leituras simultâneas concluídas | 10 |
| Locks advisory na primeira escrita | 1 |
| Espera da segunda escrita | 104,795 ms |
| Chamadas de lock WRITE | 2 |

O probe inclui `pg_sleep(50 ms)` para tornar a sobreposição determinística. Estes valores constituem uma baseline atual de infraestrutura, não um SLO HTTP nem prova de melhoria antes/depois.

Indisponível nesta execução: p50/p95 HTTP, espera de pool por rota HTTP, taxa de erros da API, cancelamento end-to-end e troca autenticada de organização. As portas 3000, 5000, 8080 e 8443 não tinham listeners; iniciar a plataforma alteraria serviços locais fora do recorte, e os gates existentes aplicam migrations ou fixtures.

## Falhas globais

| Evidência | Reprodução | Classificação |
|---|---|---|
| F11 ClamAV lifecycle | falhou na suite, passou isolado e falhou 1/3 em grupo próximo; limite de 2 s | preexistente comprovada, flaky e fora do recorte |
| F12 composition | falha isolada: fixture inline omite `abortMultipartSession`, exigido pelo port atual | preexistente comprovada e fora do recorte |
| F3 local check | `dev/local/check.js` está marcado `D`; a ausência foi confirmada | preexistente comprovada e fora do recorte |
| F5 authority hash | hash `a276431...` pertence à migration 030; o teste alterado só agrega 025/027/028 | preexistente comprovada e fora do recorte |

Nenhuma destas falhas toca os ficheiros da Fase 1. F11 demonstra flakiness real do baseline atual; não foi ocultada nem corrigida fora do âmbito.

## Comandos e resultados

| Comando | Resultado |
|---|---|
| frontend `npm test` | PASS, 53 ficheiros / 323 testes |
| frontend `npm run build` | PASS, 1719 módulos |
| frontend focado, seis ficheiros | PASS, 21 testes |
| backend `node --test` nos `application*.test.js` | PASS, 43 testes |
| backend focado de candidaturas/autoridade | PASS, 23 testes |
| backend `npm test` | FAIL baseline, 1223/1226; F11, F12 e F5 |
| `node --check` nos JavaScript alterados aplicáveis | PASS |
| baseline PostgreSQL local | PASS; métricas acima |
| pesquisa dos dois símbolos da fila antiga | zero ocorrências |
| pesquisa de `pg_advisory_xact_lock` no domínio | uma implementação WRITE e a respetiva asserção de teste |
| `git diff --check` | FAIL fora do recorte: blank line no EOF em três ficheiros F13 já modificados; apenas avisos CRLF nos restantes |

Não existem scripts de lint ou type checking nos manifests frontend/backend.

## Ficheiros alterados pela revisão

- `backend/src/applications/composition.js`
- `backend/test/applicationConcurrency.test.js`
- `frontend/src/components/OrganizationRequestQueue.test.jsx`
- `frontend/src/pages/Applications/ApplicationBrowse.test.jsx`
- `frontend/src/pages/Applications/PartnersBrowse.test.jsx`
- `test/integration/application-concurrency/current-baseline.js`
- `context/features/request-concurrency-phase-1.md`
- `context/current-work.md`
- `context/reviews/request-concurrency-phase-1.md`

Os restantes ficheiros da implementação Fase 1 foram apenas revistos. O worktree tinha 795 entradas antes desta revisão; nenhuma alteração alheia foi revertida.

## Riscos residuais e decisão

- Uma prova de unidade não substitui cancelamento real através do browser, proxy, Express e PostgreSQL.
- A baseline PostgreSQL usa um pool de quatro ligações e carga reduzida; não caracteriza saturação nem SLO de produção.
- Comandos continuam intencionalmente serializados por organização; granularidade por candidatura fica para uma tarefa com prova específica.
- As falhas globais baseline devem ser aprovadas formalmente ou corrigidas em tarefas separadas.

**Recomendação explícita:** não mover a Fase 1 de Review para Done. Repetir uma validação local, não destrutiva e autenticada com a stack HTTP/OIDC ativa, cobrindo concorrência, upload+GET, troca de organização e cancelamento end-to-end; depois registar a aprovação formal das falhas baseline.
