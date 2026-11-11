# Trabalho Atual

## Feature e estado

- Feature: F4.1 — Diretório Central de tenants.
- Tipo: migration Central, repositórios internos e testes; sem ligações a bases tenant.
- Estado: Complete — revisão formal final concluída sem findings acionáveis; `from_state` guarda o estado de origem real e `sourceState` integra a intenção protegida pelo digest. A feature está documentalmente encerrada, sem rollout nem alteração da Central persistente.
- Base: F4.0 integrada pelo PR #10 no merge commit `8ba5348a2520c8d1250bb6b7ea9082cc80dd568e` e arquivada em `context/history/f4-tenant-contract-lifecycle.md`.
- Fonte normativa: `context/decisions/tenant-directory-and-lifecycle.md`.
- Rollout: nenhum deploy, provisioning real ou rollout de tenants está autorizado.

## Objetivo

Materializar exclusivamente na Central o diretório contratado em F4.0 e disponibilizar repositórios internos que preservem integridade relacional, histórico recuperável, idempotência e concorrência fail-closed. F4.1 não resolve credenciais, não abre pools tenant e não executa provisioning externo.

## Estado atual verificado

- A Central usa migrations SQL ordenadas `000`, `001` e `002`, declaradas em `backend/src/security/centralMigrationManifest.js` e executadas numa única transação sob advisory lock por `backend/scripts/runCentralMigrations.js`.
- O runner valida marker `C4G/CENTRAL`, ledger completo, sequência, checksums canónicos LF, flag `irreversible` e rollback apenas da migration reversível mais recente.
- O preflight executa transação read-only, exige PostgreSQL major 17 e compara fingerprint físico versionado de tabelas, colunas, constraints e índices.
- A migration `002_f3_organization_memberships` criou `organization`, `organization_membership` e o contexto organizacional de sessão. `organization.id` é a dependência Central da F4.1.
- `identityRepository` e `membershipRepository` recebem exclusivamente o pool Central, usam SQL parametrizado e devolvem modelos internos mínimos. Não existe repositório genérico nem ORM.
- Os gates F3 criam bases PostgreSQL sintéticas descartáveis, validam reconstrução/upgrade/rollback/drift/cleanup e provam recusa da Legacy.
- Não existe ainda implementação física de `central_outbox_event` ou `platform_audit_event`; F4.1 não deve materializar a outbox genérica antecipadamente.

## Invariantes de âmbito

- `organization_id`, `tenant_id`, `database_generation_id`, `database_ref` e `credential_ref` são conceitos distintos.
- `DATABASE_PER_ORGANIZATION` é o único `deployment_mode` aceite nesta fase.
- Uma organização possui no máximo um tenant e um tenant pertence imutavelmente a uma organização.
- A Central guarda apenas referências opacas; passwords, certificados, connection strings, hosts, portas e nomes físicos de base são proibidos.
- Nenhum input de cliente escolhe tenant, geração, base, credencial ou versão de ligação.
- Não existe fallback para Legacy, Central ou outro tenant.
- Todos os métodos F4.1 operam apenas sobre `CENTRAL_DATABASE_URL`; esta feature não importa nem instancia configuração de tenant ou `DATABASE_URL`.
- UBI, funções institucionais e regras do piloto não entram no diretório nem nos repositórios.
- Transições não allowlisted, estado ambíguo, revisão obsoleta e associação cruzada falham antes de mutação parcial.

## Migration Central `003_f4_tenant_directory`

### Ordem, runner e ledger

1. Criar `003_f4_tenant_directory.up.sql` e `003_f4_tenant_directory.down.sql` após `002_f3_organization_memberships`.
2. Adicionar uma única entrada ordenada ao manifest Central, inicialmente reversível apenas enquanto não existirem dados F4.1.
3. Executar o SQL canónico através do runner existente; não incluir `BEGIN`/`COMMIT` nos ficheiros SQL.
4. Preservar marker, advisory lock, ledger fail-closed, checksums LF/CRLF históricos e validação antes de qualquer DDL.
5. Atualizar o fingerprint físico e os checks locais/gates para `000/001/002/003` sem alterar a política PostgreSQL 17.
6. O rollback `003` é permitido apenas quando é a migration mais recente e todas as tabelas F4.1 estão vazias. O `down` verifica isso explicitamente, recusa perda de dados e remove objetos na ordem inversa de dependências. Depois da primeira escrita persistente, rollback lógico significa forward-fix; nunca apagar o diretório.

### Dados preexistentes

- A migration não cria tenants para organizações F3 existentes e não infere associação a partir de UBI, Legacy, domínio, slug ou sessão.
- Organizações preexistentes permanecem válidas sem tenant enquanto estiverem em onboarding/estado não elegível; criação e atribuição ocorrem apenas por comandos explícitos do repositório.
- A migration não altera memberships, sessões ou dados Legacy e não contém seed real. Fixtures e gates usam UUIDs sintéticos e `example.invalid` quando um domínio for necessário.

### Entidades e constraints

#### `tenant`

- `tenant_id UUID PRIMARY KEY` e `organization_id UUID NOT NULL UNIQUE`.
- `deployment_mode TEXT NOT NULL` com `CHECK (deployment_mode = 'DATABASE_PER_ORGANIZATION')`.
- `created_at`, `updated_at` e `revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0)`.
- FK de `organization_id` para `organization(id)` com `MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE`.
- Chave candidata `UNIQUE (tenant_id, organization_id)` para referências compostas.
- Trigger de imutabilidade impede update de `tenant_id`, `organization_id` e `deployment_mode`; não existe delete pelo repositório.

#### `tenant_database_generation`

