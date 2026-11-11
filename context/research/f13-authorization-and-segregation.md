# F13 — Autorização, grants e segregação de funções

**Estado:** Investigação; recomendação sujeita a aprovação humana
**Decisão:** Que operações F13 devem integrar o catálogo F5, que recursos/scopes carregam, quais exigem maker-checker ou assurance reforçado e que combinações de atores são permitidas?

## Âmbito e limites

Inclui leitura, lifecycle editorial/ativação, taxonomias e catálogos, evidência/verificação, valores restritos, exports, scopes, assurance, reautorização e F7. Exclui UI, IdP/Keycloak produtivo, provisioning de utilizadores, políticas RH, matching, scoring e F15.

## Factos estabelecidos pelo repositório

### Contratos F5/F7 existentes

- F5 resolve um `operationCode` fechado para permission, resource type, efeito e audit event; permission fixa scopes, sensibilidade e regra SoD. Valores desconhecidos falham fechado.
- A autorização recarrega membership, snapshot de grants e resource server-side. `organizationId`, estado, owners, relações e scopes não são confiados ao payload.
- Scopes aprovados são `ORGANIZATION`, `UNIT`, `UNIT_SUBTREE`, `TEAM` e `RESOURCE`; scope matching exige organização coincidente.
- Só existem grants positivos. Perfis `ORG_ADMIN`, `FUNDING_MANAGER`, `CONTRIBUTOR` e `VIEWER` são bundles versionados; o nome do perfil não decide acesso no domínio.
- Permission sensível ou suporte exige assurance recente conforme F2/F5. SoD compara atributos confiáveis do ator/recurso e recusa por omissão.
- F7 distingue evento crítico pré-efeito, deny-preserving e observacional reconciliável. Evento crítico não aceite aborta o efeito.
- F12 prova operations/resources fechados, recurso carregado internamente, resposta uniforme para IDOR e eventos source-local com mutação na mesma transação.
- Service actors só podem usar bindings explícitos não sensíveis/sem SoD; não recebem implicitamente operações humanas sensíveis.

### Evidência que não constitui contrato futuro

- Roles UBI `ADMIN` e `PROFESSOR`, checks em controllers e visibilidade de UI não são autoridade F13 nem modelo universal.
- A pessoa humana pode ter várias sessões/memberships/identidades técnicas. SoD não pode comparar apenas `actorId` efémero; precisa de um subject/person key confiável de F2/F3, sem o expor ao caller.
- Os catálogos atuais terminam em F12; nenhuma operação F13, grant ou evento F7 abaixo está implementado.

## Opções viáveis

| Opção | Least privilege | Auditabilidade/SoD | Evolução | Risco |
|---|---|---|---|---|
| A. Roles fixos com permissões implícitas | Fraco; role acumula capacidades | Difícil explicar cada efeito | Role proliferation | Privilege creep e reuso UBI |
| B. Grants finos por operation/resource/scope, com perfis como bundles | Forte e alinhado com F5 | Decisão e SoD reproduzíveis | Catálogos versionados | Mais entradas e administração |
| C. ABAC livre configurado pelo caller | Aparente flexibilidade | Política não determinística/não governada | Difícil compatibilidade | Fail-open, injection de atributos e deriva |

## Recomendação

Recomenda-se a **Opção B**:

- operation, permission, resource type, scopes, sensibilidade, SoD e evento são catálogos fechados/versionados;
- resource loader obtém atributos confiáveis server-side;
- grant positivo explícito e deny-by-default;
- perfis são apenas bundles administrativos de grants;
- nenhum role name, atributo HTTP/job ou conceito UBI decide autorização;
- decisões são reavaliadas imediatamente antes do efeito.

## Catálogo candidato

Os nomes abaixo são candidatos a validar, não códigos aprovados.

### Perfil e lifecycle

