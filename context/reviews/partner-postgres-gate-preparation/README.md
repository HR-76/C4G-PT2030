# Preparação do gate PostgreSQL de parceiros

**Review — 28/10/2026. Preparação validada; PostgreSQL NOT_RUN.** [Contrato](../../features/partner-postgres-gate.md), [runbook e comandos](../../../test/integration/partner-portal/README.md), [plano offline](plan.json) e [verificação estruturada](verification.json).

## Resultado e fronteira

Pacote executável separado do runtime ativo. Prepara snapshot, isolamento por organização, revogação, cleanup e comparação de capacidade do protótipo com o leitor atual. Nenhum contentor, base, SQL, writer ou carga foi executado nesta preparação; as suites abaixo não substituem prova PostgreSQL.

O modo por omissão/`--plan` devolve `NOT_RUN`. A futura execução exige âmbito exato, imagem local imutável, contexto/daemon Docker local fixo, ownership e porta loopback verificados. Só o contentor próprio pode ser removido. O manifest fixa 1011 fontes e recusa alterações. Evidência incompleta ou contraditória, falha de observação/execução/cleanup e desvio de fontes impedem PASS; o avaliador recalcula os resultados em vez de confiar em flags guardados. Mesmo um futuro PASS não autoriza integração nem capacidade produtiva.

| Grupo preparado | Cobertura |
| --- | --- |
| Repositório: 14 cenários | LOGIN limitado, FORCE RLS, duas organizações e ligações cruzadas; equivalência/cursor/collation e matriz dos 16 contratos; alterações antes/depois de DECLARE e entre FETCHs; CLOSE, erro local/SQL, cancelamento, desconexão e reutilização |
| Autoridade: nove cenários | Membership/política com writer primeiro e guard primeiro; sessão revogada; equipa antes/durante scan e cache; falha real de auditoria F7 |
| Capacidade: 13 cenários | Volumes 0/25/26/100/101/10000/10001 e seis perfis; dois pares AB/BA por cenário, 52 tentativas medidas previstas e 26 aquecimentos separados |

## Riscos tratados na preparação

Estes pontos foram corrigidos no novo harness, sem alteração do runtime. As regressões antecederam cada correção.

| Prioridade / evidência | Impacto e causa | Correção e teste |
| --- | --- | --- |
| P1 — `test/integration/partner-portal/gate.js:144` | Uma porta loopback num daemon Docker remoto não identifica o host local; confiar apenas no mapping poderia ligar ao destino errado. | Recusar endpoints remotos, fixar contexto/endpoint/daemon e voltar a conferir antes de cada comando. Regressão `partnerPostgresGate.test.js:45`. |
| P2 — `test/integration/partner-portal/gate.js:94` e `evidence.js:14` | Flags PASS podem ocultar RLS contraditório, casos/métricas ausentes ou erro de execução. | Validar invariantes, cobertura, fontes e resultados brutos. Controlos positivos e contraexemplos em `partnerPostgresGate.test.js:87` e `partnerPortalEvidenceGate.test.js`. |
| P2 — `test/integration/partner-portal/gate.js:139` | Um fecho/probe pendente podia impedir a remoção final do contentor próprio. | Deadlines das fases e do fecho, seguidos de cleanup independente. Regressão `partnerPostgresGate.test.js:59`; prova física futura ainda necessária. |
| P2 — `test/integration/partner-portal/gate.js:149` | Nomes de variáveis Windows sem distinção de maiúsculas podiam contornar a recusa de configuração herdada. | Verificação sem distinção de maiúsculas. Regressão `partnerPostgresGate.test.js:53`. |
| P2 — `test/integration/partner-portal/authorityProbe.js:9` | Aceitar qualquer exceção como revogação podia converter uma falha de infraestrutura em prova positiva. | Exigir código e causa de autoridade esperados; teste de recusas tipadas em `partnerPortalAuthorityGate.test.js`. |

## Testes e build

Testes novos escritos antes dos módulos, com RED inicial por módulo ainda ausente; controlos adicionais de revisão também falharam antes das respetivas correções. Não se apresenta esse RED de carregamento como prova funcional do PostgreSQL. As regressões offline verificam regras do runner, avaliadores e observadores com fixtures/doubles.