- `database_generation_id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `database_ref TEXT NOT NULL`, `created_at` e `retired_at` opcional.
- `database_ref` não vazio e opaco; `UNIQUE (database_ref)` e `UNIQUE (tenant_id, database_generation_id, database_ref)`.
- FK para `tenant(tenant_id)` com ações restritivas e validação imediata.
- Trigger impede alterar geração, tenant ou referência; retire é monotónico (`NULL → timestamp`) e não pode ser revertido.

#### `organization_connection_version`

- PK `(tenant_id, connection_version)` com `connection_version BIGINT CHECK (connection_version > 0)`.
- Campos: `deployment_mode`, `database_generation_id`, `database_ref`, `credential_ref`, `region_code`, `residency_policy_version`, `observed_system_identifier`, `binding_digest`, `version_state`, timestamps de criação/validação/drenagem/revogação/falha e motivo sanitizado.
- `credential_ref` e `binding_digest`, quando presente, são globais e únicos; referências de texto são não vazias e nunca contêm material de ligação.
- FK composta `(tenant_id, database_generation_id, database_ref)` para a chave candidata da geração, com `MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE`.
- FK simples para tenant com ações restritivas; `deployment_mode` limitado ao modo aprovado.
- Estados: `CANDIDATE`, `VALIDATED`, `DRAINING`, `REVOKED`, `FAILED`. `CHECK`s relacionam estado e timestamps; `observed_system_identifier` e `binding_digest` são nulos em `CANDIDATE`, preenchidos em validação e imutáveis depois.
- Trigger valida allowlist `CANDIDATE → VALIDATED → DRAINING → REVOKED` e `CANDIDATE/VALIDATED → FAILED`, impede alteração das identidades/referências e rejeita `connection_version` menor ou igual ao máximo já existente para o tenant. A criação serializa por tenant para tornar a monotonicidade determinística.

#### `organization_connection`

- `tenant_id UUID PRIMARY KEY`, `current_connection_version BIGINT` opcional enquanto `PENDING`, `operational_state`, `revision BIGINT NOT NULL DEFAULT 1`, timestamps e motivo sanitizado obrigatório nas transições que o contrato exigir.
- FK simples para tenant e FK composta `(tenant_id, current_connection_version)` para a versão do mesmo tenant, ambas restritivas, `MATCH SIMPLE NOT DEFERRABLE INITIALLY IMMEDIATE`.
- Estados: `PENDING`, `AVAILABLE`, `BLOCKED`, `DRAINING`, `ARCHIVED`.
- `CHECK` exige ponteiro não nulo em `AVAILABLE/BLOCKED/DRAINING` e permite nulo apenas em `PENDING`; `ARCHIVED` preserva o último ponteiro quando exista.
- O ponteiro só pode apontar para versão `VALIDATED` no momento do cutover. Trigger aplica a allowlist normativa, incrementa `revision` exatamente uma vez por transição/cutover e proíbe alterações diretas a `tenant_id`.

#### `tenant_schema_state`

- `tenant_id UUID PRIMARY KEY/FK`, versões corrente/alvo/mínimas, `compatibility_state`, `verified_capabilities JSONB`, lock opaco opcional, `checked_at`, `updated_at`, `revision` e último erro sanitizado.
- Estados: `UNKNOWN`, `COMPATIBLE`, `READ_ONLY`, `MIGRATION_REQUIRED`, `MIGRATING`, `INCOMPATIBLE`, `FAILED`.
- `CHECK`s exigem versões/capacidades observadas apenas nos estados aplicáveis, objeto JSON e timestamps coerentes; não guardam catálogo funcional `operationCode`.
- Updates usam compare-and-swap de `revision`; tenant e observações históricas confirmadas não são transferíveis.

#### `organization_provisioning`

- `organization_id UUID PRIMARY KEY`, `tenant_id UUID` opcional, `tenant_assignment_state`, `status`, `current_step_code`, `idempotency_key TEXT NOT NULL UNIQUE`, `manifest_version`, lock opaco/expiração opcionais, `revision`, timestamps, erro sanitizado e `retry_count`.
- FK da organização e FK composta `(tenant_id, organization_id)` para `tenant(tenant_id, organization_id)` com `MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE INITIALLY IMMEDIATE`.
- `CHECK` fechado:
  - `UNASSIGNED` + `tenant_id IS NULL` apenas em `NOT_STARTED`, `QUEUED`, `RUNNING`, `FAILED`, `CANCELLED`;
  - `ASSIGNED` + `tenant_id IS NOT NULL` apenas em `QUEUED`, `RUNNING`, `VERIFYING`, `READY`, `FAILED`, `CANCELLED`.
- Trigger permite uma única alteração conjunta `UNASSIGNED/NULL → ASSIGNED/tenant_id` e rejeita remoção, retorno ou substituição.
- Allowlist de provisioning: `NOT_STARTED → QUEUED`, `QUEUED → RUNNING|CANCELLED`, `RUNNING → VERIFYING|FAILED|CANCELLED`, `VERIFYING → READY|FAILED`, `FAILED → QUEUED|CANCELLED`; `READY` e `CANCELLED` são terminais em F4.1.
- `READY` exige tenant atribuído, pelo menos uma versão validada e schema `COMPATIBLE`, verificados na mesma transação Central; não ativa a ligação. O primeiro cutover `PENDING → AVAILABLE` exige depois provisioning `READY`, schema `COMPATIBLE` e a versão selecionada `VALIDATED`.

#### `tenant_health_observation`

- PK/FK `(tenant_id, connection_version)` para a versão de ligação; apenas um snapshot por versão.
- Campos: `health_state`, `probe_type`, `observed_at`, `expires_at`, erro sanitizado e `revision`.
- Estados: `UNKNOWN`, `HEALTHY`, `DEGRADED`, `UNREACHABLE`; `expires_at > observed_at`.
- Upsert aceita apenas observação cronologicamente mais recente e compare-and-swap quando fornecido. Não cria série temporal, não altera autorização e não é escrito por requests funcionais.

#### `tenant_directory_event`

- Tabela append-only mínima de evidência F4.1: `event_id UUID PRIMARY KEY`, tenant/organização opcionais conforme o agregado, `aggregate_type`, `aggregate_id`, `action_code`, `from_state`, `to_state`, `reason_code`, `correlation_id`, `idempotency_key`, `occurred_at` e payload JSONB mínimo sem segredos.
- `UNIQUE (idempotency_key, action_code)` evita eventos duplicados da mesma operação; índices por agregado e instante suportam revisão.
- Apenas os repositórios escrevem eventos na mesma transação da mudança. Não é outbox, não tem publicação, worker ou integração externa e não substitui o histórico de versões.

### Índices mínimos

- Índices para `tenant(organization_id)`, versões por `(tenant_id, version_state, connection_version DESC)`, ligação por `operational_state`, schema por `compatibility_state`, provisioning por `status` e lock expiry, health por `health_state/expires_at`, e eventos por agregado/tempo.
- Não duplicar índices já cobertos por PK/UNIQUE sem evidência de query. O gate deve inspecionar nomes e definições no fingerprint.

## Contratos de repositório

Criar módulos Central especializados, sem método genérico de update/delete e sem aceitar pool alternativo em runtime de produção:

1. `tenantDirectoryRepository.createTenant({ organizationId, tenantId, deploymentMode, correlationId, idempotencyKey })`: transação Central, lock da organização, retorno idempotente para a mesma intenção e conflito sanitizado para identidade divergente.
2. `tenantDirectoryRepository.getTenantByOrganization(organizationId)` e `getTenant(tenantId)`: consulta exata; nunca enumera outros tenants nem devolve referências de credencial.
3. `tenantProvisioningRepository.start(...)`: cria ou retoma o workflow pela idempotency key; intenção incompatível é conflito.
4. `tenantProvisioningRepository.assignTenantOnce(...)`: bloqueia provisioning/tenant, aplica a atribuição write-once e devolve o resultado idempotente.
5. `tenantConnectionRepository.createGeneration(...)`: cria ownership físico opaco sem contacto externo e recusa reutilização cruzada.
6. `tenantConnectionRepository.createCandidateVersion(...)`: aloca a próxima versão sob lock do tenant, não muda o ponteiro e preserva retry idempotente.
7. `tenantConnectionRepository.validateVersion(...)`: preenche identidade observada/digest uma vez e transita `CANDIDATE → VALIDATED`; em F4.1 os valores são evidência sintética fornecida por um chamador interno de teste, não por probe real.
8. `tenantConnectionRepository.publishVersion({ tenantId, connectionVersion, expectedRevision, ... })`: numa transação, verifica versão `VALIDATED`, troca o ponteiro por compare-and-swap, incrementa `revision` e move a anterior para `DRAINING`; revision obsoleta não altera nada.
9. Métodos nomeados de transição para ligação, versão, provisioning e schema aplicam allowlists; não existe `setState`, patch arbitrário, delete nem SQL exposto.
10. `tenantDirectoryRepository.resolveSnapshotByOrganization(organizationId)`: uma consulta Central consistente que junta organização, tenant, provisioning, ligação, versão corrente, geração, schema e health; devolve zero ou uma linha e falha perante ambiguidade/integridade impossível. É preparação de dados para F4.2, não um `TenantResolver` e não resolve segredos.
11. `tenantSchemaRepository.recordObservation(...)`: compare-and-swap, capacidades estruturadas e erro sanitizado.
12. `tenantHealthRepository.replaceSnapshot(...)`: substitui apenas o snapshot corrente se mais recente; não acumula histórico.

Todos os métodos mutáveis usam `pool.connect()`, transação explícita, queries sequenciais no mesmo client, rollback/release fail-closed e evento na mesma transação. Erros públicos/internos não incluem SQL, refs, hosts, credenciais ou detalhes do driver.

## Concorrência e idempotência a provar

- Duas criações concorrentes para a mesma organização produzem um tenant e uma resposta idempotente/conflito determinístico.
- Provisioning concorrente com a mesma chave converge; chaves ou intenções incompatíveis não substituem o workflow.
- Duas atribuições concorrentes não removem nem trocam `tenant_id`.
- Duas versões concorrentes não reutilizam `connection_version`; uma falha transacional não deixa número ou ponteiro parcial.
- Cutover com `expectedRevision` obsoleta afeta zero linhas e não move versões.
- Geração, base ou credencial de um tenant não pode ser associada a outro.
- Updates de IDs/referências imutáveis e delete/update de pais referenciados são recusados.
- Retry após resultado incerto relê estado persistido e não presume sucesso.
- Exceção entre passos provoca rollback integral; falhas de rollback/release são agregadas e o client inválido é descartado.

## Plano de implementação

1. Adicionar testes estáticos de contrato para manifest, migration `003`, ausência de transações embebidas, marker Central, constraints, triggers e ausência de termos UBI/segredos.
2. Adicionar testes unitários dos repositórios com clients estritos, ordem de queries, parametrização, transações, CAS, sanitização e cleanup fail-closed.
3. Criar gate PostgreSQL F4.1 descartável com duas organizações sintéticas, cobrindo instalação limpa e upgrade `002 → 003`.
4. Implementar `003_f4_tenant_directory.up/down.sql`, manifest, fingerprint e checks `000/001/002/003`.
5. Implementar helper transacional comum apenas se preservar os contratos existentes e reduzir duplicação comprovada; não refatorar F2/F3 sem testes de regressão.
6. Implementar os repositórios Central especializados e eventos append-only mínimos.
7. Cobrir casos positivos, negativos, concorrência, interrupção, rollback/re-forward, ledger/checksum/drift e recusa da Legacy.
8. Aplicar `003` à Central local persistente somente depois de todos os gates descartáveis passarem e mediante autorização explícita para esse passo; nunca aplicar à Legacy.
9. Atualizar documentação apenas com factos implementados e preparar revisão formal antes de stage/commit.

## Gates de validação

- Testes unitários focados de migration, manifest, lifecycle e repositórios.
- Suite completa do backend.
- Gate PostgreSQL descartável: reconstrução `000–003`, upgrade `000–002 → 003`, forward/rollback/re-forward vazio, rollback recusado com dados e cleanup verificado.
- Casos PostgreSQL reais para PK/FK/chaves candidatas, `MATCH SIMPLE`, `RESTRICT`, `CHECK`s, triggers, imutabilidade, associações cruzadas e todas as transições.
- Concorrência real com clients separados e barreira controlada para criação, atribuição, versão e cutover.
- Preflight/fingerprint/checksum/ledger com `003`, incluindo drift físico, versão desconhecida, lacuna e checksum divergente antes de DDL.
- Prova de que Legacy recusa a migration e permanece sem marker, ledger ou tabelas F4.1.
- Prova estática e runtime de que nenhum módulo F4.1 importa `DATABASE_URL`, `legacyPool`, configuração de tenant, secret manager, `TenantResolver` ou gestor de pools tenant.
- `node --check` nos JavaScript alterados, parsing PowerShell quando aplicável, `git diff --check` e build frontend apenas se existir impacto (não previsto).
- Scan de segredos, connection strings utilizáveis, emails/dados reais, certificados, dumps, logs, builds e artefactos.
- Confirmação de zero bases descartáveis restantes e de que containers/volumes persistentes não foram destruídos.

## Critérios de aceitação

- [x] A migration `003` aplica numa Central limpa e por upgrade desde `002`, sob o runner e marker existentes.
- [x] O ledger, checksum canónico, fingerprint e preflight reconhecem exatamente `000/001/002/003` e falham fechado perante todas as classes de drift contratadas, incluindo funções de trigger e propriedades isoladas de FK.
- [x] Uma organização aceita no máximo um tenant; tenant e ownership físico não podem atravessar organizações.
- [x] Provisioning suporta criação anterior ao tenant, atribuição única e estados/nulabilidade coerentes por constraint e trigger.
- [x] Ligação corrente, gerações e versões preservam histórico recuperável; cutover é atómico por CAS e revisão monotónica.
- [x] Identidades e refs imutáveis, versões/revisions monotónicas e deletes/updates proibidos são impostos pela base, não apenas pelo repositório.
- [x] Schema state e health snapshot permanecem dimensões independentes; health não concede acesso nem cria histórico ilimitado.
- [x] Repositórios expõem apenas comandos e consultas nomeados, parametrizados, idempotentes e transacionais; `READY → AVAILABLE`, normalização temporal fechada e retornos integralmente ancorados estão provados.
- [x] Duas organizações e tenants sintéticos permanecem isolados em todos os casos positivos, negativos e concorrentes, incluindo assignment e cutovers divergentes.
- [x] Nenhum segredo, connection string, dado real, pool tenant, resolver, fallback, lógica UBI ou funcionalidade F5 é introduzido.
- [x] Rollback vazio é seguro, rollback com dados recusa perda nas oito tabelas e falha deliberada após DDL reverte integralmente.
- [x] Suite backend, gate F4.1 integral e regressão F3 descartável passam e não deixam recursos temporários.

## Correções após revisão formal

- H1: retry de `createCandidateVersion` resolve a versão exata pelo payload tipado do evento e valida um digest SHA-256 da intenção completa; gate cobre múltiplas versões e intenção divergente.
- H2: retry de `publishVersion` reconcilia ponteiro, revisão, versão publicada, versão anterior e evento antes de reconhecer sucesso; gate cobre cutover inicial e rotação sem duplicar evento/revisão.
- H3: o helper transacional separa transação iniciada, commit confirmado e cleanup; testes estritos provam ausência de rollback pós-commit e de dupla libertação.
- H4: `tenant_schema_state` aplica matriz fechada de campos por estado; repositório suporta lock de migration e gate recusa `COMPATIBLE` incompleto.
- M1: APIs públicas genéricas foram substituídas por comandos semânticos com origem/destino fixos; teste estático confirma a ausência dos nomes genéricos.
- M2: fingerprint inclui definição integral e propriedades das funções `f4_*` usadas por triggers; gate altera apenas um corpo e confirma drift.
- M3: automatizados rollback isolado das oito tabelas, 17 classes de drift físico, 11 recusas de marker/ledger/checksum, concorrência real de tenant/provisioning/assignment/version/cutover, colisões globais de evento, failure injection transacional persistida, isolamento adversarial, health cronológico, regressão F3 em runtime próprio e cleanup. A matriz integral está novamente verdadeira.

### Validação executada após correções

- Testes focados F4.1: 8/8 passaram.
- Suite backend: 143/143 passaram.
- Gate PostgreSQL 17 F4.1 descartável: passou, incluindo lifecycle base, rollback das oito tabelas, 17 drifts físicos, 8 casos ledger/checksum, concorrência/isolamento e regressão F3 própria; cleanup concluído.
- `node --check` nos JavaScript alterados/criados, parsing PowerShell, `git diff --check` e scans dirigidos: passaram.
- Central local persistente: não consultada nem alterada.

### Findings da segunda revisão formal (2026-10-06)

- High — `appendEvent()` aceita colisão global de `(idempotency_key, action_code)` com `DO NOTHING`, permitindo confirmar domínio sem evidência correspondente.
- Medium — a matriz de failure injection com clients estritos prova sequência e cleanup, mas não prova estado persistido nem retry real após rollback/commit.
- Medium — o harness `004_synthetic_later` reproduz manualmente a seleção de latest em vez de executar o algoritmo real do runner com manifest sintético.
- Medium — códigos de erro e motivos chegam aos registos/eventos sem validação contratual comum nem `CHECK` físico equivalente.

Os quatro critérios foram reabertos durante a correção e voltaram a ficar satisfeitos apenas depois da passagem integral em PostgreSQL 17 descartável.

### Fecho dos findings da segunda revisão formal

- High — eventos: cada intenção recebe digest SHA-256 sobre serialização canónica tipada; colisões globais de `(idempotency_key, action_code)` só convergem quando evento e estado de domínio provam a mesma intenção. Colisão divergente falha com erro sanitizado e rollback integral.
- Medium — estado persistido: os 75 testes históricos com clients estritos continuam limitados a sequência de queries, rollback/commit/release e sanitização. A prova de persistência é separada e executa 11 falhas diferidas depois do evento/antes do commit e 11 respostas perdidas depois de commit real, com retry por novo client sobre o mesmo estado PostgreSQL.
- Medium — runner `004`: o harness aplica e remove `004_synthetic_later` através das mesmas funções de apply/rollback do runner; a recusa de rollback de `003` é uma asserção que mata a mutação que remova a verificação de latest por posição do manifest. O entrypoint de produção permanece fechado ao manifest canónico e não aceita manifest/loader externo.
- Medium — códigos: `reasonCode`, `lastErrorCode`, motivos de failure/transição/health/schema/provisioning e `reason_code` do evento usam o mesmo formato ASCII fechado `^[A-Z][A-Z0-9_]{0,63}$`, validado antes da aquisição do client e repetido por `CHECK` físico.

### Validação final após a segunda revisão

- Testes focados F4.1: 78/78 passaram; os 75 casos com clients estritos não são apresentados como prova de persistência.
- Suite backend completa: 214/214 passou, sem falhas, skips ou TODOs.
- Gate PostgreSQL 17 integral: passou, incluindo 7 colisões cross-tenant/cross-aggregate com rollback e 1 evento órfão fail-closed antes da mutação, 66 rejeições SQL de códigos, 11 rollbacks por falha diferida no commit, 11 retries após commit com resposta perdida, concorrência real, migration sintética `004`, regressão F3 e cleanup supervisor.
- Migration `003`: checksum canónico `b4b1021f609b655167b811ad9f67b9ecf6f787133716fc3b7bc678a2f0526766`; fingerprint físico `16d2fa2bdfff11510283a8b1538bea6edb3473b4c98e905ad4931967520cf2cb`.
- `node --check`: 22 ficheiros; parsing PowerShell: 3 scripts; `git diff --check` e scans de produção de segredos/imports/conceitos proibidos: passaram.
- Inventário final: zero containers, networks ou volumes `c4g-f41-*`.
- Central persistente: não consultada nem alterada. Não houve stage, commit, push, merge, deploy, rollout ou provisioning externo.

### Evidência M3 anterior à segunda revisão

- `atomicity-matrix.js` aplica uma `004` apenas no harness, recusa rollback direto de `003`, remove `004`, confirma `003` como latest, executa rollback/re-forward de `003` e prova rollback integral perante falha deliberada depois de DDL.
- `preflight-matrix.js` cobre 17 drifts, 11 recusas de marker/ledger/checksum, marker e versão duplicados impedidos por PK, ordem física divergente normalizada pela ordem normativa de versões e mistura LF/CRLF.
- `foreign-key-matrix.js` passou 88 casos de catálogo/drift sobre as dez FKs contratadas. Dez permutações isoladas de origem/destino/ordem não são representáveis sem violar compatibilidade de tipos ou criar uma chave `UNIQUE` adicional, o que deixaria de ser mutação isolada.
- `schema-state-matrix.js` passou 10 caminhos válidos e 113 rejeições isoladas. As cinco relações de ordenação entre versões e uma relação temporal de `updated_at` não são representáveis porque o contrato trata versões como referências opacas e não define essa ordenação.
- `f4TenantFailureMatrix.test.js` enumera os 22 métodos mutáveis e prova apenas sequência de queries, falha de aquisição, rollback/commit, sanitização, descarte e release com clients estritos. Não constitui prova de estado persistido nem de retry real; essa evidência pertence à matriz PostgreSQL transacional.
- `cleanup-failure-supervisor.ps1` cria container, network, volume e base com ownership imprevisível; o child termina com exit 17 deliberado e o supervisor confirma cleanup integral.
- Gate PostgreSQL 17 F4.1 integral: passou, incluindo regressão F3 descartável e concorrência/isolamento.
- Testes F4.1 focados: 75/75 passaram. Suite backend: 210/210 passou, sem skips, falhas ou TODOs.
- `node --check` passou em 24 ficheiros JavaScript; parsing passou nos 3 scripts PowerShell; `git diff --check` passou com apenas aviso de normalização LF/CRLF.
- Scans dirigidos não encontraram chaves privadas ou credenciais reais nos artefactos F4.1. O inventário final encontrou zero containers, networks ou volumes `c4g-f41-*`.
- A Central persistente não foi consultada nem alterada; todos os casos PostgreSQL usaram `postgres:17-alpine` e recursos descartáveis do próprio run.

### Findings da terceira revisão formal (2026-10-06)

- High — `canonicalize()` tratava qualquer objeto como mapa de propriedades enumeráveis; dois `Date` distintos convergiam para `{}` e objetos fora do domínio também podiam colidir.
- Funcional — timestamps entravam no digest antes de normalização e representações equivalentes podiam produzir intenções diferentes.
- Funcional — retry de health comparava apenas estado, probe e erro, aceitando um snapshot persistido com instantes ou revisão diferentes.
- Funcional — o matching genérico não comparava o payload completo e o digest não o vinculava; payload ou digest adulterado podiam escapar à reconciliação.
- Funcional — retries concorrentes idênticos de health podiam perder a corrida do upsert e falhar apesar de domínio e evento já terem convergido.
- Funcional — o inventário de códigos não cobria `current_step_code` na aplicação/base nem todos os campos de código persistidos.
- Low — o resumo da matriz confundia sete colisões com a recusa separada de um evento órfão.

### Fecho da terceira revisão

- O canonicalizador tem domínio fechado para escalares suportados, arrays densos, objetos simples e `Date` válido; rejeita protótipos, símbolos, accessors, ciclos, arrays esparsos e tipos não suportados. Os dois `Date` da reprodução têm representações e digests distintos.
- Health e schema normalizam todos os timestamps recebidos para ISO UTC antes do digest e antes da escrita. O retry de health compara estado, probe, `observed_at`, `expires_at`, erro e revisão persistida.
- O digest do evento vincula intenção e payload canónico. Matching genérico compara o payload integral; candidate e publish validam também os payloads derivados completos e recusam payload ou digest adulterado.
- Um retry concorrente idêntico de health reconcilia novamente evento e snapshot depois de um upsert sem linha, devolvendo a mesma revisão sem duplicar mutação ou evento.
- `currentStepCode` e `probeType` são recusados antes de adquirir client. A migration aplica formato ASCII fechado a `current_step_code`, `probe_type`, `last_transition_code`, tipos/ações/estados de evento e aos códigos de erro/motivo já cobertos. A reprodução `postgresql://user:pass@host/db` falha na aplicação e por SQL direto.
- A matriz mantém arrays explícitos dos casos reais e afirma exatamente `7 collision rollbacks` e `1 orphan-event refusal`.

