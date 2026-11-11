# F13 — Vocabulário territorial

- Estado: **Aprovada**
- Feature: `F13 — Perfil organizacional para matching`
- Data de aprovação humana: 2026-10-10

## Contexto

A F13 precisa de representar territórios de atuação, capacidade, experiência e prioridade sem confundir endereço, classificação estatística, unidade administrativa ou futura elegibilidade F14. Os códigos F12 e os dados UBI são evidência legacy, não uma autoridade territorial universal.

## Decisão

1. Territórios usam vocabulário interno versionado, com IDs opacos e estáveis.
2. Labels, códigos externos e nomes não constituem identidade.
3. Releases publicadas são imutáveis.
4. Schemes v1:
   - `COUNTRY_TERRITORY`;
   - `ADMINISTRATIVE_AREA`;
   - `STATISTICAL_REGION`;
   - `TRANSNATIONAL_AREA`.
5. `CUSTOM_AREA` fica fora da v1.
6. Texto livre territorial não é aceite no contrato determinístico.
7. Conceitos transnacionais pertencem ao catálogo global governado.
8. Tenants não criam áreas transnacionais arbitrárias.
9. Um conceito pertence a um scheme.
10. Hierarquia/containment é definida dentro do respetivo scheme/release.
11. Não existe uma única árvore universal que funda ISO, NUTS, LAU, CAOP ou outros schemes.
12. Relações de containment são versionadas.
13. Overlap entre classifications distintas é representado por mapping, não parent universal.
14. Mappings externos v1:
    - `EXACT`;
    - `CLOSE`;
    - `BROADER`;
    - `NARROWER`;
    - `OVERLAPS`.
15. Mappings são metadata versionada.
16. Mapping não:
    - altera identidade;
    - cria equivalência automática;
    - expande assertions;
    - produz elegibilidade;
    - produz matching.
17. ISO 3166, NUTS, LAU e CAOP permanecem authorities distintas.
18. Códigos externos preservam:
    - authority;
    - release/version;
    - code;
    - validity;
    - provenance.
19. Códigos descontinuados não são apagados.
20. Substituições e correspondências históricas são versionadas.
21. Scopes F13 v1 para assertions territoriais:
    - `ORGANIZATION`;
    - `UNIT`.
22. `TEAM` fica fora das assertions territoriais v1.
23. Relações de perfil v1:
    - `OPERATIONAL_PRESENCE`;
    - `DELIVERY_CAPABILITY`;
    - `DEMONSTRATED_EXPERIENCE`;
    - `STRATEGIC_PRIORITY`.
24. Relações são semanticamente distintas.
25. Endereço não implica nenhuma relação territorial de perfil.
26. `OPERATIONAL_PRESENCE` não implica `DELIVERY_CAPABILITY`.
27. `DELIVERY_CAPABILITY` não implica `DEMONSTRATED_EXPERIENCE`.
28. `STRATEGIC_PRIORITY` não implica presença ou experiência.
29. `DEMONSTRATED_EXPERIENCE` exige referência válida a `ExperienceEvidence`.
30. `DELIVERY_CAPABILITY` pode ser `UNVERIFIED` ou `VERIFIED`.
31. `VERIFIED` exige método, verifier, provenance e evidência aprovada.
32. `STRATEGIC_PRIORITY` exige aprovação/lifecycle, mas não prova externa.
33. Assertions preservam:
    - territory concept;
    - scheme/release;
    - relation type;
    - scope;
    - knowledge state;
    - verification state quando aplicável;
    - provenance;
    - valid period;
    - version/digest.
34. F13 não expande automaticamente um território para ancestors ou descendants.
35. Expansão geográfica futura pertence a regra F14 explícita e versionada.
36. Snapshots preservam referências e labels necessários à reprodução histórica.
37. Atualização de scheme não altera snapshots anteriores.
38. F12 codes e dados UBI:
    - permanecem preservados;
    - não são mapeados por label;
    - exigem mapping explícito;
    - ficam unmapped quando ambíguos.
39. Ausência de mapping não equivale a `UNKNOWN` sobre o facto original.
40. Geocoding, polígonos, mapas, moradas, GPS e cálculo espacial ficam fora da v1.
41. RLS, IDOR, F5, F7, maker-checker e provenance aplicam-se às assertions e mappings governados.

## Consequências

- A F13 preserva conceitos, releases, relações e estado epistemológico; não infere alcance territorial nem elegibilidade.
- A F14 só poderá expandir ou comparar territórios através de regras explícitas e versionadas.
- Seeds, autoridade editorial, locales e mappings concretos F12/UBI continuam conteúdo governado posterior.

## Referências

- `context/research/f13-territory-vocabulary.md`
- `context/decisions/f13-thematic-taxonomy.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/organizational-scope-foundation.md`
