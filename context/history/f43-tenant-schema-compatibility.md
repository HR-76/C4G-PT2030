# Trabalho Atual

## Identificação

- Feature: F4.3 — Schema, migrations, compatibilidade e preflight tenant
- Tipo: Feature de infraestrutura, segurança e operação multi-tenant
- Estado: Complete

## Objetivo

Definir e implementar, primeiro em ambiente local descartável e com dados sintéticos, o contrato físico de uma base tenant C4G: identidade inequívoca, baseline e ledger de migrations, manifest versionado, verificação de integridade, matriz de compatibilidade declarada por release, preflight fail-closed e execução controlada de migrations. A F4.3 deve alimentar o estado observado da Central sem o tratar como substituto da verificação física e deve permitir acesso `READ_ONLY` apenas a operações explicitamente aprovadas no catálogo da release.

Este contexto contém as decisões normativas e o plano técnico necessários para iniciar a implementação local da F4.3. A promoção para `Ready` não autoriza execução de migrations em bases persistentes, acesso à Central ou a tenants reais, provisioning, rollout, deploy ou início da F4.4, F4.5 ou F5.

## Resultado esperado

- Cada base tenant possui marker próprio, identidade lógica e geração verificáveis antes de qualquer leitura funcional ou migration.
- Um manifest imutável e ordenado associa cada versão tenant ao SQL autorizado, checksum, reversibilidade, fingerprint físico, capacidades produzidas e contrato de compatibilidade.
- O ledger local prova sequência, integridade e resultado das migrations; a Central conserva apenas a observação sanitizada necessária à orquestração.
- O preflight compara marker, geração, ledger, checksums, versão, fingerprint, capacidades e contrato da release, recusando drift, lacunas ou estado desconhecido.
- A classificação `COMPATIBLE`, `READ_ONLY`, `MIGRATION_REQUIRED`, `INCOMPATIBLE` ou `FAILED` é derivada de evidência física e de uma matriz declarada, nunca de proximidade numérica.
- Migrations usam lock exclusivo, preflight, timeout, transação quando tecnicamente possível, verificação posterior e cleanup observável.
- `READ_ONLY` permanece deny-by-default e só admite operações presentes no catálogo inicial aprovado, com query module registado, testes próprios e transação PostgreSQL efetivamente read-only.
- Toda a prova desta feature usa exclusivamente PostgreSQL descartável, identidades sintéticas e adaptadores injetados.

## Critérios de aceitação

1. Um baseline tenant novo cria apenas os objetos contratados, grava marker `C4G/TENANT`, identidade/generation esperadas e um ledger íntegro, sem conceitos UBI ou dados reais.
2. Marker ausente, papel de base divergente, `tenant_id` ou generation divergentes e identidade ambígua falham antes de migration ou query funcional.
3. O manifest é fechado, ordenado e imutável; versões, checksums, fingerprints, capacidades e contratos duplicados, ausentes ou incoerentes impedem startup ou execução.
4. O ledger recusa versões desconhecidas, lacunas, reordenação, checksum alterado, metadata divergente e histórico incompatível sem reescrever registos aplicados.
5. O preflight valida integralmente marker, ledger, versão, fingerprint e capacidades e produz apenas um resultado sanitizado, determinístico e allowlisted.
6. A compatibilidade é calculada a partir do contrato explícito da release, distinguindo leitura e escrita; não é inferida por `N`, `N-1` ou comparação lexical/numérica.
7. Apenas `COMPATIBLE` admite o conjunto normal de operações de leitura e escrita; estados desconhecidos, inválidos ou em transição falham fechado.
8. O catálogo produtivo inicial `tenant-read-only-bootstrap-v1` é explicitamente vazio e qualquer operação funcional em `READ_ONLY` falha antes da aquisição; futuras entradas exigem módulo, versões, capabilities, autorização, limites e testes coincidentes.
9. O mecanismo `READ_ONLY` é provado com módulo exclusivamente sintético: inicia uma transação PostgreSQL read-only antes do primeiro SQL e demonstra que DML, DDL, locks de escrita e efeitos persistentes são recusados, sem criar uma operação produtiva.
10. A execução de migrations adquire lock exclusivo verificável, repete o preflight sob lock, aplica apenas a sequência autorizada e publica sucesso só depois do post-check físico completo.
11. Concorrência, lock ocupado/expirado, timeout, falha de SQL, falha de commit e falha de cleanup preservam a causa primária, deixam estado reconciliável e nunca produzem sucesso aparente.
12. Rollback só é permitido quando explicitamente declarado seguro, para a versão elegível mais recente e sem perda de dados; os restantes casos exigem forward-fix.
13. A observação Central usa CAS/idempotência, códigos sanitizados e referências opacas; nunca persiste SQL, DSN, host, base física, credenciais, stack ou mensagem externa.
14. Divergência entre a observação Central e a base tenant não concede acesso; a evidência física corrente prevalece e provoca reconciliação ou recusa.
15. Gates automatizados em PostgreSQL descartável cobrem instalação limpa, upgrade, drift, corrupção do ledger, concorrência, timeout, compatibilidade e catálogo `READ_ONLY`, com cleanup integral.
16. Nenhuma validação usa Central persistente, tenant real, secret manager real, Legacy/UBI, serviço externo, provisioning, rollout ou deploy.

