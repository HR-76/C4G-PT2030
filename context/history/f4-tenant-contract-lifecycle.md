# Trabalho Atual

> **Nota de arquivo:** Este documento é um snapshot histórico do encerramento da F4.0. As indicações “Permitido” e quaisquer referências a autorização para planear ou implementar fases seguintes registam apenas o estado e as decisões existentes naquele momento. Este arquivo não constitui autorização atual para iniciar F4.1, F4.2 ou qualquer outra feature, nem para executar migrations, provisioning, rollout ou alterações em ambientes persistentes. Qualquer trabalho posterior exige contexto ativo e autorização explícita próprios.

## Feature e estado

- Feature: F4.0 — Contrato do diretório e ciclo de vida de tenants.
- Tipo: documentação e decisão arquitetural; não inclui implementação.
- Estado: Complete — contrato arquitetural aprovado e integrado em `main` pelo PR #10, no merge commit `8ba5348a2520c8d1250bb6b7ea9082cc80dd568e`. Apenas F4.1 está pronta; os gates operacionais de F4.2/F4.4 continuam pendentes e não existe autorização de rollout de produção.
- Pré-requisito concluído: F3 — membership e contexto organizacional, integrada pelo PR #8 e arquivada em `context/history/f3-membership-session-context.md`.
- Decisão principal aprovada para F4.1: `context/decisions/tenant-directory-and-lifecycle.md`.

## Objetivo

Definir a fronteira segura entre o contexto organizacional central validado e a futura base operacional de cada tenant, incluindo identidade, diretório, estados independentes, resolução, lifecycle, credenciais, compatibilidade, saúde, onboarding, offboarding e operação. O contrato deve permitir implementar F4.1–F4.5 sem incorporar regras UBI no núcleo nem expor infraestrutura ao cliente.

## Invariantes

- `organization_id`, `tenant_id` e `database_ref` são identidades distintas.
- O modo inicial é uma organização para um tenant e uma base PostgreSQL por tenant, mas a API de domínio não presume que os três identificadores sejam iguais.
- O `TenantResolver` recebe exclusivamente contexto organizacional validado no servidor.
- Headers, query, body, cookies de frontend e tokens nunca fornecem localizador, região, nome de base, `tenant_id`, `database_ref` ou credencial.
- Não existe fallback para Central, Legacy ou outro tenant.
- Credenciais e connection strings não entram em sessões, catálogo público, respostas HTTP, eventos funcionais ou logs.
- Estado contratual da organização, estado operacional da ligação, provisioning, compatibilidade de schema e saúde observada permanecem distintos; as quatro dimensões F4 não substituem `organization.status` de F3.
- Saúde observada é evidência operacional com validade limitada; nunca substitui autorização nem validação da ligação no momento de uso.
- Membership antecipada permanece inelegível para acesso funcional até organização, ligação e schema estarem utilizáveis e a projeção local obrigatória existir.
- Suspensão, offboarding, retenção, legal hold, arquivo lógico e eliminação física são decisões distintas.
- C4G/UBI, `ADMIN`, `PROFESSOR`, faculdades e centros de investigação não pertencem ao contrato de tenant.

## Contrato funcional aprovado para F4.1

### Identidade e cardinalidade

- `tenant_id` é um UUID global, imutável, criado pela Central e nunca reutilizado.
- Uma organização pode ter zero ou um tenant durante onboarding e possui exatamente um quando fica operacional no modo inicial `DATABASE_PER_ORGANIZATION`.
- Um tenant pertence a exatamente uma organização; mudança de proprietário não é suportada.
- Reprovisionamento, restore ou rotação de infraestrutura preservam `tenant_id` e alteram `connection_version` e/ou `database_ref`.
- `DATABASE_PER_ORGANIZATION` é o único deployment mode inicialmente suportado. Modos futuros só podem ser introduzidos por decisão e implementação próprias; esta decisão de MVP não afirma que nunca existirão outros modos.

### Diretório Central e resolução

