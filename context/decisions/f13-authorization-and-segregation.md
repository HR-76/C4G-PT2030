# Decisão: autorização e segregação de funções F13

## Estado

**Aprovada.**

## Contexto

A F13 altera configurações que serão consumidas pelo matching e contém valores potencialmente restritos. O acesso reutiliza F5/F7 sem roles UBI, atributos confiados ao caller ou autoridade implícita por perfil administrativo.

## Decisão

1. F13 usa grants finos por operação, resource e scope.
2. O comportamento é deny-by-default.
3. Operations, permissions, resource types, scopes e sensitivity pertencem a catálogos fechados F5.
4. Perfis administrativos são bundles de grants, não autoridade implícita.
5. Role names não entram no domínio F13.
6. Atributos de autorização são carregados server-side.
7. Caller não fornece organization, scope, author, verifier, classification ou estado confiáveis.
8. IDOR falha fechado antes de revelar existência.
9. Scopes v1 são exatos: `ORGANIZATION`, `UNIT` e `TEAM` somente nos domínios já aprovados para `TEAM`.
10. `UNIT_SUBTREE` fica fora da v1.
11. Modelo SoD padrão é maker-checker de duas pessoas.
12. Autor/editor pode criar Draft, editar e submeter.
13. Autor nunca aprova a própria revisão.
14. Aprovador pode aprovar ou rejeitar.
15. Aprovador pode publicar e ativar quando não é autor de qualquer membro da coorte, possui grants específicos, apresenta `RECENT_MFA` e a aprovação ainda é válida.
16. Não se exige terceira pessoa por defeito.
17. Publicação e ativação continuam operações/grants distintos.
18. Ativação valida SoD sobre todos os membros da coorte.
19. Autor de qualquer baseline/overlay da coorte não a ativa.
20. Rollback é nova ativação e usa os mesmos requisitos de grant, SoD e assurance.
21. Verifier não verifica assertion/evidence que criou, submeteu ou alterou materialmente.
22. Resolver de conflito é distinto dos autores envolvidos.
23. Criador de conceito tenant-local não o aprova.
24. Stable human subject para SoD usa identificador confiável e persistente do F5/IdP.
25. Email, username, display name, sessão ou token ID não constituem identidade SoD.
26. Múltiplas sessões da mesma pessoa continuam a mesma identidade humana.
27. Service actors não executam aprovação, ativação, rollback, verificação, resolução de conflito, revogação humana ou archive/restore sensível.
28. Self-grant e administração de identidades ficam fora da F13.
29. Não existe break-glass na v1.
30. Catálogos globais são read-only para tenants, têm autoridade editorial fora da F13 tenant e não podem ser publicados por grants tenant-local.
31. Conceitos tenant-local usam maker-checker.
32. Assurance de sessão normal é suficiente para leitura redigida, edição de Draft, submissão e operações editoriais não sensíveis.
33. `RECENT_MFA` é exigido para aprovação/rejeição, publicação, ativação/desativação, rollback, archive/restore, aprovação/publicação de conceitos tenant-local, administração de catálogos tenant permitidos, verificação, disputa, resolução, revogação, leitura de valores restritos e qualquer export.
34. Assurance é verificada no comando e registada no F7.
35. Ativação revalida assurance mesmo quando aprovação anterior tinha MFA.
36. Freshness concreta pertence à política F5, não à F13.
37. Leitura de valores exatos é distinta da leitura de bandas/projeções.
38. Export completo e redigido são operações distintas.
39. Leitura restrita e export exigem `reason_code`, `purpose_code`, resource, scope e F7.
40. Reason/purpose codes pertencem a catálogo fechado.
41. F7 crítico pertence à mesma transação source-local da mutação/autorização crítica.
42. Eventos críticos preservam actor/human subject, operation, resource, tenant/scope, assurance, reason/purpose, previous/new version, digest e idempotency key.
43. Payloads F7 não incluem valores financeiros, documentos, PII, conteúdo integral ou secrets.
44. Conclusões externas posteriores são observacionais e reconciliáveis.
45. Projeções redigidas não permitem inferir valores restritos por enumeração ou diferenças de erro.