## Decisões normativas já aprovadas

- `DATABASE_PER_ORGANIZATION` é o único modo suportado no MVP; cada organização elegível resolve para um tenant explícito.
- Membership e contexto F3 continuam a ser a fonte de verdade do acesso; compatibilidade de schema não concede autorização funcional.
- A base tenant mantém marker, ledger, versão e evidência física próprios. `tenant_schema_state` na Central é uma observação operacional, não prova substitutiva.
- O catálogo versionado da release associa `operationCode` a modo, requisitos de schema/capacidades, elegibilidade `READ_ONLY`, query module e testes.
- `READ_ONLY` é deny-by-default, exige `BEGIN READ ONLY` antes do SQL do módulo e não admite operações com efeitos.
- Compatibilidade de leitura e escrita é declarada por release; durante rollout pode existir suporte temporário a `N-1`, mas nunca inferido pela versão.
- Releases seguem `expand → migrate → contract`; writes incompatíveis são bloqueados e falhas de migration produzem modo restrito controlado.
- Migrations exigem lock, preflight, timeout, verificação posterior, integridade por checksum/fingerprint e recuperação explícita.
- Erros e observabilidade expõem apenas códigos e contagens de cardinalidade limitada; referências e detalhes físicos permanecem privados.
- A F4.3 pode ser provada com PostgreSQL descartável e material sintético. Operação real continua sem autorização.

## Decisões D1/D2 confirmadas

### D1 — Baseline físico tenant

A F4.3 adota um baseline exclusivamente de controlo, identificado por `000_tenant_control_baseline`. O baseline reserva os schemas `c4g_system` e `c4g_app`, mantém `c4g_app` vazio e cria apenas um marker singleton de identidade e um ledger append-only de migrations. Não inclui tabelas funcionais, dados iniciais ou conceitos UBI/Legacy.

O marker fixa `C4G/TENANT`, `marker_format_version = 1`, `tenant_id`, `database_generation_id`, `identity_revision = 1` e o instante UTC de criação. O ledger fixa identificador estável, ordinal estritamente crescente, checksum SHA-256 canónico, irreversibilidade, instante UTC de aplicação e fingerprint físico resultante. A versão corrente deriva do ledger; a revisão conservada na Central continua a ser uma revisão de observação e orquestração.

A base usa PostgreSQL 17, encoding UTF-8, timezone UTC e collation ICU determinística com locale raiz `und`. A allowlist inicial de extensões é vazia. Schemas e objetos pertencem a uma role owner sem login; migration e runtime usam principals separados. O runtime não possui ownership, DDL, gestão de roles, criação de extensões, `CREATE` em schemas ou `TEMP`. O `search_path` de runtime é fixo em `pg_catalog, c4g_app`, sem confiar em `public`, e migrations e queries internas qualificam explicitamente os schemas.

