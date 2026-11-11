# F13 — Fronteira entre exclusões declaradas e regras F14

- Estado: **Proposta — requer aprovação humana**
- Feature: `F13 — Perfil organizacional para matching`
- Questão: que informação de exclusão pode ser publicada pela F13 sem transformar o perfil num motor de elegibilidade ou matching?
- Data: 2026-10-10

## Decisão a suportar

Determinar a fronteira entre constraints institucionais versionadas que pertencem ao perfil F13 e regras executáveis que comparam esse perfil com uma oportunidade na F14.

Esta investigação não inicia a F14, não define scoring, pesos ou elegibilidade por aviso e não autoriza SQL, JavaScript, JSON Logic ou qualquer DSL fornecida pelo caller.

## Evidência do repositório e decisões aprovadas

### Factos estabelecidos

- `context/features/matching-and-qualification.md` atribui ao matching: avaliar elegibilidade obrigatória, produzir exclusão/alerta por incompatibilidade, preservar informação desconhecida e só depois calcular score. Esta sequência pertence à futura F14.
- O modelo lógico aprovado separa `scoring_profile_version`, `organization_profile_version`, `eligibility_result`, resultados por critério e missing information. A avaliação é imutável e referencia as versões usadas.
- A F13 publica apenas snapshots `READY`; a F14 não recompõe perfil a partir de estado mutável.
- A decisão de âmbito/herança já estabelece que exclusões da baseline não podem ser relaxadas por overlays e que valores locais só podem ser adicionais ou mais restritivos conforme contrato fechado.
- A política epistemológica proíbe transformar ausência, `UNKNOWN` ou `WITHHELD` em `NONE`, falso ou incompatibilidade. `DISPUTED`, `CONFLICTED`, `EXPIRED` e `REVOKED` impedem consumo corrente quando o slot é obrigatório.
- A F13 já distingue factos temáticos, competências, experiência, capacidade, território e classificação institucional. Nenhum desses factos executa matching por si próprio.
- F5/F7 já fornecem edição, submissão, aprovação, publicação, ativação, dispute, conflict resolution e revoke em resources server-loaded. Não existe uma operação para publicar código executável ou regras arbitrárias.
- F12 preserva requisitos e exclusões da oportunidade no snapshot/revisão. Esses dados não pertencem ao perfil institucional e não podem ser copiados para uma exclusão F13 específica de um aviso.

### Distinções necessárias

| Informação | Proprietário | Exemplo semântico | Efeito permitido |
|---|---|---|---|
| Facto institucional | F13 | estatuto, capacidade, território, competência | preservar assertion e estado |
| Restrição legal/estatutária | F13 | atividade/território/categoria que a entidade não pode assumir | constraint declarativa governada |
| Indisponibilidade operacional | F13 | capacidade temporariamente indisponível | assertion temporal, não resultado de aviso |
| Exclusão voluntária | F13, se normativa | domínio em que a organização decidiu não participar | constraint aprovada e temporal |
| Preferência negativa | potencialmente F14 | baixa atratividade sem proibição | política/ponderação, não constraint factual |
| `UNKNOWN`/`WITHHELD` | F13 | falta de informação ou projeção redigida | estado epistemológico, nunca exclusão |
| Requisito/exclusão do aviso | F12 | beneficiário/território/capacidade exigidos | dado da oportunidade |
| Compatibilidade/elegibilidade | F14 | requisito comparado com snapshot | resultado executável versionado |

## Opções viáveis

| Critério | A. Regras executáveis F13 | B. Apenas factos | C. Constraints declarativas fechadas |
|---|---|---|---|
| Fronteira F13/F14 | quebra: F13 torna-se evaluator | clara, mas perde restrições não inferíveis | clara se F13 nunca avalia oportunidade |
| Expressividade | excessiva/aberta | insuficiente | limitada a catálogo aprovado |
| Reprodutibilidade | difícil com DSL/runtime | alta | alta por concepts, versions e digest |
| Segurança | injection/privilege/DoS | simples | fechada, sem código do caller |
| TOCTOU | regra e factos podem divergir | baixo | baixo com snapshot imutável |
| Herança | lógica arbitrária | inexistente | união monotónica baseline+overlay |
| Explicabilidade | mistura autor da regra e avaliação | não explica constraints próprias | F14 cita assertion F13 + regra F14 |
| Evolução | acopla releases | transfere tudo para F14 | catálogos F13 e rule releases F14 separados |

**A é rejeitada**: duplica a F14, introduz predicados arbitrários, expande a superfície de autorização e torna a reprodução dependente de runtime/DSL. **B é insuficiente**: uma proibição estatutária ou decisão institucional legítima pode não ser inferível de factos positivos. Recomenda-se **C**.

## Recomendação

Permitir na F13 `ExclusionAssertion` declarativas, tipadas e fechadas. Uma assertion declara uma constraint institucional sobre conceitos já governados; nunca contém uma oportunidade, query, expressão ou operador genérico e nunca calcula o resultado da comparação.

