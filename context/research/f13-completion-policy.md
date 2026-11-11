# F13 — Completion policy

- Estado: **Proposta — requer aprovação humana**
- Feature: `F13 — Perfil organizacional para matching`
- Questão: quando uma versão e um snapshot estão suficientemente completos para aprovação, publicação, ativação e consumo determinístico pela F14?
- Data: 2026-10-10

## Decisão a suportar

Definir completude sem a confundir com verdade, qualidade, verificação, elegibilidade ou utilidade para todas as oportunidades. A policy deve admitir desconhecimento legítimo, impedir snapshots estruturalmente vazios e produzir resultados reproduzíveis entre tenants e releases.

Esta investigação não define matching, scoring, eligibility ou requisitos de uma oportunidade e não transforma `READY` numa promessa de compatibilidade F14.

## Evidência interna

### Contratos aprovados

- Ausência significa apenas “não materializado”; não equivale a `UNKNOWN`, `NONE`, `NOT_APPLICABLE`, zero, falso ou vazio.
- Drafts podem omitir slots quando o schema permitir. Snapshots publicados materializam valor ou estado explícito para todos os slots exigidos pela completion policy.
- Knowledge, verification, conflict, lifecycle, projection e confidentiality são dimensões independentes. Completion não pode usar truthiness.
- `WITHHELD` preserva um facto interno e apenas altera a projeção; não equivale a `UNKNOWN` e não pode tornar o conteúdo internamente incompleto.
- Slots obrigatórios `DISPUTED`, `CONFLICTED`, `EXPIRED` ou `REVOKED` não tornam o snapshot consumível pela F14.
- A baseline `ORGANIZATION` é obrigatória; overlays são opcionais e ligados a uma baseline exata. Domínios autorizam scopes diferentes e `TEAM` não é universal.
- Approval congela uma revision e cria uma version imutável; publication torna-a elegível para activation, mas não ativa.
- A ativação v1 materializa sincronicamente todos os snapshots da coorte e só troca pointers depois de todos estarem `READY`.
- Overlays antigos não incluídos na nova coorte são desativados. Uma baseline nova não os rebasa nem permite que permaneçam ligados à baseline anterior.
- Conteúdo financeiro e outros valores restritos podem produzir projeções redigidas; completion tem de observar o conteúdo interno autorizado, não a projeção do consumidor.
- F14 consome exclusivamente snapshots `READY` com versions/digests/policies exatos e não recompõe conteúdo mutável.

### Consequência

O repositório já exige uma policy versionada, mas ainda não define slots, estados admissíveis, gates, resultado, findings ou compatibilidade. Essa ausência altera schema, activation e AC-07/20/32, pelo que continua blocker de readiness.

## Conceitos que não devem ser colapsados

| Dimensão | Pergunta respondida | Não prova |
|---|---|---|
| Validade estrutural | o payload obedece ao schema e referências? | que slots obrigatórios foram materializados |
| Completude editorial | todos os slots/policies aplicáveis têm valor ou estado admissível? | verdade ou verificação |
| Verificação | a assertion foi verificada pelo método exigido? | completude de outros slots |
| Qualidade | provenance/recência/consistência satisfazem policy própria? | elegibilidade |
| Readiness do snapshot | materialização e todas as policies aplicáveis passaram? | utilidade para qualquer oportunidade |
| Utilidade F14 | existem dados suficientes para uma regra concreta? | completion global F13 |

## Opções viáveis

| Critério | A. Tudo KNOWN+VERIFIED | B. Qualquer estrutura válida | C. Policy versionada por schema/scope/domain |
|---|---|---|---|
| Knowledge legítimo | rejeita UNKNOWN/N/A | aceita ausência silenciosa | estados permitidos por slot |
| Incentivo à qualidade | incentiva dados inventados | não cria mínimo editorial | exige materialização explícita |
| Verificação | confunde dimensão separada | pode ignorá-la | requirement próprio por slot |
| Consistência entre tenants | rígida e impraticável | deriva elevada | policy/release comum e explícita |
| Overlays | bloqueio generalizado | snapshots vazios | policies aplicáveis por scope/domain |
| Reprodução | alta mas semanticamente errada | baixa utilidade | policy+inputs+findings digestados |
| F14 | falsa promessa de suficiência | excesso de indeterminado | READY sem promessa universal |
| Evolução N/N-1 | difícil | indefinida | matriz explícita schema/policy/consumer |

**A é rejeitada** porque contradiz a política epistemológica e incentiva falsa certeza. **B é rejeitada** porque estrutura válida não garante um contrato consumível. Recomenda-se **C**.

