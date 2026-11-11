# F13 — Vocabulário e semântica territorial

- Estado: **Proposta — requer aprovação humana**
- Feature: `F13 — Perfil organizacional para matching`
- Decisão: representação universal, versionada e determinística dos territórios de atuação, capacidade, experiência e prioridade
- Data: 2026-10-10

## Decisão a suportar

Definir identidade, schemes, versões, relações territoriais e assertions F13 sem confundir endereço, presença, experiência, prioridade, beneficiários, estatística ou futura elegibilidade F14.

Ficam fora geocoding, geometrias, mapas, moradas, GPS, distância, pesquisa espacial, regras de avisos, elegibilidade, matching, conectores e UI cartográfica.

## Evidência interna

### Factos estabelecidos

- F12 aceita até 32 `territoryCodes` no snapshot, normaliza-os como identificadores e usa interseção exata apenas como sinal de blocking/deduplicação. Não existe scheme, release, autoridade, hierarchy ou equivalência territorial associada ao código.
- O contrato F12 também preserva `thematicCodes` e `beneficiaryTypeCodes`; a semelhança da representação não torna estes domínios equivalentes.
- O piloto guarda `country_scope`, `nuts_ii` e país de parceiro como texto; integrações chegaram a produzir valores como `EU` e `PT-ES`. Estes valores não distinguem país, conjunto transnacional, região estatística ou elegibilidade.
- F3 não contém morada organizacional canónica. `region_code` F4 identifica localização/política da infraestrutura tenant e não território de atuação da organização.
- A decisão taxonómica F13 já estabelece o padrão: IDs internos estáveis, releases imutáveis, labels traduzíveis, mappings externos versionados, depreciação sem apagar história e nenhuma equivalência automática.
- A knowledge-state policy separa ausência, `UNKNOWN`, `NONE`, `NOT_APPLICABLE`, verificação, conflito e projeção. Um snapshot publicado materializa explicitamente os slots exigidos.
- A fundação organizacional aprovada permite assertions em scopes exatos canónicos; não transforma hierarchy organizacional em hierarchy territorial.

### Conceitos que não podem ser colapsados

| Conceito | Significado | Não implica |
|---|---|---|
| Endereço | localização postal/legal de uma entidade | presença, capacidade ou prioridade |
| Presença operacional | existência institucional operacional declarada num território | capacidade de entrega ou elegibilidade |
| Capacidade de entrega | capacidade atual para executar atividade no território | experiência anterior |
| Experiência demonstrada | atuação histórica sustentada por evidência | capacidade atual ou prioridade |
| Prioridade estratégica | intenção institucional publicada | presença ou experiência |
| Território de beneficiários | localização/tipo da população servida | território da entidade executora |
| Território elegível de oportunidade | condição externa do aviso | compatibilidade F13; pertence à interpretação F14 |
| Região estatística | unidade para produção/comparação estatística | unidade administrativa ou elegibilidade jurídica |
| Unidade administrativa | divisão legal/administrativa | região estatística estável no tempo |

### Dados internos provisórios

`country_scope`, `nuts_ii`, países livres e `territoryCodes` são fontes legacy/provenance. Não são catálogo F13 nem podem ser mapeados por label. Não foram encontrados territórios UBI com identidade e lifecycle suficientes para reutilização canónica.

## Evidência oficial externa