### Semântica v1 recomendada

- `PROHIBITED`: constraint normativa/legal/estatutária ou decisão institucional formal que impede atuação no domínio declarado durante o período válido.
- `UNAVAILABLE`: impossibilidade operacional temporal e material no scope/período declarado; não é proibição permanente nem ausência de informação.
- `NOT_PREFERRED` **não deve entrar nas exclusões F13 v1**. É uma preferência graduável e o seu efeito depende de pesos/política de matching; deve ser representada na futura F14. Uma prioridade positiva F13 pode continuar a existir, mas a sua ausência não cria preferência negativa.

`PROHIBITED` e `UNAVAILABLE` são semanticamente distintas. Nenhuma define por si só `INCOMPATIBLE`; a F14 decide, através de uma regra fechada/versionada, se o requisito concreto da oportunidade intersecta a constraint.

### Operandos fechados

Cada tipo de exclusão só aceita dimensões autorizadas por um catálogo de constraint types. Os operandos são referências versionadas a concepts/assertions aprovados, por exemplo:

- território `concept_id + release`;
- scheme/classificação institucional `concept_id + release/policy`;
- área temática ou prioridade `concept_id + release`;
- competência/capacidade metric concept quando o tipo de constraint o permitir;
- população servida `concept_id + release`.

Não há campos `operator`, `expression`, `query`, `path`, `script`, `condition`, comparadores livres, ranges escolhidos pelo caller ou composição booleana arbitrária. Uma necessidade nova exige nova versão do catálogo/schema, não payload extensível.

### Scope, autoridade e período

- Baseline pode declarar exclusions `ORGANIZATION`.
- Overlays podem adicionar exclusions nos scopes aprovados para o respetivo domínio. `UNIT` e `TEAM` só são aceites quando tanto a fundação organizacional como o domínio do operando autorizarem esse scope; por exemplo, território e operacional continuam sem `TEAM` na v1.
- Um overlay nunca remove, substitui, nega ou reduz uma exclusão herdada. A composição efetiva é união monotónica de constraints válidas da baseline e do overlay.
- Toda assertion preserva `constraint_type`, operando tipado/versionado, scope canónico, authority, `reason_code`, período, provenance, verification, lifecycle, version e digest.
- Reason codes são fechados. Texto explicativo pode existir como conteúdo governado, mas não altera semântica nem é consumido pela F14.

### Verificação, conflito e lifecycle

- `PROHIBITED` legal/estatutário exige authority, provenance e evidence/método definido pelo constraint type antes de poder ser `VERIFIED`; uma proibição institucional voluntária pode usar aprovação maker-checker sem prova externa, conforme o catálogo.
- `UNAVAILABLE` pode ser declarada e `UNVERIFIED`; `VERIFIED` exige método/evidence aplicáveis e `valid_until` ou período explícito.
- `DISPUTED`, `CONFLICTED`, `REVOKED` e `EXPIRED` preservam histórico, mas não podem ser tratados silenciosamente como constraint corrente.
- Uma constraint obrigatória `DISPUTED`/`CONFLICTED` impede o snapshot de ficar consumível pela F14, seguindo a knowledge policy. Revocation/supersession cria nova versão e não reescreve snapshots.
- `UNKNOWN` significa desconhecimento do slot e não cria exclusão. `WITHHELD` é projeção; não cria, remove nem enfraquece a constraint semântica interna.

### Snapshot e consumo F14

O snapshot F13 preserva cada exclusion assertion e respetivos concept/release, authority/reason, período, verification/lifecycle, provenance refs permitidas e semantic digest. A projeção pode redigir reason/evidence, mas não alterar a semântica interna.

A F14 recebe apenas um snapshot `READY` e aplica uma `F14RuleVersion` própria. O resultado explicável deve citar:

1. `effective_profile_snapshot_id` e digest;
2. `exclusion_assertion_id/version`;
3. opportunity revision e requisito F12;
4. rule ID/version F14;
5. resultado (`compatible`, `incompatible`, `unknown` ou equivalente futuro aprovado);
6. reason code explicativo fechado.

A avaliação nunca altera a assertion ou o snapshot F13. Nova informação ou correção exige nova versão/ativação F13 e nova avaliação F14.

## Invariantes propostas

1. F13 não contém evaluator, regra de oportunidade, score, weight ou eligibility result.
2. Uma exclusion assertion referencia exatamente um constraint type publicado e um operando admitido por esse tipo.
3. Operandos pertencem a catálogos/releases aprovados e ao mesmo tenant quando tenant-local.
4. `PROHIBITED|UNAVAILABLE` são os únicos tipos v1; `NOT_PREFERRED` fica fora.
5. Nenhuma expression/DSL/SQL/JavaScript/JSON Logic é persistida ou executada.
6. Nenhuma assertion referencia `opportunity_id`, source/programme/call ID ou texto de aviso.
7. Scope é server-loaded e permitido simultaneamente pelo constraint type, domínio do operando e fundação organizacional.
8. Composição baseline+overlay é monotónica; relaxamento, tombstone negativo e override permissivo são recusados.
9. Período e authority/reason/provenance são obrigatórios conforme o tipo; defaults implícitos são proibidos.
10. `UNKNOWN|WITHHELD` nunca se convertem em exclusão; `DISPUTED|CONFLICTED|EXPIRED|REVOKED` nunca contam como corrente.
11. Published assertion/snapshot são imutáveis; correção cria versão.
12. F14 referencia snapshot, assertion, opportunity revision e rule version exatos.
13. Atualizar catálogo ou regra não altera snapshots nem avaliações históricas.

