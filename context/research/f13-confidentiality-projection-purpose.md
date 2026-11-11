# F13 — Confidencialidade, projection, reason e purpose

- Estado: **Proposta — requer aprovação humana**
- Feature: `F13 — Perfil organizacional para matching`
- Questão: como classificar dados e controlar projeções, razões e finalidades sem criar autorização implícita, alterar semântica ou introduzir side channels?
- Data: 2026-10-10

## Decisão a suportar

Definir classes de confidencialidade, projection policies e catálogos de purpose/reason que componham com F5, F7, F10 e F11. Classificação descreve sensibilidade; nunca concede acesso. Projection controla representação; nunca altera o facto interno.

Não entram nesta investigação UI, IdP/provisioning produtivo, retenção operacional, legal hold operacional ou regras F14.

## Evidência interna

### Contratos existentes

- F5 é deny-by-default e autoriza por operation, permission, resource server-loaded, scope, estado, sensitivity e assurance. O caller não fornece atributos confiáveis.
- A decisão F13 já separa `F13_PROFILE_READ`, `F13_RESTRICTED_VALUE_READ`, `F13_EVIDENCE_LINK_READ`, `F13_PROFILE_EXPORT_FULL` e `F13_PROFILE_EXPORT_REDACTED`. Restricted read e qualquer export exigem `RECENT_MFA`, reason, purpose e F7.
- F7 exige catálogo fechado, payload validado, eventos source-local para ações críticas, deny-preserving e ausência de PII, documentos, secrets ou conteúdo integral.
- F10 admite apenas signals e labels fechadas de baixa cardinalidade; proíbe IDs, valores livres, conteúdo e dados sensíveis.
- F11 separa metadata documental, autorização e conteúdo. Uma referência F13 não concede leitura do documento nem promove evidence a `VERIFIED`; acesso ao conteúdo continua sob operations F11.
- F12 usa respostas/erros sanitizados, RLS/IDOR e snapshots imutáveis. Requisitos de oportunidade não autorizam acesso a valores privados do perfil.
- A policy epistemológica separa `DISCLOSED|WITHHELD` de knowledge e confidentiality, preserva semantic/projection digests e proíbe expor `semantic_digest` quando criar side channel.
- Completion é calculada sobre o estado interno integral, antes da projection. `WITHHELD` não torna o facto incompleto.
- Financeiro exige acesso mais restrito para valores exatos/evidence do que para bandas/projeções; operacional exige proteção de small counts e risco de reidentificação.
- Não foi encontrado um catálogo F13 aprovado de classes, projection modes, purpose codes ou reason codes. Estes continuam uma decisão, apesar de as operações e invariantes F5/F7 já estarem aprovadas.

### Dimensões independentes

| Dimensão | Pergunta | Não substitui |
|---|---|---|
| Classification | quão sensível é o dado? | autorização |
| F5 operation/grant | este actor pode executar esta ação neste resource/scope? | purpose ou projection |
| Purpose | para que finalidade aprovada ocorre o acesso? | razão concreta |
| Reason | por que esta ação/mutação ocorre agora? | grant |
| Projection policy | que representação pode sair nesta operação? | conteúdo semântico interno |
| Export mode | pode ser extraído e em que forma? | leitura interativa |

## Opções viáveis

| Critério | A. Flag por campo | B. ACL por assertion/valor | C. Classes + projection policies + F5 |
|---|---|---|---|
| Semântica | binária e insuficiente | mistura dado/identidade | dimensões separadas |
| Administração | simples, mas inconsistente | explosão/deriva de grants | catálogos e policies governados |
| Snapshot histórico | redaction ad hoc | ACL mutável afeta reprodução | policy/version/digest preservados |
| Exports | difícil de diferenciar | grants por item | operations e projections próprias |
| Side channels | pouco controlados | existence/grant leaks | política conjunta de representação |
| Least privilege | grosseiro | granular mas impraticável | resource attributes + F5 + purpose |
| N/N-1 | flag sem contrato | matriz enorme | tuple explícita policy/consumer |

**A é rejeitada** por não representar modos e operações diferentes. **B é rejeitada** porque transforma cada valor num objeto administrativo e cria deriva. Recomenda-se **C**.