- O diretório Central é a única fonte de verdade da associação organização → tenant → referência de infraestrutura.
- O catálogo guarda apenas referências opacas a base e credencial; o segredo é resolvido por adaptador de secret manager no servidor.
- `organization_connection` contém `tenant_id`, `current_connection_version`, estado corrente e `revision`; a organização é derivada de `tenant`. As referências físicas ficam em `organization_connection_version`, com versões recuperáveis por `(tenant_id, connection_version)` e estados `CANDIDATE`, `VALIDATED`, `DRAINING`, `REVOKED` ou `FAILED`; o ponteiro corrente é a única autoridade sobre a versão ativa.
- `tenant_database_generation` atribui cada `database_generation_id` e `database_ref` a exatamente um tenant. Versões sucessivas do mesmo tenant podem referir a mesma geração durante rotação de credencial, mas nenhuma geração ou referência física pode atravessar tenants.
- `organization_provisioning` começa por organização e usa `tenant_assignment_state = UNASSIGNED|ASSIGNED`. O `CHECK` fechado relaciona esse estado, `tenant_id` e os estados do workflow; a FK composta usa `MATCH SIMPLE NOT DEFERRABLE INITIALLY IMMEDIATE`, `ON UPDATE RESTRICT` e `ON DELETE RESTRICT`; uma trigger futura permite apenas `UNASSIGNED/NULL → ASSIGNED/valor`, proibindo remoção ou substituição.
- Organizações, tenants, provisionings, ligações e versões de ligação não são eliminados fisicamente fora de workflow aprovado, auditado e sujeito a retenção/legal hold.
- A entrada usa contexto F3 validado e `operationCode` constante do adaptador interno registado; modo READ/WRITE nunca é livremente escolhido pelo consumidor.
- O catálogo versionado da release deriva modo, schema mínimo, capacidades, elegibilidade `READ_ONLY`, query module e testes obrigatórios. O startup falha perante códigos duplicados, entradas incompletas ou módulos ausentes.
- A saída interna do resolver inclui apenas: `organizationId`, `tenantId`, `deploymentMode`, `databaseRef`, `credentialRef`, `regionCode`, `connectionVersion`, estado operacional, contrato derivado da operação e compatibilidade.
- Uma resolução bem-sucedida exige correspondência exata com `organizationContext.organizationId`, organização/membership elegíveis, ligação `AVAILABLE`, provisioning pronto, schema/capacidades compatíveis, binding físico validado e material de ligação disponível.
- Falha de qualquer precondição termina antes de obter ou usar um pool tenant.

### Dimensões de estado

| Dimensão | Estados aprovados | Regra principal |
| --- | --- | --- |
| Ligação operacional | `PENDING`, `AVAILABLE`, `BLOCKED`, `DRAINING`, `ARCHIVED` | Apenas `AVAILABLE` permite avaliar nova operação; nunca reativa uma organização. |
| Provisioning | `NOT_STARTED`, `QUEUED`, `RUNNING`, `VERIFYING`, `READY`, `FAILED`, `CANCELLED` | `READY` é necessário, mas não suficiente, para acesso. |
| Compatibilidade | `UNKNOWN`, `COMPATIBLE`, `READ_ONLY`, `MIGRATION_REQUIRED`, `MIGRATING`, `INCOMPATIBLE`, `FAILED` | Apenas `COMPATIBLE` permite operação normal; `READ_ONLY` admite somente catálogo explícito de leituras seguras. |
| Saúde observada | `UNKNOWN`, `HEALTHY`, `DEGRADED`, `UNREACHABLE` | Não concede acesso; influencia circuit breaker e diagnóstico. |

### Concorrência e idempotência

- Toda alteração de lifecycle usa versão otimista ou compare-and-set e regista transição auditável.
- Comandos de provisioning, rotação, suspensão e offboarding exigem chave de idempotência por operação.
- Apenas uma operação mutável de lifecycle ou migration pode deter o lock expirável do tenant.
- Retentativas retomam a partir de passos concluídos e não criam nova identidade, base ou credencial sem decisão explícita.
- Eventos usam identificador único, inbox/outbox e reconciliação; não se presume transação distribuída.

