# F12/F5 — Addendum de autorização técnica dos jobs

Estado: aprovado em 2026-10-09. Este addendum complementa, sem reescrever, as decisões F12 e a matriz F4/F12.

## Decisão

`opportunity.duplicate.review` permanece exclusivamente humana, sensível e sujeita a membership F3, grant explícito, SoD e `RECENT_MFA`. Nenhum service actor pode exercê-la.

São adicionadas duas permissions técnicas, sem grants de perfil ou implícitos:

| Permission | Operation code F5/F4 | Service actor | Job type |
|---|---|---|---|
| `opportunity.duplicate.scan` | `OPPORTUNITY_DUPLICATE_SCAN_JOB` | `F12_DUPLICATE_SCANNER` | `opportunity.duplicate.scan` |
| `opportunity.catalog.reconcile` | `OPPORTUNITY_CATALOG_RECONCILE_JOB` | `F12_CATALOG_RECONCILER` | `opportunity.catalog.reconcile` |

As duas operações são `WRITE`, service-only, não sensíveis no sentido de assurance humana e não possuem SoD humano. A ausência de MFA só é válida quando o binding fechado coincide integralmente com service actor, organização, permission, operation code, job type, policy version e authorization/revocation version. `membershipId` e `assuranceEvidence` permanecem `null`. Actors `HUMAN` e `SUPPORT`, bindings divergentes, organização inativa ou grant técnico ausente são recusados.

## Contrato do grant técnico

O `AuthorizationDataPort` local fornece grants sintéticos explícitos, imutáveis e versionados com exatamente:

- `active`;
- `organizationId`;
- `permission`;
- `operationCode`;
- `serviceActorCode`;
- `jobType`;
- `policyVersion` igual a `f12-service-operations-v1`;
- `authorizationVersion` igual à versão autoritativa do actor.

Não existem wildcard, herança de perfil, fallback, grant global ou bypass do resource loading. A reautorização ocorre em cada attempt e replay.

## Impacto F4/F12

- `OPPORTUNITY_DUPLICATE_SCAN_JOB.requiredPermission = OPPORTUNITY_DUPLICATE_SCAN_JOB`.
- `OPPORTUNITY_CATALOG_RECONCILE_JOB.requiredPermission = OPPORTUNITY_CATALOG_RECONCILE_JOB`.
- `OPPORTUNITY_DUPLICATE_REVIEW` continua reservado à decisão humana.
- Nenhum evento, capability, migration ou perfil produtivo adicional é criado.

## Limites preservados

Esta decisão só autoriza composição e gates locais. F4.4/F4.5, persistence produtiva F5, providers externos, rollout e deploy continuam fora do âmbito.