## Recomendação

Adotar classes fechadas, independentes da autorização, com mínimo definido pela policy do slot/domínio. F5 autoriza a operação; purpose/reason validam o contexto; uma `ProjectionPolicy` publicada seleciona server-side o modo de saída. Nenhuma dimensão, isoladamente, autoriza acesso.

### Classes v1 propostas

- `INTERNAL`: informação institucional normal, acessível apenas por operations/grants tenant autorizados. Não significa pública nem disponível a toda a membership.
- `RESTRICTED`: informação com sensibilidade financeira, operacional, estratégica ou de evidence que exige operação específica, `RECENT_MFA` quando definida e auditoria de acesso.
- `HIGHLY_RESTRICTED`: informação excecional cuja revelação pode expor segredo comercial, pequenos grupos, populações vulneráveis ou metadata sensível; default de projection é `OMITTED` salvo policy e grant explícitos.

Não incluir `PUBLIC` na v1. F13 não possui um caso aprovado de publicação anónima na Internet. Se surgir, deve distinguir publicabilidade de mera leitura tenant e exigir decisão própria.

### Atribuição e effective classification

- A policy do domínio/slot define a classificação mínima e se uma assertion/value pode elevar a classe.
- O caller nunca escolhe uma classe abaixo do mínimo. Ausência de classe ou policy desconhecida falha fechado, usando o mínimo mais restritivo definido para o slot, não um default global permissivo.
- A effective classification é o máximo governado entre slot, assertion/value, derivação e evidence reference. Não se infere acesso ao documento F11 a partir dessa classe.
- Overlay pode manter ou elevar classificação, nunca baixar a classificação herdada.
- Classificação publicada faz parte da versão imutável. Reclassificação cria nova revision/version e, por afetar exposição, exige grant específico aplicável, maker-checker, `RECENT_MFA`, reason e F7. Não reescreve snapshots anteriores.
- Evidence F11 conserva classificação/autorização próprias; F13 guarda apenas referência/projection permitida e nunca replica filename, object key ou conteúdo sem contrato aprovado.

## Projection modes

Modos técnicos v1 propostos:

- `EXACT`: representação autorizada do valor interno, ainda sujeita a minimização e schema de saída.
- `DERIVED`: banda, categoria, intervalo ou resumo produzido por derivation policy publicada; não permite reconstrução do exact value dentro do risco aprovado.
- `REDACTED`: marcador/estrutura sanitizada que preserva apenas informação explicitamente permitida, podendo apresentar `WITHHELD`.
- `OMITTED`: campo/elemento não é incluído e a resposta não confirma existência.

`DISCLOSED|WITHHELD` continua a dimensão semântica apresentada. Os quatro modes são mecanismos técnicos de projection. `WITHHELD` só aparece quando a policy autoriza confirmar que existe conteúdo; caso essa confirmação crie side channel, usa-se `OMITTED` e respostas indistinguíveis.

Cada `ProjectionPolicy` é publicada, imutável e versionada e contém:

- operation e permission compatíveis;
- resource/scope/domain e classification;
- purposes admitidos;
- mode por slot/campo composto;
- derivation/redaction policy version;
- cardinality, ordering, pagination e error policy;
- export allowance e schema;
- semantic input contract, projection canonicalization e digest;
- consumer compatibility e lifecycle.

O servidor seleciona a policy por operation, resource attributes, purpose, effective classification e release. O caller pode declarar apenas um purpose code permitido pela operação; nunca escolhe mode ou policy mais permissiva.

## Matriz classification × operation × projection