### Validação final após a terceira revisão

- Reproduções focadas dos findings: 6/6 passaram; testes F4.1 focados: 84/84 passaram.
- Suite backend completa: 220/220 passou, sem falhas, skips ou TODOs.
- Gate PostgreSQL 17 integral: passou; incluiu instalação/upgrade/rollback, 17 drifts físicos, 88 verificações FK, 10 caminhos e 113 recusas de schema, concorrência/isolamento, 7 collision rollbacks, 1 orphan-event refusal, 143 rejeições SQL de códigos, 11 rollbacks diferidos, 11 retries após resposta perdida, regressão F3 e cleanup deliberadamente adversarial.
- A regressão de idempotência combina os 22 métodos mutáveis enumerados na matriz estrita com retries sequenciais/concorrentes, intenção divergente, payload/digest adulterados, evento órfão, domínio sem evento/avançado e as matrizes PostgreSQL de falha antes do commit e resposta perdida; domínio, evento, revisão e retorno são comparados nos cenários persistidos aplicáveis.
- Migration `003`: checksum canónico LF `adb566c013b9314e6755d2cb868f6cc5ba64b5a0d528f8960beeb892bb9cd532`; checksum CRLF histórico derivado `33e481417216062e33a1aaf871dbfdcd764914580f040b672749af6f9262ed9f`; fingerprint PostgreSQL 17 `762b491b598719a51c8826683bb30f27ff51f6b3a342c25d9ed8dcb781327e80`.
- `node --check`, parsing PowerShell e `git diff --check` passaram. Os scans não encontraram imports/conceitos proibidos nem TODO/skips; canários de segredo existem apenas como inputs explícitos de rejeição.
- Inventário final confirmou zero recursos `c4g-f41-*`; os restantes containers, networks e volumes eram preexistentes e permaneceram intactos.
- A Central persistente não foi consultada nem alterada. Não houve stage, commit, push, merge, deploy, rollout ou provisioning externo.