- `F13_PROFILE_READ`
- `F13_PROFILE_DRAFT_CREATE`
- `F13_PROFILE_DRAFT_EDIT`
- `F13_PROFILE_SUBMIT`
- `F13_PROFILE_APPROVE`
- `F13_PROFILE_REJECT`
- `F13_PROFILE_PUBLISH`
- `F13_PROFILE_COHORT_ACTIVATE`
- `F13_PROFILE_SCOPE_DEACTIVATE`
- `F13_PROFILE_ROLLBACK`
- `F13_PROFILE_ARCHIVE`
- `F13_PROFILE_RESTORE`

### Taxonomias e catálogos tenant-local

- `F13_TAXONOMY_READ`
- `F13_TAXONOMY_LOCAL_CONCEPT_CREATE`
- `F13_TAXONOMY_LOCAL_CONCEPT_APPROVE`
- `F13_TAXONOMY_RELEASE_PUBLISH`
- `F13_METRIC_CATALOG_READ`
- `F13_METRIC_CATALOG_ADMIN`

Autoridade editorial de catálogos globais não deve ser incluída silenciosamente nos grants de organização; requer boundary/plataforma próprios.

### Assertions, evidência e verificação

- `F13_EVIDENCE_LINK_READ`
- `F13_EVIDENCE_ATTACH`
- `F13_COMPETENCY_VERIFY`
- `F13_FINANCIAL_VERIFY`
- `F13_OPERATIONAL_VERIFY`
- `F13_ASSERTION_DISPUTE`
- `F13_ASSERTION_CONFLICT_RESOLVE`
- `F13_ASSERTION_REVOKE`

`F13_EVIDENCE_LINK_READ` não concede leitura do documento F11; conteúdo documental exige também autorização F11 independente.

### Dados restritos e exports

- `F13_RESTRICTED_VALUE_READ`
- `F13_PROFILE_EXPORT_FULL`
- `F13_PROFILE_EXPORT_REDACTED`

Leitura normal de snapshot/projeção redigida permanece em `F13_PROFILE_READ`; o código restrito concede apenas a projeção exata permitida pela classificação.

## Matriz operação × resource × scope × assurance

