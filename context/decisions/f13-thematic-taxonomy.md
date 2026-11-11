# Decisão: taxonomia temática F13

## Estado

**Aprovada.**

## Contexto

A F13 precisa representar áreas temáticas e prioridades estratégicas de instituições diferentes sem universalizar labels UBI, códigos de um programa de financiamento ou o lifecycle de uma autoridade externa. A identidade e o histórico têm de permanecer determinísticos quando traduções, hierarquias, mappings ou catálogos externos evoluem.

## Decisão

1. A arquitetura usa taxonomia interna, versionada e publicada, com IDs internos opacos e estáveis.
2. Existem schemes distintos:
   - `THEMATIC_AREA`;
   - `STRATEGIC_PRIORITY`.
3. Um conceito pertence a exatamente um scheme.
4. Labels, descrições e aliases são traduzíveis e não integram a identidade do conceito.
5. Releases publicadas são imutáveis.
6. Referências usam `concept_id` e `taxonomy_version`/`release_id`.
7. A hierarquia é um DAG acíclico:
   - múltiplos parents são permitidos;
   - self-reference e ciclos são recusados;
   - relações não possuem pesos;
   - ordem editorial não produz semântica de matching.
8. Conceitos globais e tenant-local usam namespaces distintos.
9. Um tenant não altera nem substitui conceitos globais.
10. Conceitos tenant-local exigem workflow governado:
    - `Draft`;
    - aprovação por principal distinto;
    - publicação;
    - F5;
    - F7;
    - optimistic locking;
    - provenance.
11. Depreciação não elimina conceitos usados:
    - `deprecated_at`;
    - replacement opcional;
    - aliases históricos;
    - referências anteriores continuam válidas.
12. Mappings externos são metadata versionada.
13. Mappings externos não:
    - alteram identidade;
    - criam equivalência automática;
    - produzem scoring;
    - expandem conceitos implicitamente.
14. Relações externas admitidas na v1:
    - `EXACT`;
    - `CLOSE`;
    - `BROADER`;
    - `NARROWER`.
15. Qualquer efeito futuro dessas relações em matching pertence à F14 e exige regra versionada explícita.
16. Para publicação:
    - conceitos tenant-local exigem label no locale padrão da organização;
    - seed global deve disponibilizar `pt-PT` e `en`.
17. Fallback de apresentação:
    - locale solicitado;
    - locale padrão da organização;
    - `en`;
    - código estável.
18. Fallback de label nunca altera a identidade ou digest semântico.
19. Seed e granularidade iniciais são conteúdo editorial separado da arquitetura.
20. `thematicCodes` F12 e dados UBI:
    - não são convertidos automaticamente;
    - permanecem preservados com provenance;
    - mapping exige decisão explícita;
    - mapping é versionado e auditável;
    - ausência de mapping permanece `UNKNOWN`/unmapped, não equivalência inferida.
21. Snapshots F12/F13 preservam referências e labels necessários à reprodução histórica.
22. Atualizar a taxonomia não altera snapshots nem resultados históricos.

## Invariantes

- Igualdade de label, alias ou código externo nunca significa igualdade de conceito.
- Relações hierárquicas só ligam conceitos compatíveis segundo o contrato fechado da release.
- Uma release publicada preserva conceitos, relações, traduções, aliases, depreciações e mappings usados pelo snapshot.
- O caller funcional só referencia conceitos publicados e visíveis no catálogo aplicável; não cria conceitos inline.
- Conceitos tenant-local permanecem isolados no respetivo tenant e não são promovidos implicitamente ao catálogo global.
- F13 não atribui pesos, scores, elegibilidade ou expansão transitiva com efeito de matching.

## Governance e lifecycle

- O catálogo global e os catálogos tenant-local têm namespaces e autoridades editoriais separados.
- Publicação valida unicidade, pertença a um único scheme, referências existentes, ausência de ciclos, locale obrigatório, optimistic lock e provenance.
- Alterações editoriais produzem nova release; não atualizam a release anterior.
- Depreciação e replacement orientam curadoria futura, mas não reescrevem referências existentes.
- Mappings externos fixam autoridade, scheme, versão externa, identificador, relação, provenance e versão interna que os publicou.

## Impacto nos critérios F13

- **F13-AC-03:** impede que áreas UBI se tornem o modelo universal.
- **F13-AC-05:** schemes, relações, estados, mappings e referências são fechados e versionados.
- **F13-AC-06, AC-09 e AC-12:** releases e referências publicadas são imutáveis e preservam provenance.
- **F13-AC-13:** áreas e prioridades passam a ter schemes distintos, IDs internos e releases explícitas.
- **F13-AC-20:** códigos sem mapping permanecem `UNKNOWN`/unmapped.
- **F13-AC-21 e AC-22:** conceitos tenant-local exigem F5, maker-checker e F7.
- **F13-AC-30:** relações e mappings não calculam matching ou scoring.
- **F13-AC-32:** snapshots fixam conceito, release, labels históricos necessários e digest sem depender do catálogo corrente.

## Decisões ainda pendentes

- seed inicial;
- granularidade;
- autoridade editorial global;
- processo de tradução;
- mapping concreto dos códigos F12;
- política detalhada de `UNKNOWN`;
- eventual efeito de relações externas na F14.

## Consequências

- O produto controla identidade e histórico, mas assume custo editorial do catálogo interno.
- EuroSciVoc, OECD FoRD, EuroVoc, NACE e catálogos de programas podem contribuir por mappings; nenhum é automaticamente o contrato canónico.
- A migração de códigos existentes requer workflow explícito e auditável, sem backfill inferido.
- A F14 terá de declarar, numa regra própria versionada, se e como percorre hierarquia ou mappings.

## Fontes

- `context/project-overview.md`
- `context/architecture.md`
- `context/features/opportunity-catalog.md`
- `context/features/matching-and-qualification.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f12-opportunity-catalog.md`
- `context/research/f13-thematic-taxonomy.md`
- [EU Vocabularies — EuroSciVoc](https://op.europa.eu/en/web/eu-vocabularies/euroscivoc)
- [OECD — Frascati Manual 2015](https://www.oecd.org/en/publications/2015/10/frascati-manual-2015_g1g57dcb.html)
- [EU Vocabularies — EuroVoc](https://op.europa.eu/en/web/eu-vocabularies/dataset/-/resource?uri=http%3A%2F%2Fpublications.europa.eu%2Fresource%2Fdataset%2Feurovoc)
- [W3C — SKOS Reference](https://www.w3.org/TR/skos-reference/)

## Registo da aprovação humana

A aprovação humana confirmou a opção híbrida: identidade interna estável, releases imutáveis, schemes separados, DAG com múltiplos parents, mappings externos não autoritativos e conceitos tenant-local governados. A decisão não seleciona o seed inicial e não autoriza implementação enquanto a F13 permanecer em `Draft`.