## Estados e transições

A matriz normativa única, com estados, transições, precondições e efeitos, está em `context/decisions/tenant-directory-and-lifecycle.md`. O plano não a duplica. Transições não listadas falham fechado; compare-and-set, idempotency key e lock expirável protegem concorrência. Offboarding que afete vários registos usa transação Central e torna primeiro a organização inelegível.

### Política `READ_ONLY`

- O catálogo de leituras seguras é explícito, versionado e deny-by-default.
- `operationCode` nunca vem diretamente do cliente; adaptadores internos registados resolvem-no no catálogo da release.
- Operação, catálogo, release, versão, capacidade ou compatibilidade desconhecida falha antes de adquirir uma lease/query.
- Uma leitura segura não executa DDL/DML, cria projeções ou estado local, dispara jobs/efeitos assíncronos, adquire locks de escrita, atualiza timestamps funcionais, depende de side effects ou aceita SQL arbitrário não classificado.
- Cada leitura segura usa query module registado, testes obrigatórios e transação PostgreSQL realmente read-only; funções com efeitos são classificadas como escrita.
- O executor valida que lease, `operationCode`, módulo e modo coincidem e executa `BEGIN READ ONLY` antes de qualquer SQL do módulo de leitura.
- `READ_ONLY` não equivale a acesso geral de leitura; apenas `COMPATIBLE` permite o funcionamento normal de leitura e escrita.

### Binding, rotação e leases

- O marker prova `tenant_id` e `database_generation_id`; o fingerprint prova a forma do schema; `system_identifier` é apenas evidência observada do cluster; `connection_version` identifica o binding aprovado; o binding digest fixa estes elementos e as referências opacas esperadas.
- A rotação cria uma versão `CANDIDATE`, valida-a para `VALIDATED`, troca atomicamente o ponteiro corrente e incrementa `revision`, move a versão anterior para `DRAINING`, bloqueia novas leases antigas, drena-as até ao timeout e só então marca a versão anterior `REVOKED`; falhas pré-cutover tornam a candidata `FAILED` e resultados incertos são reconciliados pelo ponteiro e estados persistidos.
- Cada lease fica vinculada a tenant, `connectionVersion`, `revision`, binding digest, `operationCode`, módulo e modo. Se versão ou revisão mudarem durante a aquisição, a resolução é descartada e reiniciada antes da primeira query.
- O fence é incrementado antes de suspensão/offboarding bloquear novas leases. Leases existentes não são renováveis e podem concluir leitura ou escrita já iniciada dentro do timeout; não se promete revogação instantânea de transações em curso. Passos irreversíveis aguardam drenagem e retries resolvem novamente todo o contrato.

## Readiness por fase

| Gate | Estado | Evidência ou bloqueio |
| --- | --- | --- |
| F4.1 — diretório, constraints e repositórios sem conexões tenant | **Ready for F4.1** | PK/FKs/unicidades compostas, binding, estados, transições, referências opacas e concorrência estão aprovados |
| F4.2 — abstrações e testes locais | **Permitido** | pode usar adaptadores falsos e limites pequenos/determinísticos sem fornecedor real |
| F4.2 — integração operacional/produção | **Blocked for production F4.2** | aguarda secret manager, sizing e parâmetros operacionais de pools/probes/circuit breaker |
| F4.3 — migrations e compatibilidade em ambiente sintético | **Planeável após F4.1** | deve materializar catálogo `READ_ONLY`, marker, ledger, fingerprint e gates sem rollout externo |
| F4.4 — provisioning e operação reais | **Blocked for production F4.4** | aguarda provisioning orchestrator, regiões concretas, RPO/RTO, backup/restore, retenção, exportação, legal hold e eliminação |
| Rollout tenant em produção | **Não autorizado** | exige gates operacionais aprovados e autorização posterior explícita |