## Prevenção de regras específicas de aviso

- Proibir referências a oportunidade, funder, programme, call, source record, deadline ou campos arbitrários F12 na assertion.
- Aceitar apenas operandos de domínio reusable aprovados, não blobs/JSON ou predicados fornecidos pelo caller.
- Não permitir operadores genéricos (`equals`, `contains`, regex, threshold, boolean expressions). Cada constraint type fixa a semântica e operands admitidos.
- Exigir revisão do catálogo/schema para uma nova classe de constraint, com maker-checker, F7 e compatibilidade explícita.
- Uma organização pode decidir não atuar num conceito governado; não pode codificar “excluir o aviso X” como perfil. A decisão sobre uma oportunidade concreta pertence à qualificação/F15 ou ao resultado F14, conforme o contrato futuro.

## F5, F7 e evidência mínima

Não é necessário criar já novas operations F5: criação/edição/submissão/aprovação/publicação ocorrem através das operations de profile draft/version existentes; evidence attach/read, verification, dispute, conflict resolution e revoke reutilizam as operations de assertion aprovadas, desde que `EXCLUSION_ASSERTION` seja um resource type fechado carregado server-side.

Antes da implementação, o catálogo deverá confirmar:

- se `F13_ASSERTION_REVOKE` e dispute/resolve abrangem explicitamente `EXCLUSION_ASSERTION`;
- um método de verification próprio ou uma operação `F13_EXCLUSION_VERIFY` caso a matriz F5 exija separação material;
- reason codes para `PROHIBITED` e `UNAVAILABLE`;
- event codes F7 para assertion created/revised/verified/disputed/conflict-resolved/revoked e inclusão no evento de profile publish/activation.

F7 crítico deve guardar actor/stable human subject, operation, resource/scope, assurance, authority/reason code, previous/new version, digest, idempotency key e resultado, sem texto legal integral, documentos, PII ou conteúdo restrito.

## Impacto nos critérios F13

- `F13-AC-05`: constraint types, operands, scopes e reason codes desconhecidos devem ser recusados.
- `F13-AC-06/09/11`: assertions publicadas são imutáveis, historicamente preservadas e idempotentes.
- `F13-AC-12`: authority, autoria e provenance são obrigatórias.
- `F13-AC-19`: ganha contrato verificável para exclusions tipadas, herança monotónica e ausência de scoring.
- `F13-AC-20`: `UNKNOWN`, `WITHHELD` e lifecycle não colapsam em exclusão corrente.
- `F13-AC-21/22`: operações F5 e F7 cobrem lifecycle/verification sem payload sensível.
- `F13-AC-25`: IDOR/RLS protegem assertions e evidence refs.
- `F13-AC-30`: source/contract guards devem provar ausência de evaluator/DSL F14 na F13.
- `F13-AC-32`: F14 recebe snapshot/assertion versions e não estado mutável.

Nenhum critério passa por esta investigação; a recomendação continua sujeita a aprovação humana.

## Riscos e desconhecidos

1. Aprovar `PROHIBITED|UNAVAILABLE` como tipos v1 e excluir `NOT_PREFERRED` da F13.
2. Definir catálogo inicial de constraint types, operands admissíveis e reason codes sem o transformar num catálogo de avisos.
3. Confirmar scopes por domínio, em especial os poucos domínios F13 que admitem `TEAM`.
4. Determinar quais proibições institucionais exigem evidence externa e quais podem ser aprovadas como decisão interna.
5. Confirmar se a operation de verification existente pode abranger exclusions ou se a separação F5 exige operation própria.
6. Definir projection/confidentiality para razões legais ou operacionais sensíveis.
7. A completion policy deverá decidir quais slots de exclusão são obrigatórios e como conflitos bloqueiam `READY`.
8. A futura F14 terá de aprovar estados finais e precedência entre rule results; esta investigação não os fixa.

## Fontes internas

- `context/features/f13-organizational-profile.md`
- `context/features/matching-and-qualification.md`
- `context/decisions/future-data-model.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/decisions/f13-territory-vocabulary.md`
- `context/decisions/f13-beneficiary-vocabulary.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f12-opportunity-catalog.md`
- `context/references/logical-data-dictionary.md`

Não foram necessárias fontes externas: a fronteira é determinada pelos contratos internos já aprovados. Esta recomendação não constitui decisão aprovada e não autoriza implementação da F13 ou F14.