### Correções após a revisão formal final

- Health retry: o evento guarda agora `resultingRevision` no payload vinculado ao digest; a reconciliação exige igualdade exata de payload, digest, timestamps, campos funcionais e revisão. Uma reprodução isolada com campos iguais e revisão divergente falha fechado.
- Binding corrente: `markVersionFailed` bloqueia primeiro `organization_connection` e recusa a versão apontada. A trigger física repete o invariant e impede `VALIDATED → FAILED` da versão corrente por SQL direto; a ordem de locks é compatível com `publishVersion`.
- Referências opacas: `databaseRef` e `credentialRef` usam o domínio fechado `^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$` antes de adquirir client e em `CHECK`s físicos. Connection strings, userinfo, paths, whitespace, control chars e excesso de comprimento são recusados.
- Regressão transversal: `transaction-state-matrix.js` contém exatamente 22 cenários persistidos, um por método mutável. Cada cenário prova rollback diferido, resposta perdida após commit, retry sequencial, retry concorrente exato, replay divergente, adulteração de payload, adulteração de digest, evento órfão e domínio sem evento sem segunda mutação; domínio, evento, revisão e retorno são comparados. A matriz de colisão mantém ainda as sete recusas cross-aggregate/cross-tenant e a recusa órfã histórica separada.
- Replays antigos passaram a exigir forma exata do domínio: criação de tenant/provisioning/assignment, candidate e schema recusam domínio avançado ou divergente em vez de reconhecer sucesso obsoleto.