| Grupo/operação | Resource carregado | Scopes candidatos | Grant/efeito | Assurance | SoD essencial |
|---|---|---|---|---|---|
| `PROFILE_READ` | `PROFILE_SNAPSHOT` ou draft/version | ORG, UNIT, TEAM, RESOURCE | `profile.read`, READ | sessão válida | classificação/projeção; sem self-rule |
| `DRAFT_CREATE` | `PROFILE_SCOPE` | ORG, UNIT, TEAM | `profile.draft.create`, WRITE | sessão válida | scope/entity ativa |
| `DRAFT_EDIT` | `PROFILE_DRAFT` | ORG, UNIT, TEAM, RESOURCE | `profile.draft.edit`, WRITE | sessão válida | editor autorizado; CAS |
| `SUBMIT` | `PROFILE_DRAFT` | ORG, UNIT, TEAM, RESOURCE | `profile.submit`, WRITE | sessão válida | autor pode submeter; digest exato |
| `APPROVE/REJECT` | `PROFILE_DRAFT_REVISION` | ORG, UNIT, TEAM, RESOURCE | grants distintos, WRITE | `RECENT_MFA` | subject aprovador ≠ qualquer autor/editor material da revision |
| `PUBLISH` | `PROFILE_VERSION` | ORG, UNIT, TEAM, RESOURCE | `profile.publish`, WRITE | `RECENT_MFA` | versão aprovada; publisher pode ser approver, nunca autor |
| `COHORT_ACTIVATE` | `PROFILE_ACTIVATION_COHORT` | ORGANIZATION | `profile.activate`, WRITE | `RECENT_MFA` | activator não é autor de membro; coorte inteira carregada |
| `SCOPE_DEACTIVATE` | `SCOPE_ACTIVATION` | ORG, UNIT, TEAM, RESOURCE | `profile.deactivate`, WRITE | `RECENT_MFA` | sem gap da baseline; reason obrigatório |
| `ROLLBACK` | `ACTIVATION_RECORD` | ORGANIZATION, RESOURCE | `profile.rollback`, WRITE | `RECENT_MFA` | nova ativação; target aprovado; activator não autor |
| `ARCHIVE/RESTORE` | `PROFILE_VERSION` | ORG, UNIT, TEAM, RESOURCE | grants distintos, WRITE | `RECENT_MFA` | não ativo; restore não muta história |
| `TAXONOMY_READ`/`METRIC_READ` | release/catalog | ORG ou RESOURCE | grants read | sessão válida | projeção publicada |
| `LOCAL_CONCEPT_CREATE` | `LOCAL_CONCEPT_DRAFT` | ORGANIZATION | `taxonomy.local.create`, WRITE | sessão válida | creator identificado |
| `LOCAL_CONCEPT_APPROVE` | `LOCAL_CONCEPT_REVISION` | ORGANIZATION/RESOURCE | `taxonomy.local.approve`, WRITE | `RECENT_MFA` | approver subject ≠ creator/editor |
| `RELEASE_PUBLISH`/`METRIC_ADMIN` | release/catalog revision | ORGANIZATION/RESOURCE | grants separados, WRITE | `RECENT_MFA` | conteúdo aprovado; maker-checker |
| `EVIDENCE_ATTACH` | assertion/evidence link | ORG, UNIT, TEAM, RESOURCE | `evidence.attach`, WRITE | sessão válida ou elevada por classificação | não verifica automaticamente; F11 separado |
| `*_VERIFY` | assertion/fact/evidence | ORG, UNIT, TEAM, RESOURCE conforme domínio | grant por domínio, WRITE | `RECENT_MFA` | verifier não criou/alterou assertion/evidence material |
| `DISPUTE` | assertion/version | ORG, UNIT, TEAM, RESOURCE | `assertion.dispute`, WRITE | `RECENT_MFA` | reason e provenance obrigatórios |
| `CONFLICT_RESOLVE` | conflict set | ORG, UNIT, TEAM, RESOURCE | `assertion.conflict.resolve`, WRITE | `RECENT_MFA` | resolver distinto dos autores de assertions incompatíveis |
| `REVOKE` | assertion/verification | ORG, UNIT, TEAM, RESOURCE | `assertion.revoke`, WRITE | `RECENT_MFA` | reason; história preservada |
| `RESTRICTED_VALUE_READ` | fact/snapshot projection | ORG, UNIT, RESOURCE | `restricted_value.read`, READ | `RECENT_MFA` | purpose/reason; field-level projection |
| `EXPORT_FULL` | `PROFILE_EXPORT_REQUEST` | ORGANIZATION/RESOURCE | `profile.export.full`, READ | `RECENT_MFA` | purpose, classificação e F7 antes da capacidade |
| `EXPORT_REDACTED` | `PROFILE_EXPORT_REQUEST` | ORG, UNIT, TEAM, RESOURCE | `profile.export.redacted`, READ | `RECENT_MFA` | policy de redaction fixada |

Scopes de cada permission são a interseção entre esta matriz, o tipo de conteúdo e a decisão de domínio: capacidade financeira continua `ORGANIZATION`; capacidade operacional apenas `ORGANIZATION|UNIT`; competências podem usar `TEAM`. `UNIT_SUBTREE` não é concedido por omissão e requer decisão explícita sobre leitura/administração hierárquica.

## Resource loading canónico

Cada loader recebe apenas `organizationId`, `resourceType` e ID opaco do pedido e devolve server-side:

- resource ID e organization ID;
- scope type/ID e ancestors apenas quando autorizados pelo modelo canónico;
- lifecycle/status, revision/version e digest;
- author/editor/submitter/approver/verifier por stable human subject key;
- classificação/confidentiality e projection policy;
- baseline/cohort/activation relationships;
- membership/revocation/policy versions relevantes.

IDs inválidos, cross-tenant, scope incompatível ou recurso oculto retornam negação pública uniforme. O caller nunca fornece owner, author, verifier, classification, scope, estado, digest ou relation confiáveis.

## Regras SoD recomendadas

