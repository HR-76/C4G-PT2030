# F13 — Compatibilidade N/N-1 de schema, policies, catálogos e snapshots

- Estado: **Proposta — requer aprovação humana**
- Feature: `F13 — Perfil organizacional para matching`
- Questão: como evoluir writers, readers, snapshots, jobs e policies sem reinterpretar histórico ou exigir deploy atómico?
- Data: 2026-10-10

## Decisão a suportar

Definir uma janela N/N-1 explícita e fechada que permita rollout misto e rollback de software seguro, sem admitir produtos cartesianos de versões, upgrades implícitos ou mutação de snapshots históricos.

Esta investigação define o contrato de compatibilidade local. Não autoriza rollout produtivo, não inicia F14 e não cria migrations ou plano de implementação.

## Evidência interna

### Padrões reutilizáveis

- Os runners Central e tenant usam manifests ordenados com ordinal, checksum, fingerprint, ledger, irreversibility e capabilities. Gaps, ordem, checksum ou fingerprint divergentes falham fechado.
- O tenant migration manifest já contém `readVersions` e `writeVersions`, mas as entradas atuais aceitam apenas a própria versão; não existe ainda uma janela F13 N/N-1 materializada.
- O catálogo de operações tenant fixa, por operation, schema versions compatíveis, capabilities, workload, access mode e schemas de input/result. Startup rejeita catálogos incompletos ou incoerentes.
- F4/F4.4 separa API e WORKER por workload e connection version, usa fence persistente e recusa leases com schema/capabilities incompatíveis.
- F9 versiona envelope, job e payload e valida capability do handler antes da execução. Envelope desconhecido é recusado, lineage/digests são preservados e replay não reescreve execution anterior.
- O registry F9 atual aceita separadamente `current` e `current-1` para `jobVersion` e `payloadVersion`. Esse padrão pode formar combinações cruzadas não necessariamente testadas; F13 precisa de tuples exatas no manifest em vez de decrementos independentes.
- F12 liga operation catalog a versões tenant/capabilities e preserva opportunity revision, rule/schema versions e snapshots. Jobs F12 usam payload fechado e versões explícitas.
- As decisões F13 fixam versões independentes para schema, snapshot, completion, projection, taxonomias/catálogos, reason/purpose, operations, events e jobs; snapshots preservam referências e digests exatos.
- A arquitetura exige rollout `expand → migrate → contract` e suporte temporário N/N-1, mas não presume compatibilidade nem admite writes incompatíveis.

### Limitações reais

- Não existe código, schema ou manifest F13; esta investigação só pode definir o contrato que a implementação terá de provar.
- Compatibilidade atual de migrations é predominantemente “mesma versão”, não uma autorização para ler/escrever F13 N-1.
- O registry F9 genérico não exprime adapters por tuple nem distingue compatibilidade de leitura histórica, ativação e escrita.
- A futura F14 ainda não existe; a sua versão entra no bundle como consumer contract reservado, sem grants ou comportamento executável nesta feature.

## Opções viáveis

| Critério | A. Apenas N | B. Compatibilidade permissiva | C. Matriz fechada N/N-1 |
|---|---|---|---|
| Rollout API/worker | exige deploy atómico | aceita combinações desconhecidas | tuples testadas por workload |
| Jobs pendentes | quebram no deploy | podem ser interpretados incorretamente | handler capability exata |
| Rollback software | quase impossível | aparenta funcionar sem prova | permitido apenas por matriz |
| Histórico | simples mas indisponível | upcast implícito | read adapter puro e versionado |
| Segurança | fail-closed, baixa disponibilidade | risco fail-open | fail-closed seletivo |
| Operação | simples em steady state | deriva difícil de diagnosticar | manifest/startup/readiness explícitos |
| Evolução de dados | migração imediata | mutação/reinterpretação | expand antes, contract posterior |

**A é insuficiente** para serviços e workers independentes. **B é rejeitada** por admitir combinações não provadas. Recomenda-se **C**.

## Recomendação

Adotar um `CompatibilityManifest` publicado, imutável, versionado e digestado. Cada release F13 declara bundles completos e tuples exatas por capacidade: write, current activation, historical read, projection, job handling e future consumer. Não existe compatibilidade derivada por semver, proximidade ordinal ou produto cartesiano.

### Versões independentes

O contrato distingue pelo menos:

1. `tenant_schema_version` e capabilities físicas;
2. `profile_schema_version` do conteúdo/version;
3. `snapshot_schema_version` da materialização efetiva;
4. `completion_policy_version` e policy set digest;
5. `confidentiality_catalog_version`;
6. `projection_policy_version` e policy set digest;
7. taxonomy/territory/competency/metric/beneficiary/constraint catalog releases;
8. `purpose_catalog_version` e `reason_catalog_version`;
9. F5 operation/permission catalog version;
10. F7 event catalog/schema version;
11. F9 envelope/job/payload version;
12. consumer contract version, reservando F14 sem o implementar.