### Findings reabertos pela nova revisão formal final — execução corretiva atual

- [x] Proteger integralmente, no repositório e na base, qualquer versão referenciada por `current_connection_version` contra transições de `VALIDATED` para `DRAINING`, `REVOKED`, `FAILED` ou outro estado não operacional, incluindo a corrida com cutover.
- [x] Provar nos 22 métodos mutáveis a mesma chave com intenção funcional divergente, alterando um campo pertencente a `{ intent, payload }` e preservando domínio/evento originais.
- [x] Provar nos 22 métodos o replay do evento antigo depois de avanço semanticamente válido do domínio, com resultado exato por contrato e sem reversão ou novo evento.
- [x] Substituir o pseudo-órfão por evento internamente coerente, digest recalculado e domínio correspondente deliberadamente ausente.
- [x] Fixar `domínio sem evento` como inconsistência fail-closed nos 22 métodos: conflito canónico, zero eventos novos, domínio inalterado e rollback integral.

### Fecho da nova revisão formal final

- A `003` permanece ficheiro novo neste snapshot e nunca foi aplicada à Central persistente; por isso a correção física foi incorporada nela, sem reescrever migration publicada/aplicada. A trigger bloqueia a linha `organization_connection` e impede qualquer versão corrente de abandonar `VALIDATED`.
- `changeVersionState` adquire o mesmo lock de controlo antes de consultar evento ou alterar versão. O cutover passa primeiro o ponteiro para a nova versão e só depois move a anterior para `DRAINING`, tudo na mesma transação e com rollback se qualquer passo falhar.
- Os caminhos que reconstruíam silenciosamente eventos para domínio já existente foram removidos. Domínio sem evento é agora sempre inconsistência fail-closed.
- A matriz transversal usa mutadores funcionais válidos específicos por método, mantém correlation metadata igual, prova conflito para digest divergente e deriva de arrays executados as quatro contagens de 22 casos.
- O órfão transversal conserva o evento original completo e coerente e remove apenas o domínio numa base descartável sob modo explícito de corrupção; a operação recusa, não recria domínio/evento e reverte integralmente.
- Cada cenário executa uma segunda operação válida. O replay antigo retorna exatamente o resultado original nos agregados imutáveis/terminais ou conflito canónico quando o contrato exige forma atual exata, sem reverter o estado avançado nem duplicar evento.

### Validação após o fecho da nova revisão formal final