## Recomendação

Adotar uma `CompletionPolicy` publicada, imutável e versionada, selecionada por uma chave fechada que inclui `profile_schema_version`, `scope_type` e `domain_code`. A release do schema declara exatamente quais policies são aplicáveis; o caller não escolhe nem omite policies.

### Resultado

- Resultado fechado: `COMPLETE|INCOMPLETE`.
- Não existe score, percentagem, nível “quase completo” ou threshold configurável pelo tenant.
- `INCOMPLETE` contém findings estruturados, determinísticos e ordenados; `COMPLETE` pode preservar contagens sanitizadas, mas não um score.
- Completion é calculada sobre o conteúdo semântico interno integral antes de qualquer projection/redaction.
- `READY` significa exclusivamente: snapshot materializado, referências/digests validados e todas as completion policies aplicáveis em `COMPLETE`.
- `READY` não significa verdade universal, todos os dados verificados, elegibilidade nem suficiência para qualquer regra F14.

### Modelo conceptual mínimo

```text
CompletionPolicy {
  policy_id / policy_version
  profile_schema_version
  scope_type
  domain_code
  slot definitions
  allowed knowledge / verification / conflict / lifecycle states
  reason-code requirements
  inter-slot constraints
  compatible taxonomy/catalog releases
  lifecycle: PUBLISHED | SUPERSEDED | ARCHIVED
  policy_digest
}

CompletionEvaluation {
  profile/draft/version/snapshot reference
  policy_id / version / digest
  input_semantic_digest
  result: COMPLETE | INCOMPLETE
  ordered findings
  evaluated_at / evaluator_contract_version
  result_digest
}

CompletionFinding {
  slot_code
  observed_state_code
  requirement_code
  result_code
  reason_code
}
```

Findings não transportam valores, evidence content, PII ou dados restritos. Os nomes são candidatos e não constituem schema aprovado.

## Slots e regras

Cada policy publica uma lista fechada de slots. Um slot define:

- cardinalidade e se é obrigatório no scope/domain;
- states de knowledge permitidos;
- se `KNOWN` exige value/value_ref e release/catalog específicos;
- se `UNKNOWN`, `NONE` ou `NOT_APPLICABLE` são admissíveis e quais reason codes exigem;
- verification states admitidos e, quando aplicável, método/validity;
- conflict/lifecycle states permitidos;
- confidentiality/projection constraints relevantes para materialização;
- referências e constraints inter-slot;
- regra de canonicalização e código de finding.

Não materializado falha quando o slot é obrigatório, mesmo que `UNKNOWN` fosse admissível: o estado tem de ser explicitamente materializado. `UNKNOWN` pode satisfazer completion quando a policy o admite com reason/provenance, mas uma futura regra F14 ainda pode produzir resultado indeterminado.

### Matriz epistemológica recomendada

| Estado observado | Pode satisfazer completion? | Condição |
|---|---|---|
| `KNOWN` | sim | value/ref válido; release e invariantes do slot passam |
| `UNKNOWN` | sim, por slot | explicitamente permitido; reason/provenance obrigatórios |
| `NONE` | sim, por slot | semanticamente permitido; autoridade/período/provenance |
| `NOT_APPLICABLE` | sim, por slot | reason code permitido e coerência inter-slot |
| ausência/não materializado | não em slot obrigatório | nunca convertido implicitamente em UNKNOWN |
| `WITHHELD` | não altera o resultado interno | facto interno é avaliado; projection policy é separada |
| `UNVERIFIED` | sim, por slot | apenas quando verification não é requisito de completion |
| `VERIFIED` | sim | método, verifier, timestamp e validity válidos quando exigidos |
| `NOT_REQUIRED` | sim, por slot | policy declara verification dispensada |
| `DISPUTED` | não em slot aplicável obrigatório | finding fechado; bloqueia READY |
| `CONFLICTED` | não em slot aplicável obrigatório | não pode escolher assertion por precedência |
| `EXPIRED` | não como corrente | histórico preservado; exige nova assertion/state permitido |
| `REVOKED` | não como corrente | histórico preservado; não satisfaz slot |

Para domínios/slots opcionais não aplicáveis ao scope, a ausência só é aceitável se a policy não os declarar aplicáveis. Não existe “partial READY”: o conjunto aplicável é resolvido antes da avaliação.

## State e gate matrix