1. Autor/editor pode submeter a própria revisão.
2. Nenhum stable human subject que criou ou alterou materialmente a revisão pode aprová-la, mesmo com outra sessão, membership ou conta ligada.
3. Aprovador pode publicar e ativar quando não é autor e possui grants específicos; não se exige terceira pessoa por defeito.
4. Publisher e activator podem coincidir; cada comando reautoriza e regista assurance própria.
5. Autor de qualquer membro da coorte não pode ativar essa coorte.
6. Rollback exige grant de ativação/rollback, reason e nova reautorização; não exige novo terceiro aprovador se o alvo já foi aprovado e o ator não é autor.
7. Verifier não verifica assertion/evidence que criou ou alterou materialmente. Anexar documento não o torna verificado.
8. Resolver de `CONFLICTED` é distinto dos autores das assertions incompatíveis; resolução preserva todas as fontes.
9. Criador/editor de conceito tenant-local não o aprova. Publisher pode ser o approver com grant próprio.
10. Definição/alteração de catálogo/métrica exige maker-checker; catálogos globais usam autoridade separada da organização.
11. Leitura/export restrita não é concedida por capacidade de editar ou verificar.
12. Self-grant não pertence à F13; alterações de grant ocorrem no boundary F5, exigem autoridade própria, `GRANT_CHANGED`, SoD e reautorização.
13. Comparação maker-checker usa stable human subject; múltiplas identidades técnicas da mesma pessoa não satisfazem SoD.
14. Service actors não aprovam, publicam, ativam, verificam, resolvem conflito, leem valor restrito ou exportam na v1.
15. Não existe break-glass F13 v1. Emergência requer decisão própria, grant temporário, MFA, dupla aprovação, scope/tempo/reason e auditoria por uso.

## Assurance e MFA

### Recomendação de classes

- **Sessão validada:** read redigido, draft create/edit, submit, taxonomy/catalog read e evidence attach não sensível.
- **`RECENT_MFA`:** approve/reject, publish, cohort activate, deactivate, rollback, archive/restore, local concept approve, release publish, metric catalog admin, verify/dispute/conflict resolve/revoke, restricted value read e qualquer export.
- Classificação mais sensível pode exigir policy futura adicional, mas F13 não inventa novo ACR/AMR. Usa apenas evidência F2 reconhecida por F5.

Assurance é verificada no comando, ligada à decisão F5/F7 por policy version e freshness e revalidada na ativação mesmo que a aprovação anterior fosse válida. F7 regista apenas evidence class/version/timestamp permitido, nunca token, claims ou segredo.

## Eventos F7 candidatos

| Evento | Classe/transação recomendada | Evidência sanitizada mínima |
|---|---|---|
| `PROFILE_DRAFT_CREATED`, `PROFILE_DRAFT_REVISION_CREATED` | crítico com mutação editorial | actor/subject ref opaca, scope digest, revision, policy version, correlation |
| `PROFILE_DRAFT_SUBMITTED` | crítico na mesma transação | revision/content digest ref, submitter, scope, idempotency ref |
| `PROFILE_VERSION_APPROVED` / `REJECTED` | crítico na decisão | maker/checker refs, revision/version, reason code, assurance class |
| `PROFILE_VERSION_PUBLISHED` | crítico na publicação | version, schema/policy refs, digest ref |
| `PROFILE_COHORT_ACTIVATED` | crítico no cutover | cohort/activation refs, previous/new version refs, result |
| `PROFILE_SCOPE_DEACTIVATED` | crítico na desativação | scope digest, prior activation ref, reason |
| `PROFILE_ROLLBACK_ACTIVATED` | crítico na nova ativação | target/prior activation refs, reason, assurance |
| `PROFILE_ARCHIVED` / `RESTORED` | crítico na mutação lógica | version, prior/new state, reason |
| `TAXONOMY_LOCAL_CONCEPT_APPROVED`, `TAXONOMY_RELEASE_PUBLISHED` | crítico na mesma transação | concept/release refs, maker/checker, policy |
| `EVIDENCE_ATTACHED` | crítico na ligação | assertion/evidence refs opacas, source type, sem conteúdo |
| `ASSERTION_VERIFIED`, `DISPUTED`, `CONFLICT_RESOLVED`, `REVOKED` | crítico na transição | assertion/version, method/reason codes, verifier subject, validade |
| `RESTRICTED_VALUE_ACCESSED` | crítico antes de conceder leitura/capability | resource/projection class, purpose code, sem valor |
| `PROFILE_EXPORT_REQUESTED` | crítico antes do efeito/outbox | export type, projection policy, purpose, assurance |
| `PROFILE_EXPORT_COMPLETED` / `FAILED` | observacional reconciliável | request ref, result/reason, sem conteúdo/localização |

