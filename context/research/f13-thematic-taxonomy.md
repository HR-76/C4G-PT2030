# F13 — Taxonomia temática de áreas e prioridades estratégicas

- Estado: **Proposta — requer aprovação humana**
- Decisão investigada: representação universal, versionada e determinística de áreas temáticas e prioridades estratégicas no perfil F13
- Feature: `F13 — Perfil organizacional para matching`
- Data: 2026-10-10

## Decisão a suportar

Definir identidade, estrutura, versionamento, mappings externos, lifecycle e governance dos conceitos temáticos usados pela F13, sem introduzir conceitos UBI, sem adotar um único programa de financiamento como autoridade universal e sem antecipar scoring, pesos ou elegibilidade F14.

Esta investigação cobre somente áreas temáticas e prioridades estratégicas. Não decide competências, experiência, territórios, beneficiários, capacidade financeira/operacional, matching ou elegibilidade.

## Factos estabelecidos pelo repositório

### Contratos aprovados

- A arquitetura coloca perfis e prioridades na base tenant e exige histórico explicável quando regras/configurações mudam.
- A decisão de âmbito F13 exige perfil-base organizacional, overlays opcionais e snapshot efetivo imutável. A F14 receberá apenas `effective_profile_version_id`, digest e versão de schema/regra.
- F5 usa catálogos fechados/versionados para permissions, operations e scopes; valores desconhecidos recusam.
- F7 exige eventos fechados, provenance/autoria confiáveis e payload sanitizado. F10 exige códigos de baixa cardinalidade e proíbe IDs funcionais em labels de métricas.
- F12 aceita `thematicCodes` na revisão imutável da oportunidade, com arrays limitados de códigos fechados pela forma, normalização, provenance e `content_digest`. F12 não define ainda a autoridade, semântica ou versão de uma taxonomia temática.
- F12 preserva revisões e digests; por isso uma futura associação F12↔taxonomia não pode reinterpretar revisões históricas quando o catálogo mudar.

### Modelo futuro e dados provisórios

- O dicionário lógico prevê `strategic_priority` e `organization_profile_version`, mas não constitui schema físico nem catálogo aprovado para F13.
- As migrations tenant 000–005 não materializam taxonomias F13.
- `thematicCodes` de F12 são dados de classificação preservados no snapshot da oportunidade. Sem `taxonomy_id`/`taxonomy_version`, são evidência provisória e não bastam como referência canónica para matching.
- O piloto UBI usa `research_areas`, associações professor/área e matching lexical. Labels e relações específicas desse piloto são material de migração, não IDs nem conceitos universais.

## Evidência externa relevante