Estas versões podem evoluir independentemente apenas quando o manifest contém a tuple resultante e respetivas provas. Uma alteração que afete mais de uma dimensão publica um release bundle atómico; publicar versões isoladas não autoriza a combinação.

## Release bundle conceptual

```text
F13ReleaseBundle {
  bundle_id / bundle_version / bundle_digest
  tenant_schema_version / required_capabilities
  writer_contract tuple
  current_activation tuple set
  historical_reader tuple set
  projection tuple set
  job_handler tuple set
  event / operation catalog versions
  allowed taxonomy/catalog release sets
  consumer tuple set
  adapter references + digests
  lifecycle: PUBLISHED | SUPERSEDED | RETIRED
}
```

Cada tuple enumera valores exatos. Sets de releases são listas fechadas/digestadas, nunca ranges abertos. Startup valida referências, unicidade, digests, schemas, adapters e que nenhuma tuple menciona capacidade ausente.

## Matriz N/N-1 recomendada

| Ação | Bundle N | Bundle N-1 | N-2/futuro/ausente |
|---|---|---|---|
| Criar/editar Draft | WRITE | recusado para novos writes | recusado |
| Approval/publication | WRITE | recusado | recusado |
| Nova materialização/activation | CURRENT_ACTIVATION | recusado, salvo rematerialização explícita para N | recusado |
| Ler snapshot ativo durante rollout | READ | HISTORICAL/TRANSITIONAL_READ se tuple explícita | recusado |
| Ler histórico | READ | HISTORICAL_READ via adapter puro se necessário | recusado |
| Projectar resposta/export | PROJECTION | somente tuple N-on-N-1 explicitamente segura | recusado |
| Processar job | JOB_HANDLER tuple exata | tuple exata publicada | não executar |
| F14 futuro | consumer tuple exata | apenas se manifest futuro o declarar | recusado |

- Writers emitem exclusivamente N.
- Readers N aceitam N e N-1 apenas nas tuples declaradas.
- Binário N-1 só opera após deploy N se o manifest instalado declarar que suporta o schema físico/capabilities presentes; caso contrário readiness falha.
- Um snapshot N-1 pode permanecer ativo temporariamente durante rollout apenas como transitional read, nunca como fonte para nova mutation/activation.
- Após o cutover para snapshot N, rollback lógico continua uma nova activation; reativar snapshot N-1 exige rematerialização/compatibilidade corrente, não simples pointer swap.

## Adaptação N-1

- Quando necessária, N-1 é adaptada em memória para uma representação canónica interna N através de adapter puro, fechado, versionado e digestado.
- O adapter não persiste, não altera snapshot, não inventa `UNKNOWN|NONE|VERIFIED`, não muda classification e não amplia projection.
- Apenas transformações semanticamente lossless ou conservadoras são admitidas. Campo sem correspondência segura produz incompatibilidade, não default.
- O resultado adaptado conserva source snapshot/version/digest e adapter version/digest para explicação.
- Leitura histórica pode usar o adapter; completion histórica usa o resultado/policy original. Completion policy N só avalia schema N-1 se existir policy/tuple específica publicada.
- Projection policy N só trata snapshot N-1 através de tuple explícita cuja saída seja igual ou mais restritiva. Nunca usa fallback para `EXACT`.

## API, worker, fencing e jobs

- API e WORKER anunciam `bundle_version`, operation catalog e handler capability sets no startup/readiness.
- O operation catalog seleciona workload e exige tenant schema/capabilities e bundle tuple compatíveis antes da lease.
- F4.4 mantém pools/circuits/fences por tenant, workload e connection version; mudança de bundle não elimina o fence físico e nenhuma lease antiga ganha capabilities novas.
- Durante deploy misto, a matriz enumera `API N / WORKER N`, `API N / WORKER N-1` e `API N-1 / WORKER N`; combinações ausentes ficam `UNAVAILABLE` para a operação afetada.
- Um job inclui envelope/job/payload versions, bundle/context refs e digests necessários. O registry valida a tuple completa, não `version in [N,N-1]` por campo independente.
- Job incompatível não entra no handler e não é acknowledged como sucesso. Permanece durável para retry/reconciliação após deploy compatível; se expirar, segue dead-letter/replay F9 preservando lineage e causa `INCOMPATIBLE`, nunca transformação silenciosa.
- Adapter de payload, quando aprovado, é puro/versionado, preserva idempotency/content digest e regista adapter digest; alterações funcionais exigem nova job/payload version.

## Upgrade incremental

Sequência recomendada:

1. publicar binários que conhecem o manifest N e ainda leem tuples N-1;
2. executar migration aditiva N pelo runner canónico;
3. validar ledger, checksum, fingerprint, capabilities e manifest digest;
4. publicar policies/catálogos N imutáveis;
5. habilitar writer N e materializar candidatos N;
6. validar completion/projection/jobs N;
7. ativar coorte N atomicamente;
8. observar e reconciliar jobs/snapshots N-1;
9. retirar writes N-1 imediatamente; retirar reads N-1 apenas numa feature/release posterior com evidência.

Instalações existentes percorrem todos os ordinais pelo runner. Não se aplica migration diretamente nem se fabrica ledger/capability. Commit incerto é reconciliado por ledger+fingerprint; retry converge pela intenção/digest persistidos.

### Migrations e backfill

- `expand`: apenas mudanças aditivas compatíveis com readers declarados; novas constraints podem ser `NOT VALID` apenas quando o padrão do runner/postflight o autorizar e devem ser validadas antes do cutover.
- `migrate`: materializa estrutura derivável com provenance. Backfill só é permitido quando determinístico, auditável e semanticamente neutro.
- Dados epistemologicamente ambíguos nunca são inferidos; usam `UNKNOWN` com migration provenance apenas quando a decisão legacy aprovada o autorizar.
- `contract`: remoção/renomeação breaking só após fim formal de N-1, corpus histórico provado e feature/migration posterior. Migrations publicadas nunca são editadas silenciosamente.

## Rollback

- Rollback de software não executa downgrade destrutivo de dados por defeito.
- O binário anterior só pode arrancar se o compatibility manifest afirmar suporte ao tenant schema, capabilities, catalogs e tuples instalados; startup/readiness recusam o contrário.
- Se N ainda não ativou conteúdo N, rollback usa o estado N-1 preservado.
- Depois de writes/activation N, rollback para binário incapaz de ler N é proibido. A recuperação usa forward fix ou binário anterior previamente compatível com N.
- Rollback lógico de profile continua uma nova activation sob bundle corrente; snapshots históricos não são modificados.

## Snapshots e digests

- Snapshot preserva bundle version/digest, todos os schema/policy/catalog versions, semantic/completion digests e source profile versions.
- Projection preserva snapshot source, projection policy/version/digest, purpose/reason catalogs quando aplicáveis e projection digest.
- Adapter não muda source semantic digest; produz um separate adapted representation digest ligado a source+adapter.
- O mesmo idempotency key e tuple/digests converge; key igual com bundle ou digest diferente conflita.
- Manifest, policy ou catalog alterado in-place é drift e impede startup/operation. Novo conteúdo exige nova versão.

## Startup, readiness e rollout stop

Startup valida integralmente:

- compatibility manifest schema, assinatura/digest local aprovado, unicidade e ausência de gaps;
- migration manifests, ledger prefix, SQL checksums, fingerprints e capabilities;
- existence/digests de completion/projection policies e todos os catálogos referidos;
- operation/resource/event/job catalogs e exact handler tuples;
- adapters referidos, direção, source/target e digests;
- coerência entre API/worker build capability e bundle selecionado.

Readiness fica `UNAVAILABLE` para workload/operação quando faltar qualquer tuple/capability. Rollout deve parar perante drift, job sem handler compatível, snapshot ativo ilegível, policy/catalog ausente, fingerprint divergente ou incapacidade de rollback declarada.

## Erros e observabilidade

Erros públicos permanecem fechados:

- `INCOMPATIBLE_VERSION`: tuple/bundle/schema/policy/catalog não suportado;
- `RESOURCE_NOT_AVAILABLE`: snapshot/job não utilizável sem revelar detalhes;
- `STATE_CONFLICT`: tentativa de write/activation incompatível;
- `STALE_REVISION`: bundle/pointer/policy avançou;
- `PERSISTENCE_UNAVAILABLE`: estado não pôde ser reconciliado com segurança.

Detalhes internos usam reason codes allowlisted como `BUNDLE_UNKNOWN`, `SCHEMA_FINGERPRINT_MISMATCH`, `CAPABILITY_MISSING`, `POLICY_DIGEST_MISMATCH`, `SNAPSHOT_VERSION_UNSUPPORTED`, `JOB_HANDLER_INCOMPATIBLE` e `ADAPTER_UNAVAILABLE`.

F7 regista publish/activation/rollback recusado, migration/compatibility decisions e replay autorizado com bundle/versions/digests seguros, nunca conteúdo. F10 agrega workload, operation, bundle version bounded, outcome e reason code; não inclui tenant/resource IDs, payload ou digests de alta cardinalidade.

## Provas exigidas