| Gate | Verificações mínimas | Resultado permitido |
|---|---|---|
| Guardar Draft revision | schema estrutural, códigos e references conhecidas onde presentes, scope autorizado | Draft pode permanecer incompleto |
| Submit para aprovação | estrutura integral, policy set resolvido, evaluation determinística | recomendação: exige `COMPLETE`; findings devolvidos se não |
| Approval | revision/digest exatos, evaluation `COMPLETE`, maker-checker, policy ainda publicada/compatível | cria version imutável |
| Publication | revalida digests/references/policy compatibility e stale approval; não altera conteúdo | version `PUBLISHED`, ainda inativa |
| Materialização da coorte | compõe baseline+overlay, resolve policies aplicáveis, valida references/releases e avalia snapshot efetivo | só produz `READY` se todas passam |
| Activation cutover | todos os snapshots da coorte `READY`, digests/policies/schema atuais e compatíveis, F5/SoD/assurance/CAS | swap atómico ou nenhuma alteração |
| Consumo F14 | snapshot ativo `READY` e consumer contract compatível | consumo permitido; utilidade por regra continua F14 |

Exigir `COMPLETE` no submit evita que o aprovador congele uma revision que nunca pode ser publicada. Rejeição editorial continua possível sobre a revision submetida; Drafts incompletos continuam editáveis e historicamente preservados.

## Coortes e overlays

- A baseline é sempre membro obrigatório e tem de passar as policies ORG aplicáveis.
- Um overlay incluído na coorte tem de passar as policies do seu scope/domain depois da composição com a baseline exata.
- Overlay incompleto não pode ser silenciosamente ignorado, permanecer na baseline anterior ou produzir snapshot parcial.
- O comando de ativação pode excluir explicitamente esse overlay da coorte; conforme a decisão aprovada, qualquer overlay ativo anterior não incluído é desativado no cutover.
- Se o overlay foi declarado membro da coorte e falha completion, toda a materialização/cutover falha sem alterar pointers.
- A origem baseline/overlay de cada slot/finding permanece identificável para diagnóstico e digest.

## Catálogos, releases e depreciação

- Completion valida que concept/release/catalog/policy referenciados existem, pertencem ao namespace esperado e são compatíveis com o schema/policy.
- Conceito deprecated continua válido em snapshots históricos. Uma nova version só o pode usar quando a policy publicada o admitir explicitamente; não há substituição automática.
- Catálogo sem seed/release obrigatório impede `COMPLETE`; não é convertido em UNKNOWN do perfil.
- Mapping ausente não invalida um facto original quando o slot aceita unmapped, mas deve produzir o state/reason explícito exigido pela policy.
- Atualizar catálogo ou policy não reavalia nem invalida snapshots históricos. Nova activation usa policy/release atual compatível e cria novo snapshot/evaluation.

## Digests, CAS e idempotência

- `policy_digest` cobre a representação canónica integral da policy publicada.
- `input_semantic_digest` cobre a versão/revision ou composição efetiva e todas as references/releases observadas.
- `result_digest` cobre policy ID/version/digest, input digest, resultado e findings ordenados.
- A mesma intenção com a mesma key e digests converge no mesmo resultado; key igual com digest diferente conflita.
- Approval e activation usam expected revision/pointer/CAS. Mudança de revision, policy, reference ou digest após avaliação torna a avaliação stale e falha fechado.
- Maker-checker aprova a revision e os digests avaliados; não uma versão reconstruída posteriormente.

## Compatibilidade N/N-1

A matriz de release deve declarar tuples permitidas:

```text
(profile_schema_version,
 completion_policy_version,
 taxonomy/catalog release set,
 snapshot_contract_version,
 consumer_contract_version)
```

- Writer N não publica combinação ausente da matriz.
- F14 N só consome snapshots cuja tuple esteja declarada compatível; desconhecida falha antes da avaliação.
- Suporte temporário N-1 não transforma ou reescreve snapshots. Usa o contrato/digest original ou recusa.
- Nova policy nunca invalida retroativamente `READY`; apenas novas materializações/ativações usam a policy selecionada pela release atual.
- A matriz concreta continua um blocker separado; esta investigação define a forma da compatibilidade, não os pares finais.

## Erros, F7 e F10

Categorias públicas existentes são suficientes se especializadas por reason codes fechados:

- `INVALID_INPUT`: shape/state/código inválido;
- `COMPLETENESS_REQUIRED`: evaluation `INCOMPLETE`, com findings autorizados e sanitizados;
- `INCOMPATIBLE_VERSION`: tuple schema/policy/catalog/consumer não suportada;
- `STATE_CONFLICT`: reference, conflict state ou gate incompatível;
- `STALE_REVISION`: revision/digest/policy mudou;
- `IDEMPOTENCY_CONFLICT`: key reutilizada com intenção diferente.