- Testes corretivos focados: 11/11; matriz unitária mutável: 67/67; suite backend: 225/225, sem falhas, skips ou TODOs.
- Gate PostgreSQL 17 integral: passou, incluindo lifecycle/rollback/atomicidade, regressão F3, 17 drifts, 11 recusas de ledger, 88 casos FK, 10 caminhos e 113 recusas de schema, concorrência/cutover, 7 collision rollbacks, 1 orphan-event refusal histórico, 159 recusas SQL e cleanup adversarial.
- Matriz transversal: 22 métodos; 22 intenções funcionais com digest divergente diretamente provado; 15 avanços da linha-alvo e 7 avanços relacionados explicitamente classificados para alvos imutáveis/terminais; 22 recusas de evento órfão coerente; 22 recusas fail-closed de domínio sem evento.
- Migration `003`: checksum LF `4494a1250f7db9d3615440fb1d87ffe3277b1bf74bd443d9c8b73afcb263b4b6`; checksum CRLF derivado `2932a0e1ede7a3120c2707d89e0881310f47dc763cb844399bcbc3de854da819`; fingerprint PostgreSQL 17 `93343d03d6a80aa56fbccbc79f148b8616fc2351d3de97cde033b6b0c996c3c5`.
- A Central persistente não foi consultada nem alterada; não houve stage, commit, push, merge, deploy, rollout ou provisioning externo.

### Fecho dos findings da revisão integral seguinte

- O canonicalizador deixou de representar `undefined`: rejeita-o recursivamente em raiz, objetos e arrays. `recordObservation` valida `verifiedCapabilities` antes de adquirir client, evitando diferenças entre digest e JSONB (`{a:undefined}`/`{}` e `[undefined]`/`[null]`).
- A matriz reconstrói para cada método o envelope `{ intent, payload }` original, confirma igualdade com o digest persistido e exige digest diferente para a variante funcional antes de provar o conflito idempotente.
- Os avanços deixaram de ser agregados numa contagem enganadora: 15 cenários exigem `advanced.domain !== committed.domain`; os sete alvos imutáveis/terminais exigem linha-alvo estável, exatamente um evento de avanço relacionado e retorno idempotente original.
- Reproduções focadas: 13/13; suite backend: 227/227, sem falhas, skips ou TODOs.
- Gate PostgreSQL 17 integral: passou com 22 digests divergentes, 15 avanços diretos, 7 avanços relacionados, 22 órfãos coerentes, 22 recusas de domínio sem evento e cleanup total.
- A alteração é apenas de aplicação/testes/documentação: checksum LF `4494a1250f7db9d3615440fb1d87ffe3277b1bf74bd443d9c8b73afcb263b4b6`, checksum CRLF `2932a0e1ede7a3120c2707d89e0881310f47dc763cb844399bcbc3de854da819` e fingerprint PostgreSQL 17 `93343d03d6a80aa56fbccbc79f148b8616fc2351d3de97cde033b6b0c996c3c5` permanecem inalterados.

### Fecho dos findings de persistência canónica e retorno

- `verifiedCapabilities` passa por validação canónica e por round-trip JSON antes da aquisição de client. `undefined`, `Date`, `-0` e qualquer outra representação que o JSON altere são recusados; valores JSON normais preservam digest e snapshot.
- Arrays aceites têm protótipo nativo, exatamente `length` e índices próprios densos, enumeráveis e data-only; propriedades extra, símbolos e accessors são recusados sem executar getters. `Date` canónica exige protótipo `Date.prototype`, zero propriedades próprias e usa diretamente os métodos nativos.
- Cada cenário da matriz projeta o retorno para os mesmos campos consultados no domínio persistido. Retry sequencial, os dois retries concorrentes e replay após avanço relacionado são comparados diretamente com a linha/revisão confirmada na base.
- Reproduções focadas: 25/25; suite backend: 230/230, sem falhas, skips ou TODOs.
- Gate PostgreSQL 17 integral: passou, incluindo os 22 métodos mutáveis, 22 digests divergentes, 15 avanços diretos, 7 avanços relacionados, 22 órfãos coerentes, 22 recusas de domínio sem evento e cleanup total.
- Essa evidência física foi substituída pela correção normativa posterior; a identidade vigente está registada na secção seguinte.

### Validação após correção dos quatro findings da revisão formal integral

- Lifecycle: `READY` deixou de depender de uma ligação já `AVAILABLE`; exige tenant atribuído, versão `VALIDATED` e schema `COMPATIBLE`. O primeiro publish exige depois provisioning `READY` e schema `COMPATIBLE` tanto no repositório como na trigger SQL. Aplicação e SQL direto recusam ativação antecipada e preservam `PENDING`, ponteiro nulo e revisão 1.
- Timestamps: `normalizeInstant()` aceita apenas `Date.prototype` sem propriedades próprias e chama o método nativo diretamente; subclasses e accessors são recusados sem execução antes do digest/client.
- Matriz transversal: cada cenário consulta a linha de domínio completa com `SELECT *`, guarda o evento completo e compara integralmente os retornos raw; o modelo público mínimo de `createTenant` é comparado exaustivamente aos quatro campos correspondentes da linha persistida.
- Evidência documental: removida a secção obsoleta com identidades físicas concorrentes. Migration `003` vigente: checksum LF `7950816a81faa05e4d553ad048562b4d672995c861704bba74f74ef67852754d`, checksum CRLF `32deff6da2615799cb257f68f23cd0421d40f2effa6f7b650efe1452ed0d89d0`, fingerprint PostgreSQL 17 `1a774bedd5ef38ccb04ebc622b8370e8ca052893490d263a6a6321e02a620778`.
- Reproduções/testes focados: 30/30. Suite backend: 233/233, sem falhas, skips ou TODOs.
- Gate PostgreSQL 17 integral: passou lifecycle, rollback das oito tabelas, atomicidade, regressão F3, 17 drifts, 11 recusas de ledger/preflight, 88 casos FK, 10 caminhos e 113 recusas de schema, concorrência, 7 collision rollbacks, 1 orphan-event refusal, 159 recusas SQL e a matriz dos 22 métodos com 22 digests divergentes, 15 avanços diretos, 7 relacionados, 22 órfãos e 22 recusas de domínio sem evento.
- `node --check` passou em 10 ficheiros alterados; parsing de todos os scripts PowerShell F4.1 e `git diff --check` passaram. Scans não encontraram imports/conceitos proibidos, skips, TODOs ou segredos fora dos canários explícitos de rejeição.
- Inventário final: zero containers, networks ou volumes `c4g-f41-*`. Os hashes das alterações protegidas permanecem `9511ACB70F5E9F4F3C1874A1C8320D9EA3905CD5AE23350C6FC4D83B01283CD1` e `1AD2A2DDB084B6596F1DB1D9729095C26E84A0EE6D9E75FDA469620C8B9DF312`; a Central persistente não foi consultada nem alterada.

### Revalidação dos cinco findings corretivos solicitados