A associação à organização permanece exclusivamente na Central. A identidade física resulta de tenant, generation, marker e evidência observada; o binding digest permanece na Central. Restore ou clone exige nova generation e rebinding controlado pela F4.4. O baseline é irreversível fora de bases descartáveis.

### D2 — Catálogo inicial `READ_ONLY`

A release adota o catálogo produtivo `tenant-read-only-bootstrap-v1` com `operations: []`.

Nenhuma query do piloto UBI é admitida. Não existe ainda schema tenant funcional, query module produtivo ou autorização F5 suficiente para expor dados em segurança. Consequentemente, um tenant em `READ_ONLY` recusa todas as operações funcionais de forma sanitizada e fail-closed, antes da aquisição de credenciais, pool ou lease.

O mecanismo de catálogo e transação PostgreSQL read-only será provado com módulos exclusivamente sintéticos nos testes. Isso não cria uma operação produtiva nem concede autorização funcional. Entradas futuras exigem código estável, query module interno, versões de schema explicitamente compatíveis, capabilities, modos, schemas fechados de input e resultado, permissão F5, limites, timeout e testes próprios. SQL, identifiers, tabelas e fragments fornecidos pelo caller permanecem proibidos.

## Matriz inicial de compatibilidade

- Release F4.3 / schema `000_tenant_control_baseline`: `COMPATIBLE` apenas para operações internas de controlo.
- Catálogo funcional `READ_ONLY`: `tenant-read-only-bootstrap-v1`, com zero operações.
- Versão `N-1`: deliberadamente inexistente no primeiro ciclo.
- Compatibilidade: declarada pela release e nunca inferida por comparação lexical, numérica ou proximidade de versões.
- Marker, generation, ledger, checksum, fingerprint, capabilities, configuração física ou binding desconhecidos, ausentes ou divergentes: fail-closed.
- Mudança de schema, revisão ou connection version durante aquisição: invalida o resultado anterior e exige retry integral ou recusa antes de SQL.

## Seleções técnicas resolvidas para a implementação local

- Migrations tenant usam identificador ordenado e estável, SQL UTF-8 com finais LF e checksum SHA-256 canónico. Uma migration aplicada é imutável; evolução posterior usa uma nova versão.
- O manifest é fechado e imutável e associa versão, migration, checksum, irreversibilidade, fingerprint, capabilities e contratos explícitos de leitura/escrita.
- O fingerprint cobre a estrutura contratada; preflight valida também, de forma explícita, marker, ledger, owners, grants, extensões, encoding, collation e timezone.
- O runner usa um advisory lock tenant de domínio fixo, isolado na própria base. Timeouts e relógios são injetáveis nos testes; valores de produção continuam fora do âmbito.
- Resultado incerto nunca é convertido em sucesso: exige novo preflight físico e reconciliação idempotente.
- O preflight produz evidência sanitizada; o runner aplica migrations; a publicação na Central só ocorre depois do post-check completo e usa CAS/idempotência através do repositório F4.1.
- Startup valida manifest, matriz e catálogo integralmente. Cada validação de connection version executa preflight físico completo; cada aquisição volta a confirmar a evidência e o binding correntes antes da query.
- Valores de fornecedor, sizing, concorrência, RPO/RTO, backups, retenção e operação real permanecem adiados e não são necessários para a prova local descartável.

## Plano técnico aprovado