- validação estrutural do manifest e rejection de duplicates, gaps, unknowns, cartesian tuples e digest drift;
- runner tenant vazio→N, N-1→N, retry, commit incerto, SQL→ledger rollback e fingerprint/capability mismatch;
- corpus fixo de snapshots N/N-1, incluindo classifications, completion, projection, deprecated catalogs e legacy UNKNOWN;
- reader/adapter property tests de pureza, determinismo, conservadorismo e ausência de persistência;
- API N/worker N-1 e API N-1/worker N em tuples permitidas e recusadas;
- jobs pendentes/redelivery/replay sem ack ou mutation em incompatibilidade;
- nova activation só N; historical read N-1; N-2/futuro/ausente recusados;
- projection N sobre N-1 sem ampliação de acesso e digests reproduzíveis;
- F4 leases/fencing por workload durante deploy misto;
- fault injection entre SQL/ledger, policy publish, snapshot materialization e pointer swap;
- rollback de software permitido/recusado conforme manifest, sem downgrade destrutivo;
- PostgreSQL 17 descartável, cleanup e nenhuma infraestrutura externa.

## Invariantes propostas

1. Compatibilidade existe apenas como tuple explícita num manifest publicado e digestado.
2. Writer emite apenas N; readers aceitam apenas N e N-1 declarados.
3. N-2, futuro, ausente ou combinação cartesiana não declarada falham fechado.
4. Nova activation usa apenas bundle corrente N.
5. Historical read N-1 não muta nem reavalia o snapshot.
6. Adapter é puro, versionado, conservador e nunca persiste automaticamente.
7. Job só entra em handler com tuple exata compatível; incompatibilidade preserva durabilidade/lineage.
8. Startup valida manifest, ledger, fingerprints, capabilities, catalogs, policies, operations, events, jobs e adapters.
9. Rollback de software só ocorre se o binário anterior suportar o estado instalado.
10. Migration é expand→migrate→contract; breaking contract exige release futura após retirar N-1.
11. Backfill nunca inventa estado epistemológico, verification ou mapping.
12. Snapshot e projection preservam source versions/digests; history nunca é reinterpretada.

## Impacto nos critérios F13

- `F13-AC-05`: versões/tuples/capabilities desconhecidas ou cruzadas são recusadas.
- `F13-AC-06/09`: versions e snapshots permanecem imutáveis sob adaptação/leitura histórica.
- `F13-AC-07/08`: nova activation só ocorre com bundle N completo e cutover atómico.
- `F13-AC-10/11`: CAS, idempotency e digests cobrem bundle/policy/snapshot.
- `F13-AC-23`: jobs versionados e incompatíveis preservam retry/lineage F9.
- `F13-AC-26/27`: runner/manifest/fingerprint/capabilities e upgrades aditivos são normativos.
- `F13-AC-28/29`: PostgreSQL, concorrência, fault injection e rollback integral provam a janela.
- `F13-AC-31`: gates estruturais e regressões abrangem binários mistos.
- `F13-AC-32`: consumer só recebe tuple/snapshot compatível com versões exatas.

Nenhum critério passa por esta investigação; a recomendação continua sujeita a aprovação humana.

## Riscos e decisões humanas restantes

1. Aprovar opção C, writers apenas N, readers N/N-1 e recusa de N-2/futuro.
2. Aprovar que nova activation só usa N e que N-1 ativo é apenas transitional read durante rollout.
3. Aprovar adapters puros in-memory sem persistência e apenas para tuples enumeradas.
4. Aprovar o release bundle e dimensões/version fields mínimos.
5. Definir as tuples N/N-1 concretas e adapters só durante implementação/release, com corpus correspondente.
6. Harmonizar F9 para exact tuple capability em vez de decrementos independentes quando F13 adicionar jobs.
7. Definir prazo operacional para retirar N-1 e critérios de uma feature futura de contract.
8. A futura F14 deverá acrescentar consumer tuples por decisão própria; nenhuma é autorizada aqui.

## Fontes internas

- `context/architecture.md`
- `context/features/f13-organizational-profile.md`
- `context/decisions/f13-completion-policy.md`
- `context/decisions/f13-confidentiality-projection-purpose.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f9-async-execution-foundation.md`
- `context/history/f12-opportunity-catalog.md`
- `backend/src/security/tenantMigrationManifest.js`
- `backend/src/security/tenantOperationCatalog.js`
- `backend/src/security/tenantResolver.js`
- `backend/src/security/tenantSchemaObservationPublisher.js`
- `backend/src/async/envelope.js`
- `backend/src/async/jobRegistry.js`
- `backend/src/opportunities/jobs.js`
- `backend/src/opportunities/tenantOperations.js`

Não foram necessárias fontes externas: migrations, manifests, jobs, fencing, snapshots e rollout são contratos internos. Esta recomendação não constitui decisão aprovada nem autoriza implementação ou rollout.