| Validação | Resultado |
| --- | --- |
| Novos testes offline | 72 PASS: runner 15, autoridade 7, evidência 7, repositório 10, capacidade 22, collector 11 |
| Foco de parceiros, incluindo contrato e protótipo anteriores | 152 PASS / 0 FAIL / 0 SKIP |
| Backend `npm test` | 1490 PASS / 0 FAIL / 7 SKIP; antes: 1418 PASS / 0 FAIL / 7 SKIP |
| Frontend `npm test` | 346 PASS, 55 ficheiros; mesma baseline |
| Frontend `npm run build` | PASS |
| `node --check` | PASS nos 14 novos ficheiros JavaScript |
| CLI `--plan` | PASS de preparação; resultado explícito NOT_RUN |
| Manifest | 1011 hashes conferidos |

Os sete SKIP de integração PostgreSQL já existiam; não foram ativados, substituídos nem ocultados. O frontend conserva mensagens esperadas dos testes de navegação jsdom e de falha sintética de chunk, sem falhas de testes. Não há novas falhas pendentes nas suites. Foi concedida permissão aos subprocessos locais necessários às suites/build; isso não executou o gate de infraestrutura.

## Ficheiros desta alteração

| Área | Ficheiros |
| --- | --- |
| Runner e política | `test/integration/partner-portal/gate.js`, `policy.json`, `sources.json` |
| Ambiente e provas | `test/integration/partner-portal/environment.js`, `repositoryProbe.js`, `authorityProbe.js` |
| Avaliação e capacidade | `test/integration/partner-portal/evidence.js`, `capacity.js`, `capacityProbe.js` |
| Instruções | `test/integration/partner-portal/README.md` |
| Regressões | `backend/test/partnerPostgresGate.test.js`, `partnerPortalAuthorityGate.test.js`, `partnerPortalEvidenceGate.test.js`, `partnerPortalRepositoryGate.test.js`, `partnerPortalCapacityGate.test.js`, `partnerPortalCapacityProbe.test.js` |
| Suporte sintético | `backend/test/support/partnerPortalGateEvidence.js` |
| Contexto | `context/features/partner-postgres-gate.md`, `context/current-work.md` |
| Registo | `context/reviews/partner-postgres-gate-preparation/README.md`, `plan.json`, `verification.json` |

O build/cache frontend foi regenerado pela validação. A conferência contra o inventário inicial e oito hashes anteriores de fontes selecionadas está em `verification.json`. Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline 2568 entradas no worktree e 30942 ficheiros. O inventário é de metadados, não um snapshot de bases externas. Não houve alterações inesperadas nem remoções.

## Medições e riscos pendentes

Sem medições PostgreSQL antes/depois neste incremento. Foram preparados os observadores de operação, admissão, queries, autorizações, linhas, bytes, memória, temporários e cleanup; não há números reais a extrapolar de testes com doubles.

- A primeira execução isolada ainda precisa de comprovar setup, SQL e comportamento do driver; os testes offline não eliminam esse risco.
- As sessões de autoridade são sintéticas, sem OIDC/browser. Os writers concorrentes dos casos de equipa/cache usam SQL sintético direto; não provam a concorrência do endpoint auditado.
- Duas fixtures podem ser recusadas pelo armazenamento real (origem/avaliação incompatível e surrogate Unicode isolado). A categoria prevista é registada sem a converter em PASS de leitura ou enfraquecer o oracle.
- A capacidade é medida sequencialmente, não como throughput HTTP concorrente. RSS/heap incluem o harness; temporários são estatísticas agregadas sujeitas a atraso; tempo de operação observado começa no BEGIN, com admissão separada e deadline real do executor preservado.
- Limites existentes de 10 s/operação, 5 s/admissão e 1 MiB/resposta mantidos. Não se transplantou o SLO C6 nem se inventou aprovação produtiva de p95/memória.

Runtime, protótipo, contratos HTTP/cursor, oracle e alterações anteriores preservados. **Migrations, grants/permissões e dados Dev não foram alterados ou executados.** Sem commit, merge, push, deploy ou integração.

**Próximo passo:** autorizar a execução descartável descrita no runbook, com imagem local imutável e migrations/grants exclusivamente no contentor criado para o gate, antes da integração.