| Operation | INTERNAL | RESTRICTED | HIGHLY_RESTRICTED | Assurance/auditoria |
|---|---|---|---|---|
| `F13_PROFILE_READ` | `EXACT` ou `DERIVED` conforme slot | `DERIVED|REDACTED|OMITTED` | `OMITTED` por defeito | NORMAL; acesso normal conforme F7 policy |
| `F13_RESTRICTED_VALUE_READ` | `EXACT` se necessário | `EXACT|DERIVED` | `EXACT` apenas por policy/grant/purpose explícitos; senão omitted | `RECENT_MFA`, reason+purpose, F7 |
| `F13_EVIDENCE_LINK_READ` | metadata mínima F13 | metadata redigida/omitted | omitted por defeito | conteúdo exige F11 separadamente |
| `F13_PROFILE_EXPORT_REDACTED` | exact/derived autorizado | derived/redacted/omitted | omitted | `RECENT_MFA`, reason+purpose, F7 |
| `F13_PROFILE_EXPORT_FULL` | exact autorizado | exact/derived autorizado | exact somente por policy explícita | `RECENT_MFA`, reason+purpose, F7 e manifesto |

Esta matriz não concede grants. A decisão F5 continua a preceder projection. “Full” significa completo dentro da policy autorizada, não bypass de classification, F11 ou minimização.

## Purpose catalog inicial proposto

Purpose descreve a finalidade legítima e estável do uso, não a ação técnica. Catálogo v1 mínimo:

- `PROFILE_GOVERNANCE`: criação, revisão, approval, publication e activation do perfil;
- `ASSERTION_VERIFICATION`: verificação ou resolução governada de assertion/evidence;
- `INTERNAL_DECISION_SUPPORT`: consulta institucional autorizada sem executar F14;
- `AUDIT_COMPLIANCE_REVIEW`: revisão de auditoria/conformidade autorizada;
- `AUTHORIZED_EXPORT`: produção de export aprovado para destinatário/finalidade registados.

Um purpose futuro para consumo F14 só pode ser adicionado quando F14 for aprovada; esta investigação não o cria nem concede. O servidor valida purpose contra operation/resource/classification e stable actor. Service actors só podem usar purposes explicitamente associados ao seu operation catalog e nunca ações humanas sensíveis.

## Reason catalog inicial proposto

Reason explica a ocorrência concreta e é validado por família de operação:

### Mutação/governance

- `INITIAL_DECLARATION`;
- `PERIODIC_REVIEW`;
- `SOURCE_CORRECTION`;
- `POLICY_OR_CATALOG_CHANGE`;
- `DISPUTE_RESOLUTION`;
- `REVOCATION_OR_EXPIRY`;
- `SCOPE_LIFECYCLE_CHANGE`.

### Leitura restrita/verificação

- `VERIFY_ASSERTION`;
- `REVIEW_PROFILE_VERSION`;
- `INVESTIGATE_DISPUTE`;
- `AUDIT_REQUEST`.

### Export

- `INTERNAL_GOVERNANCE_EXPORT`;
- `COMPLIANCE_REQUEST`;
- `AUTHORIZED_DISCLOSURE`.

Reason e purpose nunca são texto livre. A combinação é fechada por operation: por exemplo, `AUDIT_REQUEST + AUDIT_COMPLIANCE_REVIEW` pode permitir restricted read, mas não mutation; `AUTHORIZED_DISCLOSURE + AUTHORIZED_EXPORT` não autoriza por si só full export.

Nem todas as leituras exigem reason/purpose. Leitura redigida normal usa purpose implícito fechado da própria operation/session policy, sem input livre; restricted read e todos os exports exigem códigos explícitos, conforme decisão F13 já aprovada. Mutations sensíveis/reclassification usam reason; purpose é exigido quando o catálogo F5 assim o declarar.

## Side channels e equivalência entre superfícies

- API, ecrã e export chamam o mesmo projection service/policy; não mantêm redaction paralela.
- Not-found/forbidden/omitted seguem respostas uniformes e não revelam existência cross-tenant ou sem grant.
- Count, total, ordering, grouping, cursor, page size e presence markers são campos da projection policy. Elementos omitidos não alteram totals visíveis de forma que revele cardinalidade restrita.
- Campos compostos são projetados atomicamente ou segundo subfields fechados; não se deixam moedas, unidades, períodos ou labels reconstruírem valores omitidos.
- Derivations têm buckets/policies aprovados e testes de não reconstrução; bandas demasiado estreitas ou grupos pequenos elevam classification ou usam omitted.
- Erros, timing e tamanho de resposta são normalizados dentro de limites defensáveis; existence checks usam o mesmo resource loader/authorization antes da projection.
- `semantic_digest` nunca é exposto quando permite comparação/inferência. `projection_digest` só cobre a representação autorizada e a exact policy version.