1. Criar as migrations tenant sob `backend/database/tenant/migrations/`, separadas das migrations Central e Legacy, contendo exclusivamente schemas, marker e ledger do baseline aprovado.
2. Criar módulos tenant próprios para manifest, fingerprint, preflight e runner em `backend/src/security/`, reutilizando apenas os padrões seguros já demonstrados pelos equivalentes Central.
3. Validar atomicamente no startup ordem, unicidade, checksums, fingerprints, capabilities, irreversibilidade, contratos de compatibilidade e catálogo bootstrap vazio.
4. Implementar introspeção e preflight físico para marker, generation, ledger, versão, fingerprint, configuração, owners, grants e extensões, com resultado determinístico, imutável, sanitizado e allowlisted.
5. Implementar o runner sob advisory lock com preflight repetido sob lock, timeout injetável, aplicação exclusivamente ordenada, post-check integral, cleanup observável e reconciliação por novo preflight após resultado incerto.
6. Projetar a evidência física confirmada para `tenant_schema_state` através de `backend/src/security/tenantSchemaRepository.js`, usando CAS, idempotência, referências opacas e códigos sanitizados, sem tornar a Central autoridade sobre o estado físico.
7. Evoluir `backend/src/security/tenantOperationCatalog.js` e o resolver F4.2 para validarem versão do catálogo, requisitos de schema, matriz de versões, capabilities e elegibilidade `READ_ONLY`, preservando o catálogo produtivo vazio.
8. Adaptar `backend/src/security/tenantLeaseExecutor.js` para iniciar uma transação PostgreSQL realmente read-only antes do primeiro SQL de qualquer módulo elegível e observar integralmente conclusão, rollback e cleanup.
9. Adicionar testes unitários F4.3 e fixtures sintéticas em `backend/test/`, incluindo validação de startup, catálogo vazio, operação desconhecida, transação read-only e alterações de versão durante aquisição.
10. Adicionar um gate PostgreSQL 17 descartável para instalação limpa, ledger, drift, corrupção, locks, timeout, falhas, post-check, reconciliação, ausência de extensões, roles mínimas, UTF-8, UTC, ICU `und` e cleanup integral.
11. Executar `node --check` nos ficheiros JavaScript alterados, testes focados F4.3, regressão F4.1/F4.2 afetada, suite backend, gate PostgreSQL 17 descartável e `git diff --check`.
12. Executar revisão formal contra os 16 critérios antes de autorizar fecho, commit ou integração.

## Fora do âmbito

- Integração com secret manager, credenciais, bases tenant ou Central persistentes.
- Provisioning, onboarding, offboarding, health operacional e reconciliação de fleet da F4.4.
- Adaptação ou migração do piloto UBI/Legacy da F4.5.
- Autorização funcional F5, endpoints públicos, frontend ou alterações de produto.
- Valores de produção para regiões, pools, timeouts, concorrência, RPO/RTO, backups e retenção.
- Execução de migrations, rollout, deploy ou ativação de tenants reais.

## Dependências e referências

- `context/architecture.md`
- `context/decisions/tenant-directory-and-lifecycle.md`
- `context/decisions/future-data-model.md`
- `context/coding-standards.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-runtime-access.md`
- `backend/src/security/tenantOperationCatalog.js`
- `backend/src/security/tenantRuntime.js`
- `backend/src/security/tenantSchemaRepository.js`
- `backend/src/security/centralMigrationManifest.js`
- `backend/src/security/centralMigrationPreflight.js`

## Fecho final da F4.3

### Estado e veredicto

- Estado: `Complete`.
- Veredicto formal: `ready to close`.
- A revisão adversarial final confirmou os 16 critérios de aceitação sem findings acionáveis remanescentes.
- O resultado permanece limitado a implementação local, módulos sintéticos e PostgreSQL 17 comprovadamente descartável.

### Resultado entregue

- Baseline físico exclusivamente de controlo `000_tenant_control_baseline`, com schemas `c4g_system` e `c4g_app`, marker singleton imutável e ledger append-only, sem tabelas funcionais.
- Manifest imutável com checksum canónico fixado, fingerprint físico, irreversibilidade, capabilities e matriz explícita contendo apenas a versão baseline.
- Preflight fail-closed para identidade, generation, ledger, configuração PostgreSQL 17, schemas, owners, grants, extensões, collation ICU `und`, timezone UTC e fingerprint.
- Runner sob advisory lock, com preflight sob lock, deadlines injetáveis, aplicação ordenada, post-check físico, reconciliação de resultado incerto e publicação Central por CAS/idempotência apenas depois do post-check.
- Catálogo produtivo `tenant-read-only-bootstrap-v1` com `operations: []`; qualquer operação funcional desconhecida falha antes de credenciais, pool ou lease.
- Contrato futuro de operações versionado e fechado, provado somente com módulos sintéticos em transação PostgreSQL realmente read-only, limites, validação, fencing e cleanup observável.
- Baseline irreversível fora de bases descartáveis; marker e ledger recusam update, delete, duplicação, lacunas, reordenação e truncate.

