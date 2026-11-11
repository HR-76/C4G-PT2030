# F13 — Vocabulário de tipos de beneficiário

- Estado: **Aprovada**
- Feature: `F13 — Perfil organizacional para matching`
- Data de aprovação humana: 2026-10-10

## Contexto

“Tipo de beneficiário” mistura frequentemente natureza jurídica, função institucional, controlo, estatuto nonprofit, dimensão económica, população servida e papel numa candidatura. A F13 precisa de preservar estas dimensões sem promover códigos F3/F12 ou labels UBI a uma identidade universal e sem executar elegibilidade pertencente à F14.

## Decisão

### Modelo geral

1. Adotar um modelo interno, multidimensional, versionado e publicado.
2. Não usar um único `organization_type` como identidade universal da organização.
3. Cada dimensão possui scheme, conceitos, release, lifecycle e governance próprios.
4. Conceitos usam IDs internos opacos e estáveis.
5. Labels, descrições e aliases são traduzíveis e não constituem identidade.
6. Releases publicadas são imutáveis.
7. Depreciação ou substituição não elimina referências históricas.
8. Mappings externos são metadata versionada e nunca equivalência automática.
9. Nenhum conceito é inferido exclusivamente por label, texto livre ou código legacy.
10. Snapshots F13 referenciam `concept_id`, `scheme_id` e `taxonomy_version`.

### Schemes institucionais v1

Os schemes aprovados são:

- `LEGAL_NATURE`;
- `INSTITUTION_TYPE`;
- `CONTROL_STATUS`;
- `NON_PROFIT_STATUS`;
- `ECONOMIC_SIZE_CLASS`.

11. `LEGAL_NATURE` representa a forma ou natureza jurídica segundo uma autoridade e jurisdição identificadas.
12. `INSTITUTION_TYPE` representa a função institucional, sem substituir a natureza jurídica.
13. `CONTROL_STATUS` representa controlo público, privado, misto ou outro estado definido pelo catálogo.
14. `NON_PROFIT_STATUS` permanece uma dimensão independente.
15. `ECONOMIC_SIZE_CLASS` representa uma classificação produzida segundo política explícita; não é uma propriedade universal intrínseca.
16. Uma organização pode possuir assertions em várias dimensões simultaneamente.
17. As dimensões não são mutuamente substituíveis.
18. Combinações contraditórias devem falhar fechado segundo constraints publicadas.
19. Ausência numa dimensão não autoriza inferência a partir de outra.
20. `UNKNOWN`, `NONE`, `NOT_APPLICABLE` e estados de verificação seguem a política epistemológica já aprovada.

### Scope e temporalidade

21. Classificações institucionais possuem scope exclusivamente `ORGANIZATION` na v1.
22. Unidades e equipas não adquirem natureza jurídica ou dimensão económica independente por herança.
23. Assertions incluem authority, policy ou catalog version, período aplicável, provenance e estado de verificação.
24. Alterações produzem novas versões; não reescrevem assertions históricas.
25. Assertions expiradas, disputadas, revogadas ou superseded não são tratadas como correntes.
26. O snapshot efetivo materializa explicitamente as versões utilizadas.

### Classificação económica

27. A F13 não cria thresholds económicos universais.
28. Uma classificação PME ou equivalente deve identificar authority, policy version, jurisdição e período de referência.
29. A F13 v1 não calcula empresas associadas, grupos empresariais, autonomia, consolidação ou ownership indireto.
30. A classificação não é inferida apenas a partir de métricas financeiras.
31. Classificações externas podem ser declaradas ou verificadas, mas os dois estados permanecem distintos.
32. A F14 só pode interpretar uma classificação através de regra própria, fechada e versionada.

### Populações servidas

33. Populações servidas são semanticamente distintas das classificações da organização.
34. Usar o scheme separado `SERVED_POPULATION_GROUP`.
35. As relações v1 são `SERVES` e `STRATEGIC_PRIORITY`.
36. As assertions podem usar scope `ORGANIZATION` ou `UNIT`; `TEAM` fica fora da v1.
37. `SERVES` não implica experiência demonstrada, capacidade operacional ou prioridade estratégica.
38. `STRATEGIC_PRIORITY` não implica que a organização já tenha servido essa população.
39. Nenhuma assertion contém pessoas identificadas, listas de beneficiários ou dados individuais.
40. Conceitos potencialmente sensíveis ou relativos a populações vulneráveis exigem governance, minimização, classificação e projeção explícitas.
41. A existência de uma população servida não pode ser usada pela F13 para executar elegibilidade ou scoring.
42. Relações com territórios são assertions separadas; população e território não devem ser fundidos num código composto.

### Compatibilidade

43. `organization.type_code` F3 permanece preservado como dado anterior, sem promoção automática ao novo catálogo.
44. `beneficiaryTypeCodes` F12 continuam a descrever a oportunidade, não a organização.
45. Dados UBI permanecem legacy e não são convertidos por inferência.
46. Valores ambíguos ficam `unmapped`, com provenance.
47. Não existe backfill automático.
48. Qualquer mapping futuro exige decisão, versão, método e evidência próprios.
49. Os snapshots históricos F12/F13 não mudam quando catálogos ou mappings forem atualizados.

### Fronteira funcional

50. O papel de uma entidade numa candidatura — candidato, coordenador, parceiro ou beneficiário final — não pertence à classificação institucional F13.
51. A F13 conserva factos, assertions e prioridades governadas.
52. A F13 não decide se uma organização satisfaz uma condição de um aviso.
53. A interpretação dos requisitos de beneficiário de uma oportunidade pertence às regras versionadas da F14.
54. A F14 deve conservar a referência exata às assertions e versões F13 usadas.

## Detalhes de implementação pendentes

- seeds editoriais;
- authorities e jurisdições iniciais;
- cardinalidades concretas por scheme;
- métodos de verificação;
- mappings externos concretos e licenças;
- catálogo inicial de populações;
- classificação e projeção de grupos sensíveis.

Estes detalhes não reabrem a arquitetura aprovada, salvo descoberta de incompatibilidade material.

## Consequências

- O schema futuro deve impedir substituição entre dimensões e preservar authority/policy/período.
- A F13 publica classificações e populações servidas, mas não interpreta requisitos F12.
- A F14 terá de citar concepts, assertions e versões exatas ao produzir uma avaliação.

## Referências

- `context/research/f13-beneficiary-vocabulary.md`
- `context/decisions/f13-thematic-taxonomy.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-financial-capacity.md`
- `context/decisions/f13-territory-vocabulary.md`
- `context/history/f12-opportunity-catalog.md`
