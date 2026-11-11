# Decisão: competências e experiência institucional F13

## Estado

**Aprovada.**

## Contexto

A F13 precisa distinguir capacidade institucional declarada da experiência que pode sustentá-la. O piloto UBI associa pessoas a áreas de investigação, mas isso não prova competência institucional. Documentos, projetos, contratos e fontes externas também não podem adquirir estatuto de prova apenas por existirem.

## Decisão

1. `CompetencyConcept`, `CompetencyAssertion` e `ExperienceEvidence` são conceitos distintos.
2. O catálogo de competências é:
   - versionado;
   - publicado;
   - fechado por release;
   - referenciado por IDs estáveis;
   - compatível com mappings externos versionados.
3. `CompetencyAssertion` representa uma declaração feita num âmbito aprovado:
   - organização;
   - unidade;
   - equipa.
4. Uma assertion referencia:
   - `competency_concept_id`;
   - versão do catálogo/framework;
   - scope;
   - versão do perfil;
   - provenance;
   - lifecycle;
   - `verification_status`;
   - nível opcional.
5. Competência declarada não equivale a competência verificada.
6. Estados de verificação distinguem pelo menos:
   - `UNVERIFIED`;
   - `VERIFIED`;
   - `DISPUTED`;
   - `REVOKED`;
   - `EXPIRED`, quando aplicável.
7. Lifecycle editorial e `verification_status` são dimensões distintas.
8. Uma declaração pode integrar um snapshot como `DECLARED`/`UNVERIFIED`, desde que o estado seja preservado explicitamente.
9. A F14 não pode tratar declaração não verificada como verificada.
10. Qualquer efeito de `verification_status` no matching exige regra F14 explícita e versionada.
11. Níveis são opcionais e definidos pelo framework:
    - `framework_id`;
    - `framework_version`;
    - `level_code`.
12. Não existe escala universal C4G.
13. Não existe comparação ou ordenação entre níveis de frameworks diferentes sem mapping aprovado.
14. `ExperienceEvidence` representa experiência institucional governada.
15. Uma experiência pode suportar várias competências e uma competência pode ser suportada por várias experiências.
16. A relação many-to-many é explícita, versionada e auditável.
17. Quantidade, duração, recência, papel e resultado são observações estruturadas, não scoring.
18. Documentos F11, projetos, contratos ou fontes externas:
    - podem ser referenciados;
    - não são promovidos automaticamente a evidência verificada;
    - exigem autorização e método de verificação.
19. Verificação exige:
    - método fechado;
    - verificador autorizado por F5;
    - maker-checker quando o declarante tenha participado;
    - `verified_at`;
    - `valid_until` opcional;
    - F7;
    - provenance.
20. `UNKNOWN` significa ausência de informação suficiente e atual.
21. `NONE` significa declaração negativa explícita:
    - feita por autoridade competente;
    - versionada;
    - temporal;
    - auditável;
    - nunca inferida da ausência de assertion/evidence.
22. `UNKNOWN`, `NONE`, `UNVERIFIED` e `VERIFIED` nunca são equivalentes.
23. Correção cria nova versão ou supersession.
24. Disputa, revogação e expiração preservam a evidência histórica.
25. Alteração da fonte não reescreve snapshots anteriores.
26. Experiência anterior à plataforma pode ser registada com provenance e `verification_status` próprios.
27. Evidência é institucional por defeito.
28. Dados pessoais são minimizados:
    - referências pessoais somente quando indispensáveis;
    - acesso e retenção próprios;
    - nomes ou dados pessoais não entram automaticamente no snapshot F14.
29. ESCO e outros frameworks externos são mappings ou fontes de catálogo, não contrato universal automático.
30. O piloto UBI de professor/área de investigação não constitui prova institucional nem é migrado por inferência lexical.

## Invariantes

- O caller não cria conceitos, níveis, métodos de verificação ou tipos de evidência inline.
- Uma ligação a evidência não altera automaticamente nível ou estado de verificação.
- Scope e ownership são resolvidos internamente e têm de pertencer ao tenant.
- Uma exclusão organizacional não pode ser neutralizada por assertion de unidade/equipa.
- Texto livre, labels e conteúdo documental não entram no caminho determinístico como competência inferida.
- Snapshots preservam versões da assertion, evidência ligada, catálogo/framework e digests usados.

## Segurança, autorização e auditoria

- Declarante, verificador, aprovador e revogador derivam da sessão/membership e grants F5.
- Maker-checker é obrigatório quando o declarante participou na alegação ou evidência a verificar.
- Referências F11 respeitam autorização, estado `CLEAN`, binding e minimização; não concedem acesso documental implícito.
- Criação, verificação, disputa, revogação, expiração, publicação e supersession produzem F7 conforme a classe transacional aplicável.
- Referências pessoais são opacas e separadas do snapshot F14 salvo necessidade aprovada.

## Impacto nos critérios F13

- **F13-AC-03:** impede a universalização do modelo professor/área UBI.
- **F13-AC-05, AC-06 e AC-09:** catálogos, assertions, evidências, relações e estados são fechados, versionados e historicamente preservados.
- **F13-AC-12 e AC-14:** autoria/provenance e a separação entre alegação e evidência ficam normativas.
- **F13-AC-18:** assertions/evidências só usam scopes canónicos existentes.
- **F13-AC-20:** `UNKNOWN` e `NONE` têm semânticas distintas e explícitas.
- **F13-AC-21, AC-22 e AC-25:** verificação e acesso exigem F5, F7, RLS/IDOR e maker-checker.
- **F13-AC-30:** níveis e observações não constituem scoring.
- **F13-AC-32:** F14 recebe factos, estados e versões fixados, sem inferência lexical ou documental.

## Decisões ainda pendentes

- catálogo seed de competências;
- tipos fechados de experiência;
- métodos fechados de verificação;
- validade e revisão periódica;
- grants F5 concretos;
- retenção e minimização;
- mappings e licenças;
- políticas F14 para estados de verificação.

## Consequências

- O modelo terá mais entidades e lifecycle do que uma lista de tags, mas preserva confiança e história separadamente.
- Declarações não verificadas podem ser publicadas de forma explícita; a F14 deverá tratá-las por regra própria.
- Frameworks externos podem enriquecer interoperabilidade sem controlar a identidade interna.
- Experiência anterior à plataforma é suportada sem fabricar verificação nem migrar o piloto por semelhança lexical.

## Fontes

- `context/project-overview.md`
- `context/architecture.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-thematic-taxonomy.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`
- `context/research/f13-competencies-and-experience.md`
- [European Commission — ESCO](https://esco.ec.europa.eu/en/about-esco/what-esco)
- [JRC — DigComp 3.0](https://joint-research-centre.ec.europa.eu/scientific-activities/key-competences-lifelong-learning/digital-competence-framework-digcomp/digcomp-30_en)
- [W3C — PROV Primer](https://www.w3.org/TR/prov-primer/)

## Registo da aprovação humana

A aprovação humana confirmou a separação entre conceito, declaração e experiência/evidência, níveis específicos de framework, estados de verificação explícitos, suporte many-to-many e ausência de inferência automática a partir de documentos ou dados UBI. Esta decisão não seleciona seeds, tipos/métodos concretos nem autoriza implementação enquanto a F13 permanecer em `Draft`.