F7 deve registar evaluation executada/recusada, approval/publication recusada por completion e activation/cutover, preservando policy/version/digests, outcome e códigos agregados sem valores. Evaluation puramente read-only pode ser observacional; a decisão/mutação crítica e respetivo F7 continuam source-local e atómicos.

F10 pode emitir contadores/latência por `scope_type`, `domain_code`, `policy_version`, gate, outcome e reason-code allowlisted. Não inclui tenant IDs de alta cardinalidade, slot values, assertion IDs, evidence refs, digests ou conteúdo de findings.

## Prova esperada

- corpus fixo versionado com um caso por slot/state/reason e golden findings ordenados;
- unit/property tests sobre combinações válidas/inválidas, canonicalização, determinismo e ausência de truthiness;
- mutation tests que removam um slot, permitam state proibido, ignorem conflict ou avaliem projection em vez do estado interno;
- PostgreSQL 17 para constraints, immutability, FK/release compatibility, CAS, idempotência e concorrência;
- integração de coorte com baseline e overlays: falha pré-cutover, rollback integral e commit atómico;
- A/B RLS/IDOR, restricted projections e ausência de side channels;
- structural gates que recusem score/percentagem, defaults implícitos e bypass da policy publicada.

## Invariantes propostas

1. Apenas policy publicada e imutável participa numa avaliação normativa.
2. O policy set aplicável é derivado server-side de schema/scope/domain.
3. Completion usa conteúdo interno, nunca projection redigida.
4. Resultado é apenas `COMPLETE|INCOMPLETE`, com findings determinísticos e sem score.
5. Slot obrigatório ausente falha; estado explícito permitido pode passar sem ser KNOWN/VERIFIED.
6. `WITHHELD` não altera knowledge nem completion interna.
7. `DISPUTED|CONFLICTED|EXPIRED|REVOKED` não satisfazem slot corrente obrigatório.
8. Snapshot só chega a `READY` quando todas as policies aplicáveis passam.
9. `READY` não promete elegibilidade nem utilidade universal F14.
10. Overlay incluído incompleto falha a coorte; overlay omitido é explicitamente desativado no cutover.
11. Policy/reference/digest stale falha antes de approval/publication/activation.
12. Histórico nunca é reavaliado, invalidado ou reescrito por policy nova.

## Impacto nos critérios F13

- `F13-AC-04/05`: Draft incompleto é permitido, mas schemas/states/policies desconhecidos são recusados.
- `F13-AC-06/07`: approval congela revision completa; publication não ativa e cutover exige snapshots `READY`.
- `F13-AC-08`: coorte mantém unique pointers e desativa overlays omitidos.
- `F13-AC-10/11`: revision/policy digests, CAS e idempotency impedem stale/lost updates.
- `F13-AC-20`: estados epistemológicos são avaliados explicitamente, sem truthiness.
- `F13-AC-22/24`: F7/F10 preservam outcome/reason codes sem conteúdo sensível.
- `F13-AC-29`: qualquer failure na materialização preserva pointers anteriores.
- `F13-AC-30`: completion não produz score, matching ou eligibility.
- `F13-AC-32`: snapshot READY fixa policy/schema/catalog/digests e consumer compatibility.

Nenhum critério passa por esta investigação; a recomendação continua sujeita a aprovação humana.

## Riscos e decisões humanas restantes

1. Aprovar opção C, resultado binário e ausência de score/percentagem.
2. Aprovar `COMPLETE` como requisito de submit, approval, publication e snapshot READY.
3. Aprovar a matriz de states acima, incluindo UNKNOWN permitido por slot e bloqueio de disputed/conflicted/expired/revoked.
4. Aprovar exclusão explícita de overlays incompletos com desativação dos antigos, sem partial READY.
5. Definir slots, domains, reason codes e inter-slot constraints concretos por schema release.
6. Definir catálogo de classes/confidentiality/projection para findings e valores restritos.
7. Fechar a matriz N/N-1 concreta entre schema, policy, catalogs, snapshot e consumer.
8. Definir event codes F7 e labels F10 finais dentro dos contratos aprovados.

## Fontes internas

- `context/features/f13-organizational-profile.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-financial-capacity.md`
- `context/decisions/f13-operational-capacity.md`
- `context/decisions/f13-exclusions-vs-f14-rules.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f10-operational-observability.md`
- `context/references/logical-data-dictionary.md`

Não foram necessárias fontes externas: lifecycle, states, coortes, digests e fronteiras são contratos internos já aprovados. Esta recomendação não constitui decisão aprovada nem autoriza implementação.