- A `003` continua nova e não aplicada à Central persistente neste snapshot, pelo que permanece a migration correta para a proteção física já generalizada. A prova SQL foi apertada: `VALIDATED → DRAINING|REVOKED|FAILED` da versão corrente tem de falhar especificamente com a mensagem da trigger; linha completa, ponteiro, revisão e contagem de eventos permanecem idênticos.
- A prova de repositório cobre os mesmos três métodos, confirma o lock de `organization_connection`, impede alcançar o `UPDATE` da versão e exige rollback/release. Após cutover, a versão anterior passa atomicamente a `DRAINING` e pode seguir para `REVOKED`; a corrida cutover/draining conserva apenas a ordem válida.
- A matriz PostgreSQL confirmou novamente 22 intenções funcionais divergentes com digest diferente, 15 avanços diretos, 7 avanços relacionados, 22 eventos órfãos coerentes e 22 recusas exatas de domínio sem evento. Todas preservam domínio/evento/revisão e não criam evento adicional.
- Testes focados: 30/30. Suite backend: 233/233, zero falhas, skips ou TODOs. O gate PostgreSQL 17 integral passou lifecycle, rollback, atomicidade, regressão F3, 17 drifts, 11 recusas de preflight/ledger, 88 verificações FK, 10 caminhos e 113 recusas de schema, concorrência/cutover, 7 collision rollbacks, 1 orphan-event refusal, 159 recusas SQL e cleanup adversarial.
- A primeira execução integral encontrou um `57P01` transitório no encerramento de uma base descartável da matriz de preflight; não houve falha funcional nem recurso residual. Uma execução integral nova concluiu com sucesso e cleanup total.
- A migration não mudou nesta ação: checksum LF `7950816a81faa05e4d553ad048562b4d672995c861704bba74f74ef67852754d`, checksum CRLF `32deff6da2615799cb257f68f23cd0421d40f2effa6f7b650efe1452ed0d89d0` e fingerprint PostgreSQL 17 `1a774bedd5ef38ccb04ebc622b8370e8ca052893490d263a6a6321e02a620778` permanecem vigentes.
- `node --check`, parsing PowerShell, `git diff --check` e scans de segredos/skips/TODO/assertions permissivas passaram. Inventário final: zero containers, networks ou volumes `c4g-f41-*`.

### Findings da revisão formal integral reabertos — execução corretiva atual

- [x] Exigir nova verificação material no retorno `BLOCKED → AVAILABLE`, com binding corrente `VALIDATED`, provisioning `READY`, schema `COMPATIBLE`, revisão monotónica e proteção equivalente por SQL direto.
- [x] Materializar corretamente o draining contratual: aceitar `PENDING/AVAILABLE/BLOCKED → DRAINING` apenas para organização `TERMINATING`, incluindo o caso sem versão corrente, e preservar a invariância do ponteiro.
- [x] Validar `migration_lock_ref` e `organization_provisioning.lock_ref` como referências opacas antes da aquisição de client e através de constraints físicas.
- [x] Rejeitar objetos `Proxy` sem executar traps durante canonicalização ou validação de round-trip JSON.

### Fecho dos quatro findings da revisão formal integral

- Recuperação: `restoreConnection` exige uma versão `VALIDATED` nova e monotonicamente superior, provisioning `READY`, schema `COMPATIBLE`, CAS da revisão e cutover atómico; a versão anterior só passa a `DRAINING` depois da troca do ponteiro. Retry reconcilia o payload e digest persistidos sem reconstruir o ponteiro anterior a partir do estado já avançado. A trigger aplica os mesmos gates a SQL direto e recusa reativação sobre a mesma versão.
- Draining: aplicação e trigger exigem `organization.status='TERMINATING'` para `PENDING/AVAILABLE/BLOCKED → DRAINING`. O `CHECK` aceita `DRAINING` sem ponteiro quando a origem é `PENDING` e preserva o ponteiro quando já existe. As recusas preservam linha, revisão e eventos.
- Referências opacas: `migrationLockRef` passa por `requireOpaqueRef` antes de `pool.connect()`; `tenant_schema_state.migration_lock_ref` e `organization_provisioning.lock_ref` usam na base o mesmo domínio fechado das restantes refs. A matriz SQL recusa connection strings, paths, userinfo, whitespace, control chars, vazio e excesso de comprimento.
- Canonicalização: `canonicalize` usa `util.types.isProxy` antes de qualquer inspeção/leitura do objeto. `Proxy` é recusado tanto diretamente como no round-trip JSON, com zero execução de traps.

### Validação após o fecho dos quatro findings

- Reproduções corretivas: 6/6; testes F4 focados: 103/103; suite backend: 239/239, sem falhas, skips ou TODOs.
- Gate PostgreSQL 17 integral: passou lifecycle, rollback das oito tabelas, atomicidade, regressão F3, 17 drifts, 11 recusas de ledger/preflight, 88 casos FK, 10 caminhos e 113 recusas de schema, concorrência, lifecycle corretivo, 7 collision rollbacks, 1 orphan-event refusal, 175 recusas SQL e a matriz dos 22 métodos com 22 digests divergentes, 15 avanços diretos, 7 relacionados, 22 órfãos coerentes e 22 recusas de domínio sem evento. Cleanup adversarial concluiu sem recursos residuais.
- Migration `003`: checksum LF `be8ed73d540b00d38e72a802ace6f2b4ddec8f72697112a66767a3eef0f79ed8`, checksum CRLF `7a7aa74725507137f54831fcbd65ca286aa2256ead74e5505277f7fa235adc29` e fingerprint derivado de PostgreSQL 17 `757d94e4946943942cc1c9562ba0f3d34bea3af36861c69a456767896c7673e2`.
- `node --check` passou nos nove JavaScript alterados desta ação; parsing de todos os scripts PowerShell F4.1 e `git diff --check` passaram. Scans não encontraram imports proibidos, credenciais, certificados, skips, TODOs ou assertions permissivas nos testes corretivos; connection strings permanecem apenas como canários explícitos de rejeição ou URL efémera do gate descartável.
- Inventário final: zero containers, networks ou volumes `c4g-f41-*`. Os hashes protegidos permanecem `.vscode/settings.json` `9511ACB70F5E9F4F3C1874A1C8320D9EA3905CD5AE23350C6FC4D83B01283CD1` e `context/ai-interaction.md` `1AD2A2DDB084B6596F1DB1D9729095C26E84A0EE6D9E75FDA469620C8B9DF312`; a Central persistente não foi consultada nem alterada.

### Correção da proveniência de `from_state` após revisão formal final

- `changeConnectionState`, `changeVersionState` e `changeStatus` bloqueiam e leem agora o agregado antes da mutação, validam o estado concreto contra a allowlist e persistem esse estado concreto no evento; a allowlist permanece apenas na intenção idempotente e na validação da transição.
- Replays obtêm o `from_state` do evento persistido, exigem que pertença à allowlist original e voltam a validar integralmente digest, payload, metadata e forma atual do domínio antes de reconhecer sucesso.
- Os updates mantêm compare-and-swap por estado concreto e revisão quando aplicável. Mutação principal e evento continuam na mesma transação Central.
- A matriz PostgreSQL prova origem `PENDING` para draining, `CANDIDATE` e `VALIDATED` para falha de versão, e `RUNNING` e `VERIFYING` para falha de provisioning.
- Suite backend: 239/239 passou, sem falhas, skips ou TODOs. Gate PostgreSQL 17 integral passou, incluindo regressão F3, rollback/atomicidade, drift/FKs/schema, concorrência, lifecycle, colisões, 175 recusas SQL, matriz transacional dos 22 métodos e cleanup adversarial.
- A migration `003` não mudou. A Central persistente não foi consultada nem alterada; não houve commit, merge, push, deploy, rollout ou provisioning externo.

### Proteção do estado de origem no digest

