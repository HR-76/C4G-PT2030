# Compatibilidade histórica de lineage F9

- Estado: **Aprovada**
- Data: 2026-10-10
- Âmbito: migrations Central F9, runtime assíncrono e upgrade de instalações existentes

## Contexto

A evolução F9 introduziu lineage verificável para novas execuções, retries e replays. Instalações anteriores já podem conter execuções terminais com `attempt`, retries históricos, dead letters e outbox publicada, mas sem `delivery_kind`, cadeia de execução ou digests modernos.

Esses dados são evidência operacional histórica. Não é possível reconstruir lineage moderno de forma fiável a partir deles, e apagá-los ou reinterpretá-los durante o upgrade violaria a política de preservação de histórico.

## Decisão

É adotada uma política conservadora com duas versões explícitas:

- `lineage_version = 0` identifica exclusivamente registos legacy existentes antes da evolução de lineage;
- `lineage_version = 1` é obrigatório para toda nova execução criada depois do upgrade.

O upgrade preserva integralmente os valores históricos que já existem, incluindo `execution.attempt`, retries, estados terminais, dead letters e outbox publicada. Não inventa `delivery_kind`, root/previous execution, replay request, content digest ou envelope digest para dados legacy.

O valor `0` é atribuído somente pela migration de upgrade aos registos preexistentes. O runtime não pode criar novos registos v0.

## Invariantes

### Lineage v0

- somente dados preexistentes e em estados terminais podem permanecer em v0;
- `execution.attempt` é preservado e continua maior ou igual a 1;
- outbox, execution e dead letter preservam identidade, estado e relações históricas;
- campos modernos de lineage permanecem `NULL`;
- v0 não é elegível para replay moderno nem recebe lineage sintetizado;
- serializers, queries e observabilidade devem tolerar `attempt` histórico não nulo sem o interpretar como lineage v1.

### Lineage v1

- toda nova execução é v1;
- `delivery_kind`, `attempt`, root, digests e relações exigidas são validados por constraints;
- `INITIAL`, `RETRY` e `REPLAY` obedecem às formas fechadas aprovadas;
- lineage e identidade ficam imutáveis depois da criação;
- replay exige grant e request persistentes e nunca converte uma execução v0.

As permissões de compatibilidade de v0 não podem ser usadas para criar ou enfraquecer uma execução nova.

## Upgrade

A migration Central canónica `007_f9_execution_lineage`:

1. adquire locks sobre as tabelas F9 relevantes;
2. recusa o upgrade se existirem estados não drenados incompatíveis;
3. adiciona os tipos, campos, constraints, índices e funções de lineage;
4. marca como v0 somente os registos existentes;
5. preserva `attempt` nas execuções legacy, outbox publicada e dead letters;
6. instala a proteção que exige v1 em novos inserts;
7. cria o contrato persistente de replay sem reescrever o histórico.

A migration é aplicada exclusivamente pelo runner Central e participa no manifest, checksum, fingerprint e ledger cumulativos. Não pode ser executada down/up isoladamente sobre um schema cumulativo posterior.

## Downgrade

O down é permitido apenas quando não existem registos v1 nem replay requests. Nessa condição, remove a estrutura moderna e conserva os dados legacy e o respetivo `attempt`.

Se existir qualquer evidência moderna, o downgrade falha fechado com `F9_LINEAGE_ROLLBACK_REQUIRES_NO_V1`. Não é autorizado apagar, converter ou reinterpretar dados para tornar o downgrade possível.

## Runtime e replay

- projeções e writers modernos aceitam apenas lineage v1 completo;
- registos v0 podem ser consultados como histórico, mas não são replayable pelo fluxo moderno;
- a execução original nunca é reescrita para produzir retry ou replay;
- divergências de digest, lineage, tenant ou replay request falham fechado;
- a causa técnica pode ser preservada internamente, mas erros públicos permanecem sanitizados.

## Evidência obrigatória

O contrato é validado em PostgreSQL 17 descartável por um cenário isolado que:

- cria um prefixo Central real através do runner;
- semeia execução terminal com `attempt > 1`, outbox `PUBLISHED` e dead letter;
- executa o upgrade cumulativo pelo runner;
- confirma preservação exata e `lineage_version = 0`;
- confirma que uma nova execução v1 satisfaz os invariantes;
- repete o runner e prova idempotência;
- mantém o cenário separado da base vertical F12 e garante cleanup em falha.

Os testes de rollback devem provar que a presença de lineage v1 impede o down e que o caminho permitido preserva os dados legacy.

## Alternativas rejeitadas

### Apagar ou anular `attempt` histórico

Rejeitada por perda de evidência e alteração silenciosa do significado operacional dos retries anteriores.

### Inventar lineage e digests para dados legacy

Rejeitada porque não existe informação suficiente para reconstrução verificável. Valores sintéticos apresentariam uma cadeia histórica inexistente como factual.

### Relaxar os invariantes de v1 para aceitar formas legacy

Rejeitada porque permitiria que novas execuções explorassem a compatibilidade histórica e degradaria idempotência, replay e verificabilidade.

### Remover outbox publicada ou dead letters antes do upgrade

Rejeitada por destruição de histórico e por não ser necessária para uma evolução aditiva.

## Consequências

- runtime e ferramentas de consulta precisam distinguir explicitamente v0 de v1;
- lineage histórico não fica retroativamente disponível para replay;
- a compatibilidade preserva os dados, mas não afirma que o histórico legacy possui as garantias de v1;
- futuras versões devem manter esta separação ou aprovar uma nova decisão com migration não destrutiva;
- rollout, retenção produtiva, backups e operação real permanecem fora desta decisão.

## Referências

- `backend/database/central/migrations/007_f9_execution_lineage.up.sql`
- `backend/database/central/migrations/007_f9_execution_lineage.down.sql`
- `backend/src/async/executionLineageProjection.js`
- `backend/src/async/replayService.js`
- `test/integration/f12/legacy-lineage-upgrade.js`
- `context/history/f9-async-execution-foundation.md`
- `context/features/security-privacy-and-audit-foundation.md`

## Registo de aprovação

A política foi implementada e validada durante a F12, revista humanamente e formalizada antes do arquivo da feature. Esta decisão torna durável o contrato já provado; não autoriza alterações produtivas, rollout ou perda de dados.
