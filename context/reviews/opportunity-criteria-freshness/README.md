# Correção de freshness — critérios evidenciados

Estado: **Review — READY_FOR_HUMAN_REVIEW**, sem fecho humano. Âmbito autorizado em 2026-10-16: corrigir o finding baixo da revisão read-only e consolidar a matriz de aceitação. Avaliação F14, score, ativação e candidatura permanecem excluídos.

## Correção

Head, histórico e detalhe partilham a classificação: UNAVAILABLE se houver referência incompatível; senão REVIEW_REQUIRED se a oportunidade mudou; senão CURRENT. Referências ausentes num draft são incompletude, não incompatibilidade. São mantidos os predicados anteriores: identidade completa conceito/scheme/release, tipo de scheme, release publicada, conceito não deprecated e ownership global ou da organização. Os mesmos predicados bloqueiam a confirmação.

Uma leitura de catálogo por página, com deduplicação da referência tipada completa; máximo 50 revisões/150 critérios. Não há cache entre requests nem writes históricos. Falhas técnicas propagam erro, não CURRENT. Migrations, frontend, autorização e protocolo de recuperação inalterados.

## Matriz de aceitação e natureza da prova

| Critério | Prova específica / mecanismo | Natureza |
|---|---|---|
| CURRENT compatível; UNAVAILABLE incompatível; REVIEW_REQUIRED; precedência combinada | `backend/test/opportunityCriteriaFreshness.test.js`, quatro cenários; `test/integration/criteria/freshness-probes.js`, `consistent` | Unitários + PostgreSQL/HTTP nesta correção |
| Histórico misto e imutabilidade | Mesmo unitário, 50 revisões/2 referências; probe HTTP com três revisões, comparação SQL do conteúdo anterior | Unitário de agrupamento + PostgreSQL real |
| Confirmação recusa referências/incompletude | Unitário sem writes; HTTP REFERENCE_INCOMPATIBLE/EVIDENCE_INCOMPLETE | Executado nesta correção |
| Fonte/interpretação/evidência; confirmação editorial | `opportunityCriteria.test.js` e UI/browser existente; inspeção de contracts/repository/painel | Unitário e browser; sem validação automática da veracidade da transcrição |
| Tenant A/B, IDOR, revisão estrangeira | `criteria/probes.js`: acesso A/B, RLS, revisão B e oportunidade B; suplemento: revisão alheia da mesma organização | PostgreSQL/HTTP |
| Grants read/edit/confirm e mesma pessoa | Probes originais: maker cria/confirma, checker sem confirm; suplemento: ausência individual de edit/read, incluindo histórico/detalhe | PostgreSQL/HTTP |
| Revogação atual e lookup | Probes originais removem grants e recusam head/lookup; suplemento recusa histórico/detalhe após remoção de read | PostgreSQL/HTTP |
| Revogação durante operação | `f13/editorial-security-probes.js`, ordenação oposta da revogação com guard ativo; `editorial-regression.log` anterior PASS | Evidência histórica do guard partilhado + inspeção da ligação inalterada da composição; não é novo probe de corrida de critérios |
| CAS, gravações concorrentes, duplo clique | Probes originais: um sucesso/um 409, browser perda de resposta/reload sem duplicação | PostgreSQL/HTTP/browser |
| Replay, intenção divergente, confirmações concorrentes | Original: replay save; suplemento: replay confirm, key nova STATE_CONFLICT, payload divergente IDEMPOTENCY_CONFLICT, dois confirmadores 200/409 | PostgreSQL/HTTP |
| F7 e atomicidade | Original: falha F7 na confirmação, zero confirmação/evento, FAILED_FINAL; composição e receipt na mesma transação | PostgreSQL real para confirmação; inspeção do caminho save partilhado, não novo fault save |
| Commit incerto e quatro outcomes | Original: ACK perdido, receipt confirmado, FAILED_FINAL, RESOLVING e UNKNOWN; reload e logout | PostgreSQL/HTTP/browser |
| Migrations, ACL, admissão, fingerprints | `../opportunity-evidenced-criteria/migration.log`, F12/UBI, hashes de migrations e infraestrutura preservados | Provas históricas reutilizadas; sem alterações SQL |
| Fora do âmbito: Central operacional/F14/score/ativação/candidatura | Contrato fechado, validação rejeita authority/score; inspeção do delta | Unitário para payload; inspeção para ausência de funcionalidades novas |

