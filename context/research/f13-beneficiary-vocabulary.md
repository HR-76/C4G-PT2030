# F13 — Vocabulário e semântica de tipos de beneficiário

- Estado: **Proposta — requer aprovação humana**
- Feature: `F13 — Perfil organizacional para matching`
- Decisão: representação multidimensional, versionada e determinística das classificações institucionais e das populações servidas
- Data: 2026-10-10

## Decisão a suportar

Definir como a F13 representa factos sobre a própria organização e, separadamente, populações que serve, sem confundir esses conceitos com requisitos de oportunidades, papéis numa candidatura, atributos pessoais ou futura elegibilidade F14.

Ficam fora matching, scoring, eligibility, papéis applicant/co-applicant, pipeline de candidaturas, pessoas, segmentação comercial, CRM e classificações livres escolhidas pelo caller.

## Evidência interna

### Factos estabelecidos

- A organização canónica Central/F3 possui `type_code`, mas o contrato atual só valida a forma de um código sem publicar authority, scheme, release, cardinalidade ou semântica. Não constitui um vocabulário F13 reutilizável.
- A F12 preserva `beneficiaryTypeCodes` como lista fechada em tamanho e normalizada como identificadores genéricos. Esses códigos descrevem requisitos/classificação da oportunidade; não provam um atributo da organização e não carregam authority, version ou mapping.
- A importação UBI conserva `Tipo Ent. Beneficiária` dentro de texto de elegibilidade. Professor, departamento, instituição e roles `ADMIN|PROFESSOR` pertencem ao piloto e não definem tipos institucionais universais.
- O modelo lógico futuro menciona `partner_type_code` e `classification_code`, mas não existe catálogo publicado, lifecycle ou autoridade que os torne contrato aprovado.
- As decisões F13 já exigem IDs internos estáveis, releases imutáveis, mappings externos versionados, estados epistemológicos multidimensionais, provenance, snapshots e ausência de equivalência por label.
- A decisão financeira mantém grupos empresariais e entidades ligadas fora da v1 e proíbe agregação automática. Logo uma classificação PME não pode ser recalculada silenciosamente a partir de relações que a F13 não governa.
- A fundação organizacional torna `ORGANIZATION` a entidade institucional canónica. `UNIT` e `TEAM` são scopes internos, não pessoas coletivas ou beneficiários independentes por defeito.

### Conceitos que devem permanecer separados

| Conceito | Sujeito | Natureza | Não equivale a |
|---|---|---|---|
| Forma/natureza jurídica | organização | facto jurisdicional | função institucional |
| Tipo institucional | organização | classificação funcional | forma jurídica |
| Controlo público/privado | organização | status por authority/policy | nonprofit ou setor estatístico |
| Estatuto nonprofit | organização | status legal/policy | público ou privado |
| Classe de dimensão | organização/empresa | classificação temporal por policy | valor financeiro permanente |
| População servida | grupo agregado externo | relação institucional | tipo da própria organização |
| Tipo admitido pela oportunidade | requisito F12 | condição externa | facto do perfil |
| Applicant/co-applicant | candidatura | papel contextual | classificação institucional |

### Dados provisórios e legacy

`organization.type_code`, `beneficiaryTypeCodes`, labels de elegibilidade UBI e futuros campos lógicos de parceiro são fontes candidatas a mapping com provenance. Nenhum pode ser promovido ou convertido por nome, label ou semelhança lexical.

## Evidência oficial externa