## Catálogo final de operações F13 v1

`NORMAL` significa sessão F2/F5 válida. Scopes não incluem `UNIT_SUBTREE`/`RESOURCE`; o resource alvo continua exato e server-loaded. Reason/purpose são obrigatórios quando indicados.

| Operation | Permission | Resource | Scopes | Efeito | Assurance | SoD / reason-purpose | Evento F7 |
|---|---|---|---|---|---|---|---|
| `F13_PROFILE_READ` | `organization_profile.read` | `PROFILE_PROJECTION` | ORG,UNIT,TEAM | READ | NORMAL | projection policy | `PROFILE_ACCESSED` |
| `F13_PROFILE_DRAFT_CREATE` | `organization_profile.draft.create` | `PROFILE_SCOPE` | ORG,UNIT,TEAM | WRITE | NORMAL | scope ativo | `PROFILE_DRAFT_CREATED` |
| `F13_PROFILE_DRAFT_EDIT` | `organization_profile.draft.edit` | `PROFILE_DRAFT` | ORG,UNIT,TEAM | WRITE | NORMAL | editor+CAS | `PROFILE_DRAFT_REVISION_CREATED` |
| `F13_PROFILE_SUBMIT` | `organization_profile.submit` | `PROFILE_DRAFT` | ORG,UNIT,TEAM | WRITE | NORMAL | autor permitido | `PROFILE_DRAFT_SUBMITTED` |
| `F13_PROFILE_APPROVE` | `organization_profile.approve` | `PROFILE_DRAFT_REVISION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | `F13_PROFILE_APPROVAL_SOD` | `PROFILE_VERSION_APPROVED` |
| `F13_PROFILE_REJECT` | `organization_profile.reject` | `PROFILE_DRAFT_REVISION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | approval SoD; reason | `PROFILE_VERSION_REJECTED` |
| `F13_PROFILE_PUBLISH` | `organization_profile.publish` | `PROFILE_VERSION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | publication SoD | `PROFILE_VERSION_PUBLISHED` |
| `F13_PROFILE_COHORT_ACTIVATE` | `organization_profile.activate` | `PROFILE_ACTIVATION_COHORT` | ORG | WRITE | RECENT_MFA | cohort SoD; reason | `PROFILE_COHORT_ACTIVATED` |
| `F13_PROFILE_SCOPE_DEACTIVATE` | `organization_profile.deactivate` | `SCOPE_ACTIVATION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | deactivation SoD; reason | `PROFILE_SCOPE_DEACTIVATED` |
| `F13_PROFILE_ROLLBACK` | `organization_profile.rollback` | `ACTIVATION_RECORD` | ORG | WRITE | RECENT_MFA | cohort SoD; reason | `PROFILE_ROLLBACK_ACTIVATED` |
| `F13_PROFILE_ARCHIVE` | `organization_profile.archive` | `PROFILE_VERSION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | archive SoD; reason | `PROFILE_ARCHIVED` |
| `F13_PROFILE_RESTORE` | `organization_profile.restore` | `PROFILE_VERSION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | restore SoD; reason | `PROFILE_RESTORED` |
| `F13_TAXONOMY_READ` | `profile_taxonomy.read` | `TAXONOMY_RELEASE` | ORG,UNIT,TEAM | READ | NORMAL | — | `TAXONOMY_ACCESSED` |
| `F13_TAXONOMY_LOCAL_CONCEPT_CREATE` | `profile_taxonomy.local_concept.create` | `LOCAL_CONCEPT_DRAFT` | ORG | WRITE | NORMAL | creator | `TAXONOMY_LOCAL_CONCEPT_CREATED` |
| `F13_TAXONOMY_LOCAL_CONCEPT_APPROVE` | `profile_taxonomy.local_concept.approve` | `LOCAL_CONCEPT_REVISION` | ORG | WRITE | RECENT_MFA | local concept SoD | `TAXONOMY_LOCAL_CONCEPT_APPROVED` |
| `F13_TAXONOMY_RELEASE_PUBLISH` | `profile_taxonomy.release.publish` | `TAXONOMY_RELEASE` | ORG | WRITE | RECENT_MFA | taxonomy SoD | `TAXONOMY_RELEASE_PUBLISHED` |
| `F13_METRIC_CATALOG_READ` | `profile_metric_catalog.read` | `METRIC_CATALOG_RELEASE` | ORG | READ | NORMAL | — | `METRIC_CATALOG_ACCESSED` |
| `F13_METRIC_CATALOG_ADMIN` | `profile_metric_catalog.admin` | `METRIC_CATALOG_REVISION` | ORG | WRITE | RECENT_MFA | catalog SoD; reason | `METRIC_CATALOG_CHANGED` |
| `F13_EVIDENCE_LINK_READ` | `profile_evidence.link.read` | `EVIDENCE_LINK` | ORG,UNIT,TEAM | READ | NORMAL | F11 separado | `EVIDENCE_LINK_ACCESSED` |
| `F13_EVIDENCE_ATTACH` | `profile_evidence.attach` | `ASSERTION` | ORG,UNIT,TEAM | WRITE | NORMAL | não verifica | `EVIDENCE_ATTACHED` |
| `F13_COMPETENCY_VERIFY` | `profile_competency.verify` | `COMPETENCY_ASSERTION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | verification SoD; method | `COMPETENCY_ASSERTION_VERIFIED` |
| `F13_FINANCIAL_VERIFY` | `profile_financial.verify` | `FINANCIAL_FACT` | ORG | WRITE | RECENT_MFA | verification SoD; method | `FINANCIAL_FACT_VERIFIED` |
| `F13_OPERATIONAL_VERIFY` | `profile_operational.verify` | `OPERATIONAL_ASSERTION` | ORG,UNIT | WRITE | RECENT_MFA | verification SoD; method | `OPERATIONAL_ASSERTION_VERIFIED` |
| `F13_ASSERTION_DISPUTE` | `profile_assertion.dispute` | `ASSERTION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | reason | `ASSERTION_DISPUTED` |
| `F13_ASSERTION_CONFLICT_RESOLVE` | `profile_assertion.conflict.resolve` | `ASSERTION_CONFLICT` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | conflict SoD; reason | `ASSERTION_CONFLICT_RESOLVED` |
| `F13_ASSERTION_REVOKE` | `profile_assertion.revoke` | `ASSERTION` | ORG,UNIT,TEAM | WRITE | RECENT_MFA | revocation SoD; reason | `ASSERTION_REVOKED` |
| `F13_RESTRICTED_VALUE_READ` | `organization_profile.restricted_value.read` | `RESTRICTED_PROFILE_VALUE` | ORG,UNIT | READ | RECENT_MFA | reason+purpose | `RESTRICTED_VALUE_ACCESSED` |
| `F13_PROFILE_EXPORT_FULL` | `organization_profile.export.full` | `PROFILE_EXPORT_REQUEST` | ORG,UNIT,TEAM | READ | RECENT_MFA | reason+purpose | `PROFILE_EXPORT_REQUESTED` |
| `F13_PROFILE_EXPORT_REDACTED` | `organization_profile.export.redacted` | `PROFILE_EXPORT_REQUEST` | ORG,UNIT,TEAM | READ | RECENT_MFA | reason+purpose | `PROFILE_REDACTED_EXPORT_REQUESTED` |

Total: **29 operations**. Global catalog writes and document content reads are deliberately absent. Valores exatos, bandas e projeções são capacidades distintas; not-found/forbidden são uniformes.

## Impacto e pendências

Afeta F13-AC-05, 07, 12, 14, 16–18, 20–25, 30 e 32. Permanecem pendentes os valores dos catálogos reason/purpose, classes/projection policies, retenção/legal hold, freshness F5/stable subject binding e schemas F7 detalhados.

## Fontes

- `context/decisions/f13-versioning-and-activation.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`
- `context/research/f13-authorization-and-segregation.md`

## Registo da aprovação humana

A aprovação confirmou grants finos, scopes exatos, maker-checker de duas pessoas, stable human subject, restrições de service actors, ausência de break-glass, assurance e o catálogo final acima. Não autoriza implementação enquanto F13 estiver `Draft`.