A matriz não transforma inspeção em execução. O mecanismo de revogação concorrente é comprovado no consumidor editorial e reutilizado por critérios; não se afirma ter reexecutado essa corrida específica. F7 no save usa a mesma composição transacional, mas a injeção específica preservada é na confirmação. Não se identificou alteração nesses mecanismos que justificasse repetir gates não afetados.

## Preservação e limites

`baseline.json` captura hashes e estado Git anteriores à correção. A pasta de evidência anterior permanece imutável; o screenshot desta execução tem destino separado. `tested-snapshot.json` fixa o código, testes e contrato atuais; `artifact-hashes.json` fixa os artefactos incrementais. O snapshot anterior permanece histórico e não é apresentado como correspondendo ao repositório após a correção.

Validação local com PostgreSQL descartável e IdP sintético. Sem staging, produção, dados reais, IdP externo, SLO, auditoria WCAG integral ou zoom 200%. Sem fecho humano, stage, commit, push ou deploy.

## Diagnóstico preservado

`integration-same-session-failed.log` conserva a primeira execução: os cenários de freshness, precedência e imutabilidade passaram; a asserção adicional de concorrência recebeu 200/503 (AUTHORITY_WRITE_PENDING), em vez de 200/409, usando duas requisições da mesma sessão. A atualização concorrente de sessão interfere no guard. O probe final usa dois sujeitos/sessões independentes, ambos com grant explícito de confirmação, para isolar a concorrência sobre a revisão. Não se converteu 503 em sucesso nem se adicionou retry para ocultar o resultado. Esta recusa transitória de sessão permanece uma limitação conhecida da composição, não uma correção feita neste recorte.

## Resultados finais e revisão read-only

- Focados: `node --test backend/test/opportunityCriteria.test.js backend/test/opportunityCriteriaFreshness.test.js` — **15/15 PASS** (`focused.log`).
- Suite: `npm --prefix backend test` — **790/790 PASS** (`backend-test.log`). O backend não mudou após estas execuções.
- Gate: `powershell -NoProfile -File test/integration/criteria/run.ps1`, screenshot redirecionado para esta pasta — **exit 0**, `CRITERIA_FRESHNESS_HTTP_POSTGRES`, `CRITERIA_ACCEPTANCE_SUPPLEMENT`, `CRITERIA_REAL_HTTP_BROWSER_AB` e `F13_EDITORIAL_CENTRAL_AB` **PASS** (`integration.log`). PostgreSQL descartável removido pelo runner.
- Sintaxe: quatro ficheiros JavaScript do delta; whitespace: diff Git do recorte e scan dos ficheiros novos — **PASS** (`checks.json`).
- Frontend 41/41, build e gates dedicados migration/F12/UBI/editorial anteriores reutilizados, não reexecutados separadamente. Migrations, frontend e mecanismos de autoridade não mudaram; o gate de critérios voltou a exercitar a composição cumulativa real.

Revisão final read-only de `repository.diff` (original reconstruído e SHA-256 confrontado com a baseline antes da comparação), testes, integração e documentação: **PASS**, sem findings materiais novos no delta. A consulta agrupada mantém todos os predicados de admissibilidade anteriores, parametrização, ownership e role limitada, com restauração em finally. Classificação única usada nos três percursos; nenhuma escrita histórica ou nova autoridade. O finding de freshness fica **resolvido**. A limitação de concorrência de sessão descrita acima permanece explícita; não representa prova de violação de isolamento ou duplicação e não bloqueia esta correção.

Próximo passo: decisão humana sobre o fecho restrito do incremento de critérios evidenciados. F13 integral continua In Progress; não há autorização F13→F14.