- A definição europeia de PME combina efetivos e limiares financeiros e considera relações entre empresas autónomas, parceiras e associadas. É uma classificação por autoridade, policy e período, não uma propriedade universal ou permanente ([Recomendação 2003/361/CE](https://eur-lex.europa.eu/legal-content/PT/ALL/?uri=CELEX%3A32003H0361)).
- O ESA 2010 organiza unidades institucionais por comportamento económico e distingue controlo público/privado; o setor público inclui também public corporations. Portanto setor estatístico, controlo e forma jurídica são eixos diferentes ([Eurostat — ESA 2010, capítulo 1](https://webgate.acceptance.ec.europa.eu/eurostat/esa2010/chapter/view/1)).
- A metadata Eurostat trata institutional sectors como classificação estatística de unidades em setores mutuamente exclusivos, incluindo NPISH. Essa finalidade não deve ser confundida com um catálogo jurídico ou de programas de financiamento ([Eurostat — National accounts metadata](https://ec.europa.eu/eurostat/cache/metadata/EN/na10_esms_tr.htm)).
- A documentação Eurostat assinala que legal forms e sistemas administrativos variam entre Estados-Membros e distingue legal units de enterprises estatísticas; forma jurídica requer jurisdição e authority próprias ([Eurostat — European business statistics manual](https://ec.europa.eu/eurostat/documents/3859598/12433023/KS-GQ-20-006-EN-N.pdf)).
- Em Portugal, associações, cooperativas, fundações e outras pessoas coletivas seguem regimes/registos próprios. Estes códigos são fontes nacionais possíveis, não uma ontologia global única ([Justiça — Constituição de entidade](https://justica.gov.pt/Registos/Comercial/Constituicao-de-entidade), [IRN — Registo de Fundações](https://irn.justica.gov.pt/Servicos/Empresas-e-outras-pessoas-coletivas/Regime-do-Registo-de-Fundacoes)).
- O catálogo de vocabulários da UE reúne autoridades controladas para finalidades distintas; a existência de vocabulários oficiais não demonstra que um único deles cubra natureza jurídica, instituição, dimensão e população servida ([EU Vocabularies — Data catalogue](https://op.europa.eu/en/web/eu-vocabularies/data-catalogue)).

## Opções viáveis

| Critério | A. Lista plana universal | B. Classificação externa direta | C. Modelo interno multidimensional |
|---|---|---|---|
| Universalidade | baixa; mistura dimensões | limitada à finalidade da fonte | alta por schemes separados |
| Jurisdições | labels/códigos ambíguos | forte dependência de uma jurisdição | legal form por authority/jurisdição |
| Temporalidade | difícil de preservar | depende da release externa | assertion e policy versionadas |
| Múltiplos estados | contradições implícitas | limitado pelo fornecedor | cardinalidade por scheme |
| Verificação | pouco definida | varia por fonte | método/status/provenance explícitos |
| Interoperabilidade | baixa | alta numa fonte | mappings externos versionados |
| Consumo F14 | exige inferência lexical | acopla regra à fonte | concept/release/policy determinísticos |
| Histórico | frágil | depende da disponibilidade externa | snapshot interno imutável |
| Custo editorial | baixo inicialmente | dependência externa | moderado e governado |

**A é rejeitada** porque “tipo de beneficiário” não é uma dimensão única. **B é rejeitada** porque classificações legais, estatísticas e de policy têm autoridades e finalidades incompatíveis. Recomenda-se **C**.

## Recomendação

Adotar schemes internos separados, publicados e versionados, com `concept_id` opaco estável e mappings externos que nunca criam equivalência automática. As assertions referem-se à organização; populações servidas usam um vocabulário e uma assertion distintos.

### Schemes institucionais v1 propostos

| Scheme | Semântica | Cardinalidade/tempo | Verificação |
|---|---|---|---|
| `LEGAL_NATURE` | forma/natureza jurídica numa jurisdição | uma classificação corrente por authority/período; histórico preservado | fonte/registo oficial para `VERIFIED` |
| `INSTITUTION_TYPE` | função institucional, por exemplo ensino, investigação, município ou empresa | pode admitir vários conceitos quando o catálogo os declarar não exclusivos | declaração ou evidência governada |
| `CONTROL_STATUS` | controlo público, privado ou misto segundo policy | um resultado por policy/período | authority/método obrigatórios para `VERIFIED` |
| `NON_PROFIT_STATUS` | estatuto nonprofit separado de legal form/control | um resultado por authority/policy/período | evidence e policy explícitas |
| `ECONOMIC_SIZE_CLASS` | micro/small/medium/large segundo uma policy | temporal, derivada ou atestada por policy versionada | inputs/método/authority e período |

`RESEARCH_EDUCATION_STATUS` não deve nascer como eixo redundante na v1: funções de ensino/investigação pertencem a `INSTITUTION_TYPE`; um estatuto oficial/acreditação futuro só justifica scheme próprio se possuir autoridade, lifecycle e semântica diferentes.

Os conceitos de schemes distintos podem coexistir. Dentro de cada scheme, o catálogo fixa se conceitos são exclusivos ou múltiplos; o caller não escolhe cardinalidade, authority, thresholds ou códigos.

### Classificação de dimensão económica

- `ECONOMIC_SIZE_CLASS` guarda concept, policy authority/version, reference period, verification e provenance; não grava “SME” como tag permanente.
- Thresholds da UE ou de outra fonte são conteúdo da policy referenciada, não thresholds universais C4G.
- A F13 não calcula relações de grupo/linked enterprises na v1. Pode preservar uma classificação proveniente de autoridade ou verificação governada; se a policy exigir relações não disponíveis, o resultado permanece `UNKNOWN` ou `UNVERIFIED`, nunca é inferido.
- Alterar policy ou período cria assertion/snapshot novo e não reclassifica histórico.

### Populações servidas

Populações servidas pertencem à F13 porque descrevem atuação/prioridade institucional, mas devem usar um scheme separado `SERVED_POPULATION_GROUP` e `ServedBeneficiaryAssertion`, nunca `OrganizationClassificationAssertion`.

- Scopes v1 recomendados: `ORGANIZATION|UNIT`; `TEAM` fica fora para reduzir granularidade e risco de reidentificação.
- Relações fechadas propostas: `SERVES` (atuação declarada/demonstrável) e `STRATEGIC_PRIORITY` (prioridade publicada). Uma não implica a outra.
- A assertion referencia apenas conceitos agregados aprovados, período, knowledge/verification, provenance e evidence refs governadas.
- Não guarda membros, nomes, atributos pessoais, listas, contagens pequenas ou pertença individual. Conceitos sensíveis exigem classification/projection policy, F5 e redaction; ausência de autorização não pode ser inferida por diferenças de erro.
- `SERVES` pode ser `UNVERIFIED`; `VERIFIED` exige método e evidência institucional. Documento F11 não promove automaticamente o estado.
- Esta dimensão não representa território de beneficiários, applicant role ou elegibilidade de uma oportunidade.

## Modelo candidato

```text
BeneficiaryConcept {
  concept_id
  scheme_code
  release_id
  labels / aliases
  policy_authority / policy_version when applicable
  lifecycle / deprecation
}

OrganizationClassificationAssertion {
  organization_profile_version
  concept_id / release_id
  knowledge_status / verification_status
  valid period
  authority / policy version
  evidence refs / provenance
  assertion version / digest
}

ServedBeneficiaryAssertion {
  profile version / ORGANIZATION|UNIT scope
  population concept / release
  relation: SERVES | STRATEGIC_PRIORITY
  knowledge / verification / projection
  period / evidence refs / provenance
  assertion version / digest
}
```

Os nomes/campos são candidatos, não schema aprovado.

## Estados, temporalidade e integridade

- Ausência significa não materializado, não `UNKNOWN`.
- `KNOWN` exige concept/release e, quando aplicável, authority/policy/version/período.
- `UNKNOWN` representa informação insuficiente sem afirmar classificação.
- `NONE` só é permitido quando o scheme o definir semanticamente; não é inferido da ausência. Em `LEGAL_NATURE` e `CONTROL_STATUS`, a recomendação é não admitir `NONE`.
- `NOT_APPLICABLE` exige reason code permitido; por exemplo, size class pode ser N/A se a policy demonstrar que a entidade não está no universo classificado.
- Legal/status/classification changes criam novas assertions temporais; não alteram snapshots.
- Contradições entre fontes usam `CONFLICTED`; não se escolhe silenciosamente uma label ou conceito.
- Snapshots preservam concept/release, authority/policy, período, estado, verification, provenance, labels históricos necessários e digest.

## Mappings externos

Mappings usam as relações aprovadas `EXACT|CLOSE|BROADER|NARROWER`, com source authority/release/code, target concept/release, validity e provenance. Não expandem assertions, não convertem opportunity requirements em organization facts e não produzem matching.

Natureza jurídica nacional, institutional sector estatístico, PME policy e categoria de programa permanecem mappings/classificações diferentes mesmo quando os labels parecem semelhantes.

## Segurança e ética

- Assertions institucionais são tenant-local, protegidas por RLS/IDOR e carregadas server-side.
- Verification, publication e mappings governados usam F5, maker-checker e F7 sanitizado.
- Dados de populações servidas não identificam indivíduos nem provam atributos de qualquer pessoa.
- Conceitos relativos a grupos vulneráveis usam projeções redigidas e controlo de export; não se publicam counts pequenos nem combinações que permitam reidentificação.
- Evidence refs seguem autorização própria; snapshots F14 não recebem documentos ou PII automaticamente.
- Logs e eventos preservam IDs/version/digest permitidos, nunca conteúdo restrito, documentos ou dados pessoais.

## Compatibilidade F12 e UBI

- `beneficiaryTypeCodes` F12 permanecem requisitos da oportunidade. Mapping futuro deve declarar namespace/authority/version e não cria automaticamente uma assertion organizacional.
- `organization.type_code` F3 permanece preservado; só um mapping aprovado pode ligá-lo a concept/release F13.
- `Tipo Ent. Beneficiária` e outros labels UBI permanecem texto legacy com provenance. Não são convertidos por label.
- `partner_type_code` e `classification_code` do modelo lógico futuro não são autoridade enquanto não houver catálogo/release aprovados.
- Classificações PME antigas sem policy, período e tratamento de empresas ligadas permanecem unmapped/ambíguas.
- Código oficial substituído conserva a authority/release antiga e correspondence/mapping versionado.
- Sem mapping aprovado, o valor original é preservado como `unmapped`; isso não equivale a `UNKNOWN` sobre o facto original.

## Implicações F13/F14

- A aprovação desta proposta resolveria a metade beneficiários do blocker `F13-AC-15` e fecharia os schemes/cardinalidades necessários ao schema.
- F13 preserva factos, status e populations-served assertions; não decide se uma organização é beneficiário elegível.
- F14 comparará requisitos da oportunidade e assertions do perfil apenas por concepts/releases/mappings e regras versionadas. Label, ausência ou proximidade textual nunca decide compatibilidade.
- Papéis applicant/co-applicant e populations concretas de uma candidatura continuam fora da F13.

## Riscos e decisões humanas ainda necessárias

1. Aprovar a opção C e os cinco schemes institucionais v1.
2. Aprovar `SERVED_POPULATION_GROUP` como vocabulário separado na F13 v1, com scopes `ORGANIZATION|UNIT` e relações `SERVES|STRATEGIC_PRIORITY`.
3. Confirmar cardinalidade/exclusividade editorial de `INSTITUTION_TYPE` e seeds iniciais de cada scheme.
4. Definir authorities nacionais iniciais para `LEGAL_NATURE` e mappings, sem criar catálogo global por tradução de labels.
5. Definir policies/authorities aceites para `CONTROL_STATUS`, `NON_PROFIT_STATUS` e `ECONOMIC_SIZE_CLASS`.
6. Definir métodos de verificação, validade, reason codes e completion policy por scheme.
7. Definir confidentiality/projection policy dos conceitos de populações servidas e proteção de grupos vulneráveis.
8. Manter grupos empresariais fora da v1; decidir futuramente se uma fundação própria permitirá calcular classificações que dependem de entidades ligadas.
9. Aprovar mappings concretos F12/F3/UBI separadamente; esta investigação não autoriza nenhum backfill.

## Fontes internas

- `context/features/f13-organizational-profile.md`
- `context/decisions/f13-thematic-taxonomy.md`
- `context/decisions/f13-financial-capacity.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/organizational-scope-foundation.md`
- `context/history/f12-opportunity-catalog.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `backend/database/central/migrations/002_f3_organization_memberships.up.sql`
- `backend/src/opportunities/contracts.js`
- `backend/src/opportunities/normalization.js`
- `backend/src/opportunities/quality.js`

## Fontes oficiais externas

- [EUR-Lex — Recomendação 2003/361/CE, definição de PME](https://eur-lex.europa.eu/legal-content/PT/ALL/?uri=CELEX%3A32003H0361)
- [Eurostat — ESA 2010, capítulo 1](https://webgate.acceptance.ec.europa.eu/eurostat/esa2010/chapter/view/1)
- [Eurostat — National accounts metadata, institutional sectors](https://ec.europa.eu/eurostat/cache/metadata/EN/na10_esms_tr.htm)
- [Eurostat — European business statistics manual](https://ec.europa.eu/eurostat/documents/3859598/12433023/KS-GQ-20-006-EN-N.pdf)
- [Justiça — Constituição de entidade](https://justica.gov.pt/Registos/Comercial/Constituicao-de-entidade)
- [IRN — Registo de Fundações](https://irn.justica.gov.pt/Servicos/Empresas-e-outras-pessoas-coletivas/Regime-do-Registo-de-Fundacoes)
- [EU Vocabularies — Data catalogue](https://op.europa.eu/en/web/eu-vocabularies/data-catalogue)

Esta recomendação não é uma decisão aprovada e não autoriza implementação, seeds ou mappings.