### Revisão dos critérios

1. Baseline limpo e exclusivamente de controlo: satisfeito por SQL, manifest e gate PostgreSQL.
2. Marker, papel, tenant, generation e ambiguidade: satisfeitos por preflight fail-closed e probes negativos.
3. Manifest fechado, ordenado, imutável e coerente: satisfeito, incluindo checksum SQL fixado e fingerprint único.
4. Ledger íntegro e append-only: satisfeito para versões, ordem, lacunas, checksum, metadata, update, delete e truncate.
5. Preflight integral e sanitizado: satisfeito por introspeção física e resultado allowlisted.
6. Compatibilidade exclusivamente declarativa: satisfeito; não existe inferência numérica, lexical ou `N-1`.
7. Estados desconhecidos ou incompatíveis: satisfeitos por recusa fail-closed no resolver e executor.
8. Catálogo produtivo bootstrap vazio: satisfeito; recusa ocorre antes de qualquer aquisição.
9. Mecanismo `READ_ONLY` sintético: satisfeito por `BEGIN TRANSACTION READ ONLY`, DML/DDL/write-lock recusados, commit/rollback e cleanup observados.
10. Runner com lock, preflight e post-check: satisfeito; publicação acontece apenas após verificação física completa.
11. Concorrência, timeout, SQL, commit e cleanup: satisfeitos sem sucesso aparente; falhas de rollback/release são sanitizadas e agregadas.
12. Rollback de schema: satisfeito por baseline explicitamente irreversível e down migration não destrutiva.
13. Observação Central: satisfeita por projeção sanitizada, CAS e idempotência, sem infraestrutura ou mensagens externas.
14. Evidência física prevalece sobre observação Central: satisfeita por preflight corrente e reconciliação obrigatória.
15. Gates descartáveis: satisfeitos para instalação, replay, drift, corrupção, privilégios, extensões, lock, timeout, read-only e cleanup.
16. Isolamento operacional: satisfeito; nenhuma Central persistente, tenant real, secret manager, Legacy/UBI, provisioning, rollout ou deploy foi usado.

### Findings encontrados e corrigidos durante a revisão

- Falhas de rollback e release no preflight/runner deixaram de ser absorvidas; são sanitizadas, agregadas e impedem publicação ou sucesso aparente.
- O checksum autorizado do SQL passou a estar fixado no manifest, impedindo aceitação silenciosa de alteração do source.
- O gate PostgreSQL passou a provar timeout físico durante a migration e ausência de publicação/estado parcial.
- Marker e ledger passaram a recusar também `TRUNCATE`; checksum e fingerprint foram recalculados em PostgreSQL 17 descartável.

### Validação final

- Testes focados F4.3: 19/19 passaram.
- Suite backend completa: 345/345 passou, sem falhas, cancelamentos, skips ou TODOs.
- Regressões F4.1/F4.2 afetadas: 217/217 passaram.
- Gate PostgreSQL 17 descartável: passou integralmente; o alvo sintético foi verificado e removido no fim.
- `node --check`: passou nos 18 ficheiros JavaScript relevantes.
- `git diff --check`, UTF-8 sem BOM, terminação final, scans de segredos, testes ignorados e artefactos gerados: passaram.

### Decisões e limitações preservadas

- D1 e D2 permanecem normativas sem extensão de âmbito.
- A versão inicial não oferece `N-1`; apenas `000_tenant_control_baseline` é compatível.
- O catálogo produtivo continua vazio e não existe endpoint, query funcional ou fallback Legacy/UBI.
- Roles, criação de base, provider ICU e propriedades de cluster permanecem precondições contratuais; a F4.3 não é um provisioner.
- Secret manager, bases persistentes, restore/rebinding operacional, fleet management, rollout e deploy permanecem fora do âmbito.
- F4.4, F4.5 e F5 não foram iniciadas nem autorizadas por este fecho.
