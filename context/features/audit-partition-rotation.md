# Rotação mensal das partições de auditoria

`audit.event` é particionada por mês na Central e em cada tenant. As migrações de base criam apenas `audit.event_2026_10`, `audit.event_2026_11` e `audit.event_default`. A partir de 2026-12-01 os eventos passam para a partição `DEFAULT`, e criar depois a partição desse mês falha porque a tabela é append-only e as linhas não podem ser movidas.

## Critérios de aceitação

- Um operador com um login membro de `c4g_audit_migrator` cria as partições mensais em falta numa base de cada vez, sem alterar migrações, manifests ou fingerprints fixados.
- O plano cobre o mês atual e 1 a 24 meses seguintes (por omissão 3), com limites em UTC independentes do fuso da sessão. Horizonte ou data inválidos são recusados antes de qualquer SQL.
- A operação corre numa transação, com `lock_timeout` e como `c4g_audit_owner`. É idempotente: partições já existentes não são tocadas.
- Se a `DEFAULT` já tiver linhas num mês a criar, a operação recusa com `AUDIT_PARTITION_DEFAULT_CONFLICT` e não cria nada. Qualquer falha de DDL faz rollback e propaga o erro original.
- O resultado indica as partições criadas e o número de linhas na `DEFAULT`, lido dentro da transação (o migrator não tem privilégios de tabela). O script termina com código 2 se esse número for superior a 0.
- Os snapshots de schema Central e tenant e a verificação de capacidades do tenant ignoram as partições `audit.event_AAAA_MM` além das duas de baseline, de modo que partições rotativas não contam como desvio de schema. Os hashes fixados não mudam.
- O preflight da auditoria recusa com `AUDIT_SCHEMA_PREFLIGHT_FAILED` qualquer tabela do schema `audit` com nome mensal que não seja partição de `audit.event`.
- Nenhuma credencial é registada ou impressa.

## Implementação

- [partitionMaintenance.js](../../backend/src/audit/partitionMaintenance.js): plano, criação e contagem da `DEFAULT`.
- [ensureAuditPartitions.js](../../backend/scripts/ensureAuditPartitions.js): script por base (`AUDIT_PARTITION_DATABASE_URL`, `AUDIT_PARTITION_MONTHS_AHEAD`).
- [auditPartitionPolicy.js](../../backend/src/security/auditPartitionPolicy.js): regra das partições ignoradas, usada em `centralSchemaManifest.js`, `tenantSchemaFingerprint.js` e `tenantMigrationPreflight.js`.
- [preflight.js](../../backend/src/audit/preflight.js): verificação de tabelas mensais que não são partições.

## Decisão

Foi escolhido DDL a partir do cliente em vez de uma migração ou de uma função SQL. Os números 036–038 e 043–050 da Central já pertencem a pacotes opcionais cujas entradas derivam da última versão da lista principal, e o fingerprint do tenant inclui todas as funções do schema `audit`. Uma função nova obrigaria a recalcular fingerprints por tenant. Se no futuro a rotação passar a migração, tem de ser decidida com a numeração dos pacotes e o gate isolado.

## Verificação

- 13 testes novos (`auditPartitionMaintenance.test.js`, `auditRotatingPartitions.test.js`). Backend com 2960 aprovados, 9 ignorados e zero falhas; lint limpo.
- PostgreSQL 17 descartável (contentor removido no fim) com a migração `005_f7_append_only_audit` aplicada: criação de `2026_12`, `2027_01` e `2027_02`, segunda execução sem efeito, recusa de conflito com a `DEFAULT` sem criar a partição, `auditPreflight` aprovado com partições rotativas e recusa de `event_2030_01` não particionada. A primeira execução revelou que a contagem lida após o commit falhava com `42501`; passou a ser lida dentro da transação.
- Não validado: execução contra a Central e os tenants habituais, e agendamento mensal. Alarme da `DEFAULT` ainda sem monitor ligado.