Eventos source-local que autorizam ou alteram estado integram a mesma transação da mutação/outbox. Completion externo posterior é observacional e reconciliável. Payloads não incluem valores financeiros, documentos, PII, conteúdo do perfil, URLs, connection data ou digests completos sensíveis.

## Dados restritos e exports

- Valor exato, banda e projeção redigida são capacidades distintas; acesso a uma não implica as outras.
- Field-level authorization escolhe a projection policy depois de carregar classificação/resource server-side.
- Leitura exata exige purpose/reason fechado, `RECENT_MFA` e evento crítico antes de devolver o valor.
- Export completo e redigido possuem grants diferentes; ambos exigem request explícito, purpose, snapshot/policy fixados, idempotência e auditoria.
- F14 recebe apenas a projeção prevista pela regra/contrato interno, não herda grants humanos de leitura restrita.
- Not-found e forbidden permanecem indistinguíveis externamente; list/count/search não revelam cardinalidade ou existência de campos `WITHHELD`.
- `semantic_digest` não é entregue quando permitir confirmação lateral; o consumidor recebe `projection_digest` autorizado.

## Riscos e decisões humanas restantes

1. Aprovar a Opção B e os códigos/granularidade finais de operations e permissions.
2. Aprovar a matriz de sensitivity/MFA, incluindo se submit/evidence attach sensíveis exigem step-up.
3. Confirmar que approver pode publicar/ativar e que duas pessoas são suficientes por defeito.
4. Definir o stable human subject confiável e política para contas ligadas/delegação sem introduzir PII no domínio.
5. Fechar `UNIT_SUBTREE` e administração hierárquica.
6. Definir authority/boundary para catálogos globais e administração de métricas.
7. Fechar reason/purpose codes, freshness de approval/assurance e revocation versions.
8. Aprovar event codes F7, schemas, classes e quais leituras precisam de evento crítico.
9. Definir classificação de campos, grants de projeção, export/redaction, retenção e legal hold.
10. Manter break-glass fora da v1 ou investigar contrato próprio.

## Implicações para F13 e F14

- **F13-AC-05, AC-18, AC-21 e AC-25:** operations/resources/scopes fechados e resource loading server-side impedem caller-driven authorization e IDOR.
- **F13-AC-07, AC-12 e AC-22:** aprovação/ativação ligam maker-checker, assurance, autoria e F7 crítico.
- **F13-AC-16, AC-17 e AC-20:** verificação, valores restritos e estados usam grants/projeções próprios.
- **F13-AC-23:** service actors não recebem operações humanas; F9 continua fora do lifecycle síncrono v1.
- **F13-AC-24:** logs/métricas usam apenas operation/result/reason/class fechados, sem resource/actor/tenant IDs.
- **F13-AC-30 e AC-32:** autorização governa acesso ao snapshot; não decide scoring, e a F14 recebe apenas projeção/digest permitidos pelo seu contrato.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-competencies-and-experience.md`
- `context/decisions/f13-financial-capacity.md`
- `context/decisions/f13-operational-capacity.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f9-async-execution-foundation.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`
- `backend/src/authorization/catalogs.js`
- `backend/src/authorization/authorizationService.js`
- `backend/src/authorization/policyEngine.js`
- `backend/src/security/assurance.js`
- `backend/src/opportunities/tenantOperations.js`

Não foram necessárias fontes externas: a decisão depende de contratos internos F5/F7 já aprovados e do domínio F13.

Next step: aprovar ou corrigir a recomendação de papéis, grants e segregação de funções antes de consolidar a especificação F13.