- As intenções de `changeConnectionState`, `changeVersionState` e `changeStatus` incluem agora `sourceState`, além da allowlist. O digest liga assim o estado concreto ao evento append-only.
- No replay, alterar apenas `from_state` para outra origem permitida muda a intenção reconstruída e deixa de coincidir com o digest persistido; a operação falha antes de qualquer mutação.
- A matriz PostgreSQL adultera isoladamente quatro eventos com múltiplas origens admitidas: `RUNNING → VERIFYING`, `QUEUED → RUNNING`, `AVAILABLE → BLOCKED` e `VALIDATED → CANDIDATE`. Os quatro replays são recusados e domínio, revisão e evento permanecem inalterados após restauração.
- Suite backend: 239/239 passou. Gate PostgreSQL 17 integral passou com 22 métodos mutáveis, 22 digests funcionais divergentes, quatro recusas de adulteração de origem, 15 avanços diretos, sete relacionados, 22 órfãos coerentes e 22 recusas de domínio sem evento; cleanup total.
- A migration `003` não mudou. A Central persistente não foi consultada nem alterada; não houve commit, merge, push, deploy, rollout ou provisioning externo.

## Fecho final da F4.1

### Veredicto

- `ready to close`.
- Nenhum finding acionável permaneceu após a revisão formal final read-only.
- Todos os critérios de aceitação da F4.1 estão satisfeitos no âmbito documentalmente contratado.

### Resultado entregue

- Migration Central `003_f4_tenant_directory` reversível apenas enquanto vazia, integrada no manifest, ledger, checksum, fingerprint e preflight PostgreSQL 17 existentes.
- Diretório Central com tenant, gerações físicas opacas, versões de ligação, controlo corrente, estado de schema, provisioning, health snapshot e evidência append-only.
- Repositórios Central especializados com transações explícitas, queries parametrizadas, locks/CAS, idempotência, concorrência fail-closed, sanitização e evento atómico.
- Isolamento entre organizações, ownership físico, imutabilidade, transições allowlisted, cutover, draining, rollback protegido e ausência de fallback demonstrados por testes automatizados.
- `from_state` conserva a origem persistida real; `sourceState` liga essa origem ao digest. Replays validam allowlist, estado concreto, digest, metadata e domínio atual, e recusam as quatro substituições entre origens igualmente permitidas.

### Validação final registada

- Testes focados: 90/90 passaram.
- Suite backend mais recente: 239/239 passou, sem falhas, skips ou TODOs.
- Gate PostgreSQL 17 mais recente: passou integralmente, incluindo lifecycle, rollback das oito tabelas, atomicidade, regressão F3, drift, ledger/preflight, FKs, schema, concorrência, colisões, recusas SQL, matriz transacional dos 22 métodos, quatro adulterações de origem recusadas e cleanup adversarial.
- `git diff --check` passou.
- A revisão formal final não alterou ficheiros.
- A Central persistente permaneceu intocada.

### Decisões preservadas

- `organization_id`, `tenant_id`, `database_generation_id`, `database_ref` e `credential_ref` permanecem identidades distintas.
- `DATABASE_PER_ORGANIZATION` é o único modo materializado nesta fase.
- A Central guarda apenas referências opacas; F4.1 não resolve segredos nem abre ligações tenant.
- O lifecycle conserva dimensões independentes para contrato da organização, ligação, provisioning, schema e health.
- Eventos F4.1 são evidência append-only mínima e não constituem outbox ou event bus genérico.
- Histórico e dados são preservados; rollback com dados é recusado e correções posteriores são forward-fix.

### Limitações e trabalho futuro

- F4.1 não inclui `TenantResolver`, secret manager, leases ou gestor de pools.
- F4.1 não liga nem migra bases tenant, não executa probes reais e não implementa provisioning ou onboarding/offboarding externos.
- F4.1 não implementa o catálogo de operações `READ_ONLY`, outbox genérica, worker, autorização funcional, frontend ou adaptação da UBI.
- Secret manager, sizing operacional, regiões, RPO/RTO, backup/restore, políticas jurídicas e orquestração continuam sujeitos aos gates já registados na arquitetura e decisão normativa.
- Nenhum deploy, provisioning real ou rollout de tenants está autorizado por este fecho.

## Decisões humanas pendentes

Nenhuma decisão humana bloqueia a implementação da F4.1 documentalmente contratada. Permanecem deliberadamente adiadas:

1. Secret manager e sizing operacional — bloqueiam F4.2 operacional, não F4.1.
2. Região/cloud concretas, provisioning orchestrator, RPO/RTO, backup/restore e políticas jurídicas — bloqueiam F4.4 real.
3. Catálogo de operações `READ_ONLY` — deve ser aprovado em F4.3 antes de uso; F4.1 apenas persiste compatibilidade física.
4. Outbox/event bus central genérico — feature posterior; F4.1 usa somente evidência append-only local e mínima.
5. Rollout de produção — continua não autorizado.

## Riscos

- Constraints insuficientes permitiriam associação cruzada mesmo com repositório correto; por isso os gates exercitam SQL direto adversarial.
- Triggers excessivamente permissivas ou recursivas podem quebrar idempotência; cada transição e update imutável terá caso PostgreSQL real.
- Alocação de versões por `MAX()+1` sem lock cria colisões; a implementação deve serializar por tenant e testar concorrência real.
- Fingerprint depende do catálogo PostgreSQL 17; qualquer alteração física exige novo fingerprint derivado pelo gate, nunca valor inventado.
- Rollback destrutivo após dados seria incompatível com preservação histórica; o `down` deve recusar tabelas não vazias.
- Um snapshot de resolução demasiado amplo pode vazar referências; o contrato interno separará consulta operacional de qualquer payload HTTP/log.

## Fora do âmbito

- `TenantResolver`, leases e gestor de pools;
- secret manager real ou resolução de `credential_ref`;
- ligação, marker ou migrations de bases tenant;
- provisioning/orquestração externos, Neon ou outros serviços;
- onboarding/offboarding operacional, backups, restore, retenção e eliminação;
- adaptação ou alteração da Legacy/UBI;
- frontend e endpoints públicos;
- autorização funcional F5, branding, SSO, quotas ou licenciamento;
- staging, produção, rollout e deploy.

## Ficheiros previstos para implementação

- `backend/database/central/migrations/003_f4_tenant_directory.up.sql`
- `backend/database/central/migrations/003_f4_tenant_directory.down.sql`
- `backend/src/security/centralMigrationManifest.js`
- `backend/src/security/centralSchemaManifest.js` apenas se o fingerprint não continuar totalmente derivado do manifest
- novos repositórios especializados sob `backend/src/security/`
- testes focados sob `backend/test/`
- gate descartável versionado sob `test/integration/f4/`
- checks locais estritamente necessários para `000/001/002/003`
- `context/current-work.md` apenas para registar factos implementados

## Referências

- `context/decisions/tenant-directory-and-lifecycle.md`
- `context/architecture.md`
- `context/references/logical-data-dictionary.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f3-membership-session-context.md`
- `backend/src/security/centralMigrationManifest.js`
- `backend/src/security/centralSchemaManifest.js`
- `backend/scripts/runCentralMigrations.js`
- `backend/src/security/membershipRepository.js`
- `test/integration/f3/migration002-gate.js`
- `test/integration/f3/central-preflight-gate.js`

Next step: executar a revisão formal final read-only da F4.1.