- ISO 3166 distingue códigos de países, subdivisões e nomes anteriormente usados; é mantida para acompanhar alterações. Os códigos externos são úteis para interoperabilidade, mas a própria evolução e os códigos formerly used tornam inadequado usá-los como identidade interna imutável ([ISO 3166](https://www.iso.org/iso-3166-country-codes.html?view=Schedule)).
- NUTS é uma classificação territorial **para estatística**. A legislação prevê alterações periódicas e extraordinárias e exige séries/correspondências após alterações; não é sinónimo universal de administração ou elegibilidade ([Regulamento (CE) 1059/2003](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=celex%3A32003R1059), [Eurostat — NUTS](https://ec.europa.eu/eurostat/en/web/nuts/publications)).
- LAU corresponde às unidades administrativas locais usadas como building blocks de NUTS e é publicada por ano, demonstrando que a release temporal deve acompanhar a referência ([Eurostat — LAU](https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/local-administrative-units)).
- As tabelas de correspondência Eurostat ligam NUTS a unidades administrativas e mostram que existem unidades administrativas e não administrativas; a relação deve ser mapping versionado, não identidade partilhada ([Eurostat — correspondence tables](https://ec.europa.eu/eurostat/web/nuts/correspondence-tables)).
- A autoridade `Countries and territories` da UE mantém conceitos, grupos e labels multilíngues; o vocabulário `Place` tem outra finalidade e usa UN/LOCODE e ISO 3166-2. Isto confirma que país/território e localidade são schemes distintos ([EU Vocabularies — authority tables](https://op.europa.eu/en/web/eu-vocabularies/authority-tables), [EU Vocabularies — Place](https://op.europa.eu/en/web/eu-vocabularies/dataset/-/resource?uri=http%3A%2F%2Fpublications.europa.eu%2Fresource%2Fdataset%2Fplace)).
- Em Portugal, a CAOP regista oficialmente circunscrições administrativas e publica versões e alterações; também fornece relações com NUTS. Deve ser mapping/fonte nacional versionada, não substituto mundial do catálogo ([DGT — CAOP](https://www.dgterritorio.gov.pt/atividades/cartografia/cartografia-tematica/caop?language=pt)).
- Os dados geográficos GISCO/Eurostat têm condições próprias de utilização, incluindo regras adicionais para dados de boundaries. F13 v1 não precisa de geometrias e deve evitar importar esse encargo quando apenas necessita de códigos/metadata ([Eurostat GISCO — statistical units](https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units)).

## Opções viáveis

| Critério | A. Texto/código livre | B. Classificação externa canónica | C. Vocabulário interno + mappings |
|---|---|---|---|
| Cobertura internacional | aparente, não validada | limitada pela classificação escolhida | múltiplos schemes governados |
| Identidade estável | não | depende de terceiros/releases | `concept_id` interno imutável |
| Evolução temporal | impossível de reproduzir | segue lifecycle externo | releases/mappings preservados |
| Hierarquias sobrepostas | ambíguas | uma visão dominante | relações por scheme/release |
| Multilingue | caller-driven | varia por fonte | labels versionadas/fallback governado |
| Interoperabilidade | baixa | alta numa fonte | alta via mappings explícitos |
| Reprodutibilidade | baixa | média se release persistida | alta: concept+release+snapshot |
| Custo editorial | baixo inicial, alto em qualidade | dependência externa alta | moderado e explícito |
| Consumo F14 | exige inferência | acopla regras ao fornecedor | IDs estáveis, sem label inference |

**A é rejeitada** porque permite taxonomia escolhida pelo caller. **B é rejeitada** porque ISO, NUTS, LAU e autoridades nacionais cobrem finalidades e geografias distintas. Recomenda-se **C**.

## Recomendação

Adotar um vocabulário territorial interno, versionado e publicado, com IDs opacos estáveis e mappings externos versionados. A recomendação reutiliza o padrão arquitetural da taxonomia F13, mas mantém um catálogo territorial separado porque containment, sobreposição e vigência têm semântica própria.

### Schemes e tipos

Schemes fechados v1 propostos:

- `COUNTRY_TERRITORY`: países e territórios reconhecidos pelo catálogo publicado;
- `ADMINISTRATIVE_AREA`: unidades administrativas oficiais de uma jurisdição/release;
- `STATISTICAL_REGION`: NUTS ou classificações estatísticas equivalentes, sempre com scheme/version;
- `TRANSNATIONAL_AREA`: agrupamento governado que atravessa países, quando não é mera união ad hoc do caller.

`CUSTOM_AREA` não entra na v1. Uma necessidade institucional própria deve ser proposta através de workflow editorial governado e só poderá criar novo conceito/tipo após decisão, não por payload funcional.

Cada `TerritoryConcept` pertence a exatamente um scheme e uma release. Um local físico pode ser representado por conceitos diferentes em schemes diferentes; relações/mappings ligam-nos sem os declarar idênticos automaticamente.

### Identidade, labels e lifecycle

- `concept_id` interno é a identidade estável; códigos ISO/NUTS/LAU/CAOP são mappings externos, nunca a PK semântica.
- Referência funcional usa `concept_id + territory_release_id`.
- Labels e aliases são traduzíveis e não entram na identidade.
- Release publicada é imutável. Conceito descontinuado permanece referenciável, com `deprecated_at` e replacements/mappings opcionais.
- Substituição pode ser one-to-one, split ou merge; por isso `replaced_by` simples não prova equivalência.
- Snapshots preservam concept/release, label necessário à apresentação histórica, mappings observados e digest.

### Hierarquia, containment e overlap

- Dentro de um scheme/release, `CONTAINS` forma um DAG acíclico versionado; múltiplos parents são admitidos apenas quando a fonte governada os define.
- Relações entre schemes não entram no containment interno: usam mappings explícitos.
- Territórios sobrepostos e transnacionais são representados por conceitos/relações governados; não são inferidos por listas de países nem por labels.
- Não existe rollup, expansão para descendants ou dupla contagem automática na F13. Qualquer interpretação futura pertence a regras F14 versionadas.

Mappings externos/entre schemes propostos:

- `EXACT`: apenas quando a autoridade/mapping aprovado garante equivalência na mesma vigência;
- `CLOSE`: cobertura suficientemente próxima para interoperabilidade, não identidade;
- `BROADER` / `NARROWER`: relação direcional;
- `OVERLAPS`: interseção parcial conhecida, sem percentagem ou scoring na v1.

Todos registam source scheme, release, target, provenance e vigência. Confidence livre não é admitida: mappings são aprovados ou não publicados; incerteza permanece `CLOSE`, `OVERLAPS` ou unmapped.

## Semântica das assertions de perfil

Relações fechadas recomendadas:

| Relação | Significado F13 | Evidência/verificação | Scopes v1 | Não implica |
|---|---|---|---|---|
| `OPERATIONAL_PRESENCE` | presença institucional atual | provenance obrigatória; verificação conforme policy | ORG, UNIT | capacidade de entrega |
| `DELIVERY_CAPABILITY` | capacidade operacional para entregar nesse território/período | assertion operacional e evidência governada | ORG, UNIT | elegibilidade ou disponibilidade de projeto |
| `DEMONSTRATED_EXPERIENCE` | experiência histórica no território | `ExperienceEvidence` vinculada e status explícito | ORG, UNIT, TEAM onde o domínio de experiência já admite TEAM | capacidade atual |
| `STRATEGIC_PRIORITY` | território priorizado institucionalmente | aprovação/publicação do perfil | ORG, UNIT | presença, experiência ou elegibilidade |

- Endereço nunca cria qualquer assertion.
- `OPERATIONAL_PRESENCE` não deve ser duplicada como proxy de `DELIVERY_CAPABILITY`.
- Unidade pode especializar através de overlay explícito ligado à baseline; não há herança ancestral nem relaxamento de exclusões.
- TEAM só pode ser usado depois da fundação organizacional existir e apenas em domínios já aprovados para TEAM.
- Cobertura não é somada automaticamente entre ORG/UNIT/TEAM. Snapshots preservam cada assertion e scope para evitar dupla contagem.
- Nenhuma relação territorial produz elegibilidade, match ou score na F13.

### Knowledge states

- ausência de assertion significa não materializado, não `UNKNOWN`;
- `KNOWN` exige concept/release e relação válidos;
- `UNKNOWN` materializa informação insuficiente e não contém território afirmado;
- `NONE` é declaração negativa explícita, temporal, autorizada e apenas onde a policy da relação a admite;
- `NOT_APPLICABLE` exige reason code do slot; não deve ser default;
- verification status é dimensão separada;
- valor parcial deve apontar para conceito broader conhecido, nunca para texto aproximado ou confidence numérico.

## Modelo candidato

```text
TerritoryConcept {
  concept_id
  scheme_code
  territory_release_id
  concept_type
  labels / aliases
  lifecycle / deprecated_at
}

TerritoryRelation {
  release_id
  relation_type: CONTAINS
  source_concept_id
  target_concept_id
}

TerritoryMapping {
  source concept/release
  external scheme/version/code or target concept/release
  relation: EXACT | CLOSE | BROADER | NARROWER | OVERLAPS
  provenance / valid period
}

ProfileTerritoryAssertion {
  profile_version / canonical scope
  territory concept/release
  relation_type
  knowledge_status
  verification_status
  provenance / evidence refs
  valid period
  assertion version / digest
}
```

Os nomes/campos são candidatos, não schema aprovado.

## Compatibilidade F12 e UBI

- `territoryCodes` F12 continuam preservados com snapshot e provenance. Não são reinterpretados automaticamente como IDs F13.
- Mapping exige identificação explícita do source namespace/scheme, código original e release observável. Um código como `EU`, `PT-ES` ou label NUTS sem version não basta para `EXACT`.
- `country_scope`, `nuts_ii` e países livres UBI permanecem legacy/unmapped quando a fonte/version não pode ser demonstrada.
- Código NUTS/LAU substituído conserva a release antiga; uma nova release e correspondência não reescrevem snapshots.
- Ausência de mapping resulta em `unmapped/UNKNOWN` conforme o slot, nunca equivalência lexical.
- F14 recebe `concept_id`, release, relation, status e digest; nunca resolve labels atuais para decidir matching.

## Riscos e decisões humanas ainda necessárias

1. Aprovar a opção C e os quatro schemes v1; decidir se `TRANSNATIONAL_AREA` entra já ou fica para release editorial posterior.
2. Aprovar exclusão de `CUSTOM_AREA` v1 e o workflow para futuras propostas.
3. Aprovar DAG `CONTAINS` intra-scheme e mappings inter-scheme `EXACT|CLOSE|BROADER|NARROWER|OVERLAPS`.
4. Aprovar as quatro relações de profile e respetivos scopes/evidence requirements.
5. Definir autoridade editorial, seed inicial, locales e releases oficiais concretas.
6. Definir reason codes e policy de completude para `UNKNOWN|NONE|NOT_APPLICABLE`.
7. Aprovar posteriormente mappings concretos dos dados F12/UBI; nenhum é autorizado por esta investigação.
8. Rever termos/licenças antes de importar datasets; códigos/metadata necessários não exigem geometrias GISCO.

## Implicações F13/F14

- Resolve, após aprovação, a metade territorial do blocker F13-AC-15; tipos de beneficiário continuam decisão separada.
- F13 passa a armazenar assertions e estado epistemológico, sem endereço, geocoding, expansão territorial ou elegibilidade.
- F14 poderá interpretar concept/release/relation por regras próprias versionadas e explicar desconhecido/unmapped sem inferência lexical.
- Atualizações oficiais criam releases/mappings novos; não alteram versões ou matches históricos.

## Fontes internas

- `context/features/f13-organizational-profile.md`
- `context/decisions/f13-thematic-taxonomy.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/organizational-scope-foundation.md`
- `context/history/f12-opportunity-catalog.md`
- `context/research/f12-opportunity-catalog-decisions.md`
- `backend/src/opportunities/contracts.js`
- `backend/src/opportunities/normalization.js`
- `backend/src/opportunities/deduplication.js`
- `backend/database/tenant/migrations/004_f12_opportunity_catalog.up.sql`
- `backend/database/init.sql`
- `backend/database/migrations_v2.sql`
- `backend/database/migrations_v8.sql`

## Fontes oficiais externas

- [ISO — ISO 3166 country codes](https://www.iso.org/iso-3166-country-codes.html?view=Schedule)
- [EUR-Lex — Regulation (EC) No 1059/2003 (NUTS)](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=celex%3A32003R1059)
- [Eurostat — NUTS publications](https://ec.europa.eu/eurostat/en/web/nuts/publications)
- [Eurostat — NUTS correspondence tables](https://ec.europa.eu/eurostat/web/nuts/correspondence-tables)
- [Eurostat — Local Administrative Units](https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/local-administrative-units)
- [EU Vocabularies — authority tables](https://op.europa.eu/en/web/eu-vocabularies/authority-tables)
- [EU Vocabularies — Place](https://op.europa.eu/en/web/eu-vocabularies/dataset/-/resource?uri=http%3A%2F%2Fpublications.europa.eu%2Fresource%2Fdataset%2Fplace)
- [Direção-Geral do Território — CAOP](https://www.dgterritorio.gov.pt/atividades/cartografia/cartografia-tematica/caop?language=pt)
- [Eurostat GISCO — statistical units and use conditions](https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units)

Esta recomendação não é uma decisão aprovada e não autoriza implementação ou mapping de dados.