## Digests e histórico

- `semantic_digest` cobre o conteúdo interno canónico, incluindo effective classification, sem passwords/document content.
- `projection_digest` cobre operation, purpose class permitido, projection policy/version/digest, mode, canonical output e referências de snapshot autorizadas.
- Projeções diferentes do mesmo snapshot têm projection digests diferentes, mas não alteram semantic digest.
- Nova projection policy não reescreve output histórico guardado nem snapshot. Uma nova resposta identifica a policy atual compatível; exports históricos preservam manifesto/policy/digest originais.
- Reclassificação, derivation policy ou redaction semanticamente relevante exige nova version/snapshot quando afeta conteúdo corrente; nunca mutação in-place.

## F5, F7, F10 e F11

### F5

- F5 autoriza antes da projection e carrega classification, state, scope e resource server-side.
- Exact/restricted/evidence/full-export continuam operations distintas; bundles/roles não concedem autoridade implícita.
- Reclassification precisa de enquadramento explícito no resource/action catalog antes da implementação; não se assume que draft edit sozinho autorize downgrade.
- `RECENT_MFA` mantém-se obrigatório para restricted values, verification, reclassification sensível e exports.

### F7

- Restricted read/export/reclassification produz evento com actor/human subject, operation, resource/scope, classification, projection policy/version, purpose/reason, assurance, result e correlation/idempotency quando aplicável.
- Deny audit preserva a recusa e usa identifiers/codes sanitizados sem confirmar existência.
- Eventos nunca incluem value, document metadata sensível, query, output, PII, semantic digest exposto ou texto livre de purpose/reason.

### F10

- Labels permitidas: operation code, classification, projection mode, outcome, policy version bounded e reason family allowlisted.
- Proibidos tenant/resource/assertion IDs, values, purpose de alta cardinalidade, evidence refs, digests e conteúdo.
- Métricas agregam latência/contagem/drop/deny sem substituir F7.

### F11

- F13 evidence link não concede leitura do documento. O conteúdo exige F11 operation/capability própria, estado `AVAILABLE+CLEAN` e respetivo audit.
- Projection F13 não inclui filename, object key, signed URL, hash ou metadata documental não aprovada.
- Quarantine ou acesso F11 indisponível não é contornado por export F13.

## Compatibilidade N/N-1

A tuple de compatibilidade deve incluir:

```text
(profile_schema_version,
 confidentiality_catalog_version,
 projection_policy_version,
 purpose_catalog_version,
 reason_catalog_version,
 snapshot/projection_contract_version,
 consumer_operation_catalog_version)
```

- Startup valida unicidade, referências, operation/mode/classification, schemas e digests de todos os catálogos.
- Policy/catalog desconhecido bloqueia restricted read/export/projection; não cai para exact ou redaction ad hoc.
- N pode ler N-1 apenas se a tuple declarar mapping semântico lossless ou projection segura. Não existe upcast implícito.
- Nova projection policy não altera snapshots, completion ou exports históricos; novas respostas identificam a versão efetivamente usada.

## Retenção e legal hold

Retention/legal hold produtivos continuam fora do âmbito, mas o contrato preserva classification, provenance, access/export audit e referências de policy necessárias a uma decisão futura. Classification não define prazo de retenção nem autoriza eliminação; legal hold futuro terá precedência sobre ações destrutivas sem alterar projection sem decisão própria.

## Erros públicos

Categorias existentes podem cobrir a fronteira com reason codes fechados:

- `AUTHORIZATION_REQUIRED`: grant/assurance/purpose ausente, sem confirmar recurso;
- `INVALID_INPUT`: purpose/reason desconhecido ou combinação impossível;
- `INCOMPATIBLE_VERSION`: catalog/policy/consumer incompatível;
- `RESOURCE_NOT_AVAILABLE`: resposta uniforme para inexistente, oculto ou indisponível;
- `STATE_CONFLICT`: reclassification/projection incompatível com lifecycle;
- `STALE_REVISION`: policy/resource revision avançou.