- EuroSciVoc é uma taxonomia multilingue de campos científicos e tópicos de investigação, gerida pelo Serviço das Publicações da UE, com níveis superiores alinhados com OECD FoRD e publicação em SKOS/RDF. É boa fonte de interoperabilidade para domínios de investigação, mas a própria finalidade é classificar ciência e conteúdo de projetos financiados, não prioridades institucionais gerais ([EU Vocabularies — EuroSciVoc](https://op.europa.eu/en/web/eu-vocabularies/euroscivoc), [CORDIS — EuroSciVoc](https://cordis.europa.eu/about/euroscivoc)).
- OECD FoRD classifica atividades de I&D por conteúdo em campos amplos e detalhados. O manual reconhece finalidades diferentes de outras classificações e revisão contínua, pelo que FoRD é um mapping útil, não uma identidade universal imutável para todo o produto ([OECD — Frascati Manual 2015](https://www.oecd.org/en/publications/2015/10/frascati-manual-2015_g1g57dcb.html)).
- EuroVoc é um thesaurus multilingue e multidisciplinar que cobre atividades da UE; possui versões publicadas e uma cobertura de política mais ampla que EuroSciVoc, mas continua a ser uma autoridade externa cujo lifecycle não é controlado pela C4G ([EU Vocabularies — EuroVoc](https://op.europa.eu/en/web/eu-vocabularies/dataset/-/resource?uri=http%3A%2F%2Fpublications.europa.eu%2Fresource%2Fdataset%2Feurovoc)).
- NACE classifica atividades económicas. É relevante como mapping para setores/atividades, não como taxonomia completa de temas ou prioridades estratégicas ([Eurostat — NACE Rev. 2.1](https://ec.europa.eu/eurostat/documents/3859598/24236479/KS-01-26-047-EN-N.pdf)).
- A lista oficial `EU programme` representa programas financiados pela UE e é versionada/multilingue. Demonstra o valor de authority lists, mas programas e prioridades de um financiador não devem tornar-se a identidade temática universal da C4G ([EU Vocabularies — EU programme](https://op.europa.eu/en/web/eu-vocabularies/dataset/-/resource?uri=http%3A%2F%2Fpublications.europa.eu%2Fresource%2Fdataset%2Feu-programme)).
- SKOS separa identidade do conceito, labels multilingues, relações semânticas/hierárquicas e mappings entre concept schemes. Esse modelo sustenta IDs estáveis e mappings versionados sem tornar labels ou IDs externos na identidade interna ([W3C — SKOS Reference](https://www.w3.org/TR/skos-reference/)).

Nenhuma destas fontes cobre simultaneamente áreas temáticas de qualquer instituição, prioridades estratégicas próprias e todos os programas/financiadores. A adoção exclusiva de uma delas deixaria lacunas ou importaria semântica inadequada.

## Opções viáveis

| Critério | A. Taxonomia interna totalmente própria | B. Taxonomia externa como contrato canónico | C. Taxonomia interna versionada + mappings externos |
| --- | --- | --- | --- |
| Universalidade | Pode cobrir todas as instituições, mas exige desenho integral C4G | Limitada ao propósito da autoridade escolhida | Núcleo universal com interoperabilidade por mapping |
| Estabilidade | Controlada pela C4G | Depende de IDs, releases e política externa | IDs internos estáveis; alterações externas ficam isoladas por versão |
| Granularidade | Adaptável, com elevado custo editorial | Forte no domínio de origem, desigual fora dele | Catálogos internos podem selecionar granularidade adequada |
| Hierarquia/evolução | Total controlo, mas exige governance própria | Herdadas; podem mudar sem coordenação C4G | Grafo interno publicado; mappings acompanham releases externas |
| Tradução | Tem de ser criada e mantida | Pode ser extensa (por exemplo EuroVoc) ou limitada | Labels internas versionadas e traduções externas reutilizáveis sob provenance |
| Interoperabilidade | Baixa sem mappings posteriores | Alta apenas com o ecossistema escolhido | Alta com múltiplas autoridades sem dependência única |
| Auditabilidade/histórico | Boa se todo o lifecycle for implementado | Exige arquivar versões externas usadas | Boa: release, relações e mappings ficam fixados no snapshot |
| Matching determinístico | Possível | Possível, mas atualização externa pode mudar semântica | Possível com `concept_id` + versão e grafo imutável |
| Custo operacional | Alto para curadoria e tradução | Menor inicialmente, maior risco de adaptação/lock-in | Moderado: governa núcleo e mappings necessários |
| Dependência de terceiros | Nenhuma | Elevada | Limitada à atualização opcional de mappings |

## Recomendação

Recomenda-se a **Opção C: taxonomia interna versionada, com IDs estáveis e mappings versionados para autoridades externas**.

### Identidade e tipos

- Cada conceito recebe `concept_id` interno opaco e estável. Labels, descrições, aliases, códigos externos e posição hierárquica não constituem a identidade.
- O catálogo usa tipo fechado: inicialmente `THEMATIC_AREA` e `STRATEGIC_PRIORITY`.
- Os tipos partilham infraestrutura de catálogo/versionamento, mas pertencem a concept schemes distintos e não são intercambiáveis:
  - `THEMATIC_AREA` descreve assunto, domínio ou campo de atuação/conhecimento;
  - `STRATEGIC_PRIORITY` descreve uma direção ou objetivo institucional aprovado.
- Um mesmo significado pode ser relacionado entre schemes apenas por relação explícita versionada; igualdade de label nunca cria equivalência.

### Versão, publicação e reprodução

- Uma `taxonomy_version` publicada é um release imutável que fixa conceitos, tipos, estados, labels/descrições, relações, aliases, depreciações e mappings.
- Drafts podem evoluir; publicação cria uma nova versão e nunca altera a anterior.
- Perfis e oportunidades referenciam `concept_id` + `taxonomy_version` (e o scheme/tipo validado pelo serviço). O snapshot efetivo F13 incorpora essas referências e o digest da projeção canónica.
- F14 recebe as referências fixadas no snapshot, não labels correntes nem a “última” taxonomia.
- Remover significa deprecar numa versão posterior. Versões antigas continuam resolvíveis e não são recalculadas.

### Labels, aliases e lifecycle

- Labels e descrições são traduzíveis por locale sem alterar `concept_id`.
- Aliases são metadata linguística versionada; não criam conceitos alternativos nem matching implícito.
- Estados fechados propostos: `DRAFT`, `PUBLISHED`, `DEPRECATED`. Um conceito deprecated pode declarar zero ou mais `replaced_by` porque substituições podem representar split/merge; essa relação não reescreve referências históricas.
- Cada release conserva provenance: autoridade/origem, versão externa observada, autoria/aprovação, timestamps e digest.

### Hierarquia

- Relações hierárquicas são arestas explícitas e versionadas `BROADER_THAN`/`NARROWER_THAN` dentro do mesmo scheme/tipo.
- Recomenda-se suportar **DAG acíclico**, incluindo múltiplos parents quando a curadoria o justificar, em vez de assumir uma árvore que force um único contexto.
- Publicação valida ausência de ciclos, referências existentes, tipos compatíveis e limites de profundidade/volume. A semântica transitiva usada futuramente por F14 terá versão de regra própria; F13 apenas preserva o grafo.
- Relações associativas não hierárquicas, se necessárias, usam tipo fechado separado e não contam como ancestry.

### Mappings externos

- Mappings são metadata versionada, não parte da identidade interna.
- Cada mapping fixa `authority`, `scheme`, `external_version`, `external_identifier`, relação fechada (`EXACT`, `CLOSE`, `BROADER`, `NARROWER`, `RELATED`), provenance e estado de validação.
- EuroSciVoc/FoRD são candidatos para áreas científicas; EuroVoc para temas/políticas amplas; NACE para atividade económica; programas/tópicos de financiamento permanecem mappings/source metadata específicos, não o catálogo-base universal.
- Uma atualização externa cria/reconcilia mappings numa nova versão interna; não altera snapshots já publicados.

### Conceitos próprios das organizações

- Organizações podem precisar de prioridades que nenhuma autoridade externa representa. Conceitos próprios são permitidos apenas num namespace tenant-local governado, nunca como strings livres no perfil.
- O workflow mínimo é proposta em draft, validação contra duplicados/aliases, autoria e provenance, aprovação maker-checker e inclusão numa versão publicada.
- O caller funcional seleciona apenas conceitos publicados visíveis no catálogo aplicável; não cria taxonomia inline.
- Conceitos tenant-local não se tornam globais nem visíveis a outro tenant por efeito da aprovação local. Promoção para catálogo C4G exigiria workflow editorial separado e decisão futura.

### Relação com F12 e F14

- A F12 atual preserva `thematicCodes` no snapshot. A integração futura deve resolver cada código com namespace/provenance explícitos para `concept_id` + `taxonomy_version`; valores legados não são reinterpretados silenciosamente.
- Revisões F12 antigas mantêm os códigos originais e respetivo digest. Um mapping posterior cria uma nova revisão/associação versionada, não um backfill destrutivo.
- F14 opera sobre IDs e versões fixados nos snapshots F12/F13. Labels servem apresentação; não participam na identidade nem mudam resultados históricos.

## Respostas às questões obrigatórias

- **IDs internos estáveis?** Sim, opacos, imutáveis e independentes dos códigos externos.
- **Labels traduzíveis?** Sim; mudar/adicionar tradução requer nova versão publicada, não novo ID.
- **Hierarquia ou DAG?** DAG explícito, acíclico e versionado.
- **Múltiplos parents?** Permitidos após validação editorial; F14 não pode inferir semântica além da regra versionada.
- **Deprecated, replaced_by e aliases?** Estados/relações fechados e versionados; nunca apagam referências antigas.
- **Versão reproduzível?** Release publicado imutável, digestado e preservado.
- **Mappings externos?** Metadata versionada com provenance, não identidade.
- **Conceitos próprios?** Sim, tenant-local, apenas por workflow governado e maker-checker.
- **Evitar taxonomia livre?** Contratos fechados, catálogo publicado, sem criação inline pelo caller.
- **Áreas versus prioridades?** Schemes e tipos distintos sobre infraestrutura comum.
- **F12?** Referência resolvida por ID/versão numa evolução explícita; códigos históricos preservados.
- **F14?** Recebe referências/digests fixados; nunca depende de labels ou release corrente.
- **Remoção/substituição?** Depreciação e relações de substituição numa nova versão, sem apagar versões antigas.
- **Impedir mudança de matches históricos?** Persistir versões/digests nos snapshots e proibir recomposição com catálogo corrente.

## Riscos e decisões humanas restantes

1. Aprovar ou rejeitar a Opção C.
2. Confirmar `THEMATIC_AREA` e `STRATEGIC_PRIORITY` como schemes/tipos distintos.
3. Aprovar DAG com múltiplos parents ou restringir v1 a uma árvore.
4. Definir a autoridade editorial C4G e quem aprova conceitos tenant-local.
5. Definir idiomas mínimos de publicação e fallback de apresentação; labels nunca são fallback de identidade.
6. Escolher o seed inicial e granularidade de cada scheme; esta investigação não aprova importar integralmente EuroSciVoc, FoRD, EuroVoc ou NACE.
7. Definir quais relações de mapping externo entram na v1.
8. Decidir o workflow de migração dos `thematicCodes` F12 e dados UBI sem backfill ambíguo.
9. Definir retenção/disponibilidade operacional das versões antigas, preservando sempre as usadas por snapshots.

## Implicações para a especificação F13

Se aprovada, a especificação deve exigir:

- catálogo fechado com `concept_id`, scheme/tipo e versão publicada;
- referências por ID e versão, nunca apenas por label/código solto;
- releases e snapshots imutáveis com digest/provenance;
- labels/aliases traduzíveis e versionados;
- DAG explícito validado antes da publicação;
- depreciação/substituição sem remoção histórica;
- mappings externos versionados e não autoritativos para a identidade;
- workflow maker-checker para conceitos tenant-local;
- separação entre área temática e prioridade estratégica;
- nenhuma regra de peso, score ou elegibilidade em F13.

## Limites da investigação

- Não foi selecionado o conteúdo inicial do catálogo.
- Não foram definidos schema SQL, API, UI, importadores ou jobs.
- Não foi aprovada qualquer dependência operacional de fontes externas.
- A recomendação não é decisão arquitetural aprovada nem autoriza implementação.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/features/matching-and-qualification.md`
- `context/features/opportunity-catalog.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f10-operational-observability.md`
- `context/history/f12-opportunity-catalog.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `backend/src/opportunities/contracts.js`
- `backend/src/opportunities/normalization.js`
- `backend/src/opportunities/digests.js`
- `backend/database/tenant/migrations/004_f12_opportunity_catalog.up.sql`
- `backend/src/utils/researchAreaMatcher.js`
- `backend/src/services/researchAreaSeedService.js`