## Fases posteriores

### F4.1 — Diretório Central

- Materializar tenant, ligação, estado de schema e provisioning na Central.
- Implementar constraints, repositórios e transições, sem abrir conexões tenant.
- Provar cardinalidade, idempotência, histórico recuperável da ligação e recusa de transições inválidas.
- Aceitação: duas organizações sintéticas recebem identidades tenant distintas; `tenant.organization_id` é único; ligação deriva organização apenas por tenant; `tenant_assignment_state`, FK composta e trigger impedem mismatch, avanço sem atribuição, remoção e substituição no provisioning; uma organização não aceita segundo tenant; ownership físico impede associação cruzada sem bloquear rotação de credencial sobre a mesma geração; versões preservam estado recuperável e o ponteiro corrente troca atomicamente; referências/versões não são reutilizadas indevidamente; `READY` exige binding validado; concorrência e transições inválidas falham antes de mutação parcial.

### F4.2 — Resolver e pools

- Implementar `TenantResolver`, adaptador de segredos e gestor de pools limitado.
- Provar isolamento com dois tenants sintéticos, single-flight, rotação, drenagem e ausência de fallback.
- Aceitação: input cliente não influencia resolução nem classificação de acesso; `operationCode` deriva de adaptador registado; cada contexto chega apenas ao seu tenant; binding/marker/fingerprint errados, diretório ausente/ambíguo, ligação não disponível, credencial indisponível e circuit breaker aberto falham antes da query; rotação drena a versão anterior sem fuga ou fallback.
- Política de orçamento: limite por tenant, limite global por processo, reserva operacional, timeouts, idle expiration, single-flight, drenagem por `connectionVersion`, backoff com jitter, circuit breaker por tenant, métricas de saturação e testes sob carga. Valores de produção dependem de capacidade medida; testes locais usam valores pequenos e determinísticos.

### F4.3 — Baseline e migrations tenant

- Criar marker, manifest, ledger, checksums, fingerprint, preflight e runner tenant.
- Definir compatibilidade de leitura/escrita e rollout `expand → migrate → contract`.
- Aceitação: base limpa e upgrade suportado passam; marker errado, ledger desconhecido/com lacunas, checksum/fingerprint divergente ou versão incompatível falham antes de DDL funcional; migration de um tenant não toca noutro, Central ou Legacy.

### F4.4 — Onboarding, offboarding e reconciliação

- Implementar saga idempotente, health operacional, compensações, reconciliação, backup/restore hooks e workflow de retenção.
- Não executar eliminação física automática no MVP.
- Aceitação: repetição após falha retoma sem duplicar recursos; ativação só ocorre após todos os gates; suspensão bloqueia imediatamente; offboarding drena workloads e respeita legal hold; health obsoleto não autoriza operações; reconciliação não adota nem elimina recursos desconhecidos.

### F4.5 — Adaptação do piloto UBI

- Tratar a UBI como primeiro tenant através dos mesmos contratos.
- Migrar progressivamente rotas e dados sem introduzir caminhos UBI no núcleo.
- Aceitação: a UBI resolve pelo mesmo diretório e pool manager que outro tenant sintético; rotas migradas deixam de depender do `legacyPool`; dados, nomes e papéis UBI ficam no adaptador/migração e testes provam ausência de acesso cruzado.

F5 implementará perfis, grants e autorização funcional dentro do tenant. Branding, federação SSO/SAML/SCIM, licenciamento, quotas e medição são features posteriores com contratos próprios.

## Critérios de aceitação da F4.0

