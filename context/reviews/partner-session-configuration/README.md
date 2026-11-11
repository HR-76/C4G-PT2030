# Configuração da sessão antes da migração

**Review — 28/10/2026.** Correção limitada ao gate; nenhuma execução PostgreSQL/Docker. [Contrato](../../features/partner-postgres-gate.md), [runbook](../../../test/integration/partner-portal/README.md), [verificação](verification.json).

## Problema reproduzido e correção

P2 — `test/integration/partner-portal/environment.js:111` não definia TimeZone no arranque das ligações tenant. O provisionador abre e usa um pool antes de `ALTER DATABASE ... SET timezone TO 'UTC'`, entregando o mesmo pool ao migration runner. O default da base aplica-se às sessões iniciadas posteriormente; uma sessão existente pode continuar com outro valor. [PostgreSQL 17 — ALTER DATABASE](https://www.postgresql.org/docs/17/sql-alterdatabase.html).

A regressão controlada confirmou o mecanismo: a sessão simulada mantém `Etc/UTC` depois de o default da base mudar para `UTC`, e o validador original recusa-a com `DATABASE_CONFIGURATION_MISMATCH`. Este é um valor da fixture, não um valor observado na terceira tentativa. A evidência dessa tentativa continua sem identificar o campo divergente.

O objeto de ligação tenant do gate passou a fornecer `options: '-c timezone=UTC'`. O driver instalado encaminha a opção no startup; a sessão começa com o valor exigido antes da primeira query. O mesmo objeto é usado pelos pools do provisionador e pelos pools owner/limitados do environment. A projeção de credenciais do runtime não mudou; novas ligações posteriores beneficiam do default de base que o provisionador continua a definir.

Não foram alterados provisionador, migration runner, `validateDatabaseContract`, migrations, grants, autoridade, contratos públicos, variáveis do processo ou configuração global. A verificação continua a exigir UTC exato, UTF8, ICU `und` e versão de collation não vazia. Não foram acrescentadas queries corretivas nem relaxados critérios para obter PASS.

## Regressões e validação

Oito testes adicionados antes da correção. RED inicial: sete controlos passaram e o percurso positivo falhou com o erro branded de configuração; após a correção, 8/8 PASS. Os testes executam environment, provisionador, migration runner e validador reais sobre pool controlado. Um erro sentinela após o contrato aprovado impede executar SQL de migrations; rollback, unlock e fecho continuam exercitados. A opção explícita passa pelo parser de startup do driver instalado, sem sockets.

Os seis controlos negativos alteram separadamente encoding do servidor, encoding da base, locale provider, locale ICU, versão de collation e TimeZone; todos continuam recusados pelo mesmo validador. O controlo sem opção usa o default do modelo e não herda `PGOPTIONS` do host. Cada aquisição exige uma libertação correspondente, e todos os pools/Central são fechados.

| Validação | Resultado |
| --- | --- |
| Novas regressões | 8 PASS |
| Foco de parceiros | 195 PASS / 0 FAIL / 0 SKIP |
| Backend `npm test` | 1533 PASS / 0 FAIL / 7 SKIP; baseline 1525/0/7 |
| Frontend `npm test` | 346 PASS, 55 ficheiros |
| Frontend `npm run build` | PASS |
| Sintaxe | PASS nos dois ficheiros JavaScript alterado/adicionado |
| Revisão independente | Sem bloqueios; reforços de cleanup e independência de PGOPTIONS incorporados |
| Manifest | 1013 fontes; revisto apenas o hash de environment |

Depois do foco completo, os oito testes foram repetidos com as asserções reforçadas, antes da suite backend completa final. Os sete SKIP PostgreSQL e mensagens esperadas jsdom/chunk sintético são preexistentes. Sem novas falhas nas suites.

## Ficheiros, medições e riscos

- `test/integration/partner-portal/environment.js`: opção inicial UTC nas ligações do gate.
- `backend/test/partnerSessionConfiguration.test.js`: oito regressões novas.
- `test/integration/partner-portal/sources.json`, `README.md`: manifest revisto e instruções.
- `context/features/partner-postgres-gate.md`, `context/current-work.md`: estado.
- `context/reviews/partner-session-configuration/README.md`, `verification.json`: evidência deste incremento.

Sem medições de desempenho PostgreSQL antes/depois. Na fixture, sessão antes/depois `Etc/UTC`→`UTC`, contrato recusado→aprovado e seis desvios independentes continuam recusados; não extrapolar latência ou capacidade desta comparação.

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline 2613 entradas no worktree e 30987 ficheiros. Inventário e fontes conferidos; build/cache frontend regenerados pela validação. Sem alterações inesperadas ou remoções. As três tentativas e os seus manifests arquivados ficaram intactos.

**Runtime, protótipo, migrations, grants/permissões e dados Dev preservados.** Sem commit, merge, push, deploy ou integração. A causa exata da terceira tentativa e o resultado real após esta correção permanecem por confirmar. Snapshot, RLS, revogação, cleanup e capacidade ainda exigem o gate PostgreSQL; o contrato estrito continua a poder revelar outros desvios.

**Próximo passo:** executar nova tentativa no âmbito isolado já autorizado, preservando as três falhas anteriores e mantendo o contrato estrito.