Mensagens não distinguem “existe mas está hidden” de “não existe” quando essa distinção não é autorizada.

## Invariantes propostas

1. Classification nunca concede permission.
2. F5 authorization precede purpose validation detalhada e projection de conteúdo.
3. Slot policy define minimum classification; overlay/edição não baixa esse mínimo.
4. Classification publicada é imutável; reclassification cria version e audit.
5. Projection policy é publicada, imutável, versionada e selecionada server-side.
6. Caller não escolhe mode, policy ou classificação mais permissiva.
7. `WITHHELD` é presentation meaning; `OMITTED` é mecanismo sem existence disclosure.
8. Semantic e projection digests são distintos e não permitem side channel.
9. Screen/API/export usam a mesma projection policy.
10. Purpose e reason são códigos fechados, distintos e operation-scoped.
11. Restricted read e qualquer export exigem reason, purpose, `RECENT_MFA` e F7.
12. Evidence content permanece sob F11, nunca sob uma projection F13.
13. Policy/catalog incompatível falha fechado sem fallback.

## Prova esperada

- unit/property tests da matriz operation/classification/purpose/mode, monotonic classification e canonical digests;
- corpus de side channels: count, order, pagination, error, timing, existence, screen/export divergence e fields compostos;
- mutation tests que permitam caller-selected mode, downgrade, missing MFA/reason/purpose ou exact fallback;
- RLS/IDOR A/B e probes PostgreSQL sobre resource loading, classification e audit source-local;
- F11 negative tests que provem ausência de document-content access;
- F7 payload scans e deny-preserving; F10 label/cardinality guards;
- N/N-1 startup validation e rejection de catalog/policy desconhecido;
- exports full/redacted com manifests e digests diferentes, sem reconstrução de restricted values.

## Impacto nos critérios F13

- `F13-AC-02/25`: respostas/projections não enumeram dados ou tenants.
- `F13-AC-05`: classes, modes, purposes, reasons e tuples desconhecidas são recusadas.
- `F13-AC-06/09`: classification/policies/exports publicados são imutáveis e históricos.
- `F13-AC-12`: actor, purpose, reason, policy e provenance permanecem auditáveis.
- `F13-AC-16/17/20`: financeiro, operacional, knowledge e withheld conservam semântica interna sob redaction.
- `F13-AC-21`: operations distintas e assurance controlam redacted/restricted/evidence/export.
- `F13-AC-22`: acessos/mutações críticos produzem F7 sanitizado.
- `F13-AC-24`: F10 usa labels fechadas e baixa cardinalidade.
- `F13-AC-30/32`: projection não executa matching e F14 só receberá contrato autorizado/versionado futuro.

Nenhum critério passa por esta investigação; a recomendação continua sujeita a aprovação humana.

## Riscos e decisões humanas restantes

1. Aprovar classes `INTERNAL|RESTRICTED|HIGHLY_RESTRICTED` e ausência de `PUBLIC` v1.
2. Aprovar modes `EXACT|DERIVED|REDACTED|OMITTED` e a distinção entre `WITHHELD` e omission.
3. Aprovar a matriz inicial por operation/classification e a regra de effective maximum classification.
4. Aprovar purpose e reason catalogs iniciais, incluindo a ausência de purpose F14 antes dessa feature.
5. Decidir se reclassification precisa de nova operation F5 ou pode ser uma ação sensível de draft edit com constraint própria.
6. Definir policies concretas para valores financeiros, small counts, grupos vulneráveis e evidence metadata.
7. Definir thresholds anti-reidentificação e timing/size normalization mensuráveis como implementação/policy content.
8. Fechar a tuple N/N-1 concreta juntamente com o blocker final de compatibilidade.

## Fontes internas

- `context/features/f13-organizational-profile.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-completion-policy.md`
- `context/decisions/f13-financial-capacity.md`
- `context/decisions/f13-operational-capacity.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f10-operational-observability.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`

Não foram necessárias fontes externas: autorização, audit, observability, documents, knowledge e projection são contratos internos já aprovados. Esta recomendação não constitui decisão aprovada nem autoriza implementação.