- [x] A decisão arquitetural necessária para F4.1 está aprovada e não contradiz as decisões existentes de identidade, alojamento ou modelo de dados.
- [x] Identidades, cardinalidade e o deployment mode inicial estão definidos sem equiparar IDs.
- [x] As quatro dimensões de estado, transições, precondições e efeitos estão explícitas.
- [x] Entrada, saída e invariantes do `TenantResolver` estão definidos e excluem input de infraestrutura do cliente.
- [x] Falhas públicas e internas têm taxonomia estável, sanitizada e fail-closed.
- [x] Concorrência, idempotência, locks, rotação, revogação e drenagem estão contratados.
- [x] Onboarding, suspensão, offboarding, retenção, legal hold, arquivo e eliminação física estão separados.
- [x] Residência UE por defeito, backup/restore e políticas de dados têm regras; valores e fornecedores pendentes estão associados a gates posteriores.
- [x] Administração C4G, administração da entidade e suporte temporário têm fronteiras distintas.
- [x] F4.1–F4.5 possuem objetivos e critérios testáveis sem incluir F5 ou especificidades UBI.
- [x] Arquitetura e dicionário lógico refletem minimamente o contrato aprovado.
- [x] Revisão documental confirma ausência de código, migrations, segredos, endpoints ou infraestrutura fictícia.

## Validação prevista

- Rever coerência com `project-overview`, arquitetura, decisões existentes, dicionário lógico e arquivo F3.
- Verificar referências e terminologia por pesquisa textual.
- Executar `git diff --check` e scan documental de segredos, connection strings, dados reais e marcadores indevidos.
- Confirmar que o diff contém apenas documentação e que os ficheiros locais protegidos permanecem fora do índice.

## Decisões pendentes e gates

1. Região/cloud concretas na União Europeia e allowlist operacional — bloqueiam provisioning real F4.4; exceções exigem aprovação documentada de segurança, privacidade/DPO e produto/contrato.
2. RPO, RTO, frequência e retenção de backups por tier/contrato — não bloqueiam F4.1 nem abstrações locais F4.2; bloqueiam F4.4 e ativação operacional. Restore testado é requisito de ativação.
3. Prazos e SLAs de retenção, exportação e offboarding — exigem validação jurídica/DPO e bloqueiam o workflow real F4.4.
4. Autoridades segregadas para legal hold e eliminação física — bloqueiam essas operações e o offboarding real F4.4.
5. Secret manager — não bloqueia F4.1; bloqueia integração real F4.2 e provisioning real F4.4. O contrato mantém-se vendor-neutral.
6. Provisioning orchestrator — não bloqueia F4.1; bloqueia provisioning real F4.4. Neon permanece o fornecedor PostgreSQL previsto até eventual ADR substitutivo.
7. Valores de produção para limites de pools, reserva, timeouts, idle expiration, probes, backoff e circuit breaker — bloqueiam F4.2 operacional, não F4.1 nem testes locais.
8. Catálogo inicial versionado de operações `READ_ONLY` seguras da release — deve ser aprovado e testado em F4.3 antes de qualquer uso desse estado; não pertence a `tenant_schema_state` e ausência de entrada implica recusa.

## Fora do âmbito

- migrations, tabelas, repositórios, resolver, pools e provisioning executável;
- ligação ou alteração da Legacy e migração UBI;
- frontend e experiência de onboarding;
- autorização funcional F5;
- branding, SSO/OIDC/SAML/SCIM por organização;
- planos, quotas, licenciamento e medição de utilização;
- provisionamento ou contacto com Neon, staging ou produção.

## Referências

- `context/project-overview.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/decisions/hosting-and-external-services.md`
- `context/decisions/tenant-directory-and-lifecycle.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `context/history/f3-membership-session-context.md`

## Fecho confirmado da F4.0

- O PR #10 foi integrado em `main` pelo merge commit `8ba5348a2520c8d1250bb6b7ea9082cc80dd568e` em 2026-10-05.
- O ADR `context/decisions/tenant-directory-and-lifecycle.md` permanece a fonte normativa do contrato.
- A conclusão da F4.0 autoriza apenas o planeamento e implementação da F4.1; não conclui os gates de F4.2/F4.4 e não autoriza rollout.

Next step: planear e rever a F4.1 — Diretório Central de tenants antes de implementar migration, repositórios ou testes.
