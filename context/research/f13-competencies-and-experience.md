# F13 — Competências e experiência institucional

- Estado: **Proposta — requer aprovação humana**
- Decisão investigada: representação estruturada, versionada, verificável e universal de competências e experiência institucional, sem scoring
- Feature: `F13 — Perfil organizacional para matching`
- Data: 2026-10-10

## Decisão a suportar

Determinar se a F13 deve separar o que a organização declara ser capaz de fazer da experiência/evidência que pode sustentar essa declaração, preservando âmbito, provenance, validade temporal e consumo determinístico futuro pela F14.

Esta investigação não decide capacidade financeira, capacidade operacional geral, territórios, beneficiários, scoring, pesos, elegibilidade, matching, qualificação humana ou UI.

## Factos estabelecidos pelo repositório

### Contratos aprovados

- Competências e perfis são tenant-local; membership Central continua a fonte de verdade do acesso.
- A decisão de âmbito F13 estabelece baseline organizacional e overlays opcionais `UNIT`/`TEAM`. F13 não cria unidade/equipa e não existe herança implícita equipa→unidade.
- A taxonomia temática aprovada estabelece o padrão de IDs internos estáveis, catálogos/releases imutáveis, mappings externos versionados e referências históricas por ID+versão. Ainda não existe decisão equivalente para um catálogo de competências.
- F5 exige permissions/operations/scopes fechados e recurso carregado internamente. F7 exige autoria/provenance e eventos sanitizados. F11 permite referenciar documentos privados por metadados/bindings autorizados; a existência de um documento não o torna evidência verificada.
- F12 oferece snapshots imutáveis de oportunidades com campos temáticos, território, beneficiários, funding e resumo de elegibilidade. Não contém um contrato canónico de requisitos de competência nem prova de experiência institucional.
- Os padrões F7/F12 preservam versão, digest, provenance, idempotência e correção por nova versão em vez de reescrita histórica.

### Modelo futuro, piloto e conceitos inexistentes

- O dicionário lógico prevê `competency` com owner organização/unidade/equipa/membro e `organization_profile_version`, mas não separa claramente alegação, nível e evidência nem constitui schema físico aprovado.
- As migrations tenant atuais não materializam competências ou experiência institucional F13.
- O piloto UBI associa professores a áreas de investigação e usa texto/labels para matching lexical. Isso descreve pessoas e áreas do piloto; não prova capacidade institucional, proficiência ou experiência concluída.
- Existem dados de oportunidades, documentos e, no produto futuro, candidaturas/projetos/contratos. Nenhum destes deve ser tratado automaticamente como evidência aceite sem tipo, snapshot, autorização e verificação explícitos.

## Inferências sustentadas

1. Competência é uma declaração de capacidade; experiência é um facto/evento histórico potencialmente demonstrável. Misturá-las faria a simples existência de um projeto ou documento criar capacidade implicitamente.
2. Uma competência pode existir como declaração ainda não verificada. O estado de verificação deve acompanhar a declaração, não ser inferido da presença de anexos.
3. Uma experiência pode sustentar várias competências, e uma competência pode ser sustentada por várias experiências; a relação é many-to-many, explícita e versionada.
4. Escalas universais de proficiência não são comparáveis em todos os domínios. Quando existirem níveis, pertencem à versão do catálogo/framework da competência.
5. Quantidade, duração, recência, papel e resultado são observações, não scores. F13 preserva-as; somente F14 poderá atribuir efeito através de regra versionada.
6. Correção ou revogação não pode apagar aquilo que um snapshot histórico considerou. Deve criar nova versão/estado e preservar a evidência anteriormente observada.

## Evidência externa relevante

- ESCO é uma classificação multilingue de skills, competências e ocupações destinada sobretudo a emprego, educação e formação. Possui conceitos e relações legíveis por sistemas, versões descarregáveis/API e cobertura em 28 idiomas; é útil como mapping, mas a sua finalidade centrada no mercado de trabalho não prova adequação como contrato universal de capacidade institucional ([European Commission — What is ESCO?](https://esco.ec.europa.eu/en/about-esco/what-esco), [ESCO downloads and versions](https://esco.ec.europa.eu/en/use-esco/download)).
- DigComp 3.0 associa níveis de proficiência a competências digitais concretas e define quatro níveis com base em exigência cognitiva, complexidade e autonomia. Isto mostra que níveis coerentes dependem do framework e do domínio, não de uma escala genérica aplicada a qualquer competência ([JRC — DigComp 3.0](https://joint-research-centre.ec.europa.eu/scientific-activities/key-competences-lifelong-learning/digital-competence-framework-digcomp/digcomp-30_en)).
- Os recursos DigComp são publicados em formatos estruturados e sob CC BY 4.0, com instruções específicas para adaptação e tradução. Conteúdo externo precisa, portanto, de versão, licença, attribution/provenance e indicação de adaptações ([JRC — DigComp 3.0 resources](https://joint-research-centre.ec.europa.eu/scientific-activities/key-competences-lifelong-learning/digital-competence-framework-digcomp/digcomp-30-resources_en)).
- W3C PROV distingue entidades, atividades, agentes e papéis/atribuição. É um vocabulário útil para modelar provenance, mas não define quais tipos de evidência C4G deve aceitar nem verifica a veracidade de uma alegação ([W3C — PROV Primer](https://www.w3.org/TR/prov-primer/)).

## Opções viáveis

| Critério | A. Tags livres/semiestruturadas | B. Catálogo fechado + nível declarado | C. Catálogo versionado + declarações + experiência/evidência separada |
| --- | --- | --- | --- |
| Universalidade | Alta na entrada, baixa na interpretação | Boa se o catálogo for abrangente | Boa; catálogo/mappings evoluem sem confundir prova |
| Determinismo | Fraco; depende de texto e normalização | Bom para identidade/nível | Forte: identidade, declaração e evidência têm versões próprias |
| Verificabilidade | Quase inexistente | Nível continua a ser alegação | Estado de verificação e evidência ficam explícitos |
| Histórico | Difícil comparar alterações textuais | Preserva versões da declaração | Preserva declaração, evidência, relação e snapshots |
| Âmbito | Fácil, mas ambíguo | Pode ser associado ao scope | Scope canónico em cada declaração/experiência |
| Dados externos | Texto/códigos ad hoc | Catálogo pode ter mapping | Mappings de catálogo e referências de evidência são governados |
| Privacidade | Risco de PII em texto livre | Menor | Menor com tipos fechados, minimização e referências F11 |
| Custo | Baixo inicialmente; elevado para limpeza | Moderado | Maior, mas evita que anexos/projetos virem prova implícita |
| Consumo F14 | Exigiria inferência lexical | Determinístico, mas não distingue confiança | Determinístico por IDs/versões/status; scoring continua fora de F13 |

## Recomendação

Recomenda-se a **Opção C: catálogo versionado de competências, separado de declarações de competência e de registos de experiência/evidência**.

Os nomes abaixo são um modelo de análise, não um schema aprovado.

### 1. Catálogo de competências

- Cada competência usa `competency_concept_id` interno estável e `catalog_version` publicada e imutável.
- O catálogo pode mapear ESCO ou frameworks setoriais, mas mappings externos não alteram identidade nem criam proficiência/equivalência automática.
- Conceitos globais e tenant-local seguem namespaces/governance equivalentes aos da taxonomia temática, sem criação inline pelo caller.
- Cada conceito declara se admite nível e, nesse caso, qual `level_scheme_version` fechado se aplica. Ausência de esquema significa que `declared_level` é proibido.
- Não existe uma escala numérica universal C4G para todas as competências.

### 2. Declaração de competência (`CompetencyAssertion`)

Uma declaração versionada deve fixar, conceptualmente:

- scope aprovado: organização, unidade ou equipa e respetivo ID resolvido internamente;
- `competency_concept_id` e `catalog_version`;
- `declared_level` opcional, sempre acompanhado de `level_scheme_version`;
- `verification_status` separado da declaração;
- `valid_from` e `valid_until` opcionais sob política fechada;
- provenance, autor, aprovador/verificador e timestamps;
- versão, digest, optimistic lock e lifecycle.

Estados de verificação candidatos: `UNVERIFIED`, `VERIFIED`, `DISPUTED`, `REVOKED`. Lifecycle editorial e verificação são dimensões distintas: publicar uma declaração não a torna verificada.

Uma competência pode existir sem experiência associada, mas permanece declarada/não verificada e a F14 terá de tratar esse estado explicitamente numa decisão própria.

### 3. Experiência/evidência (`ExperienceEvidence`)

Um registo de experiência versionado deve fixar:

- tipo fechado, por exemplo `INTERNAL_PROJECT`, `FUNDED_PROJECT`, `APPLICATION`, `CONTRACT_DELIVERY`, `CERTIFICATION`, `PUBLICATION` ou `GOVERNED_EXTERNAL_RECORD` — lista final ainda requer aprovação;
- período observado, separado do momento de registo/verificação;
- papel fechado da organização/âmbito;
- scope organizacional canónico;
- referência interna governada ou referência externa allowlisted;
- zero ou mais ligações explícitas às competências que suporta;
- `verification_status`, verificador e método fechado;
- provenance, snapshot canónico, digest, versão e lifecycle.

Uma experiência pode suportar várias competências. A ligação declaração↔evidência deve ser própria, versionada e indicar o aspeto suportado; anexar evidência não altera automaticamente nível ou verificação.

### 4. Evidência admissível e anterior à plataforma

- Referências internas podem apontar para recursos governados futuros (projeto, candidatura, contrato) ou para documento F11 já `CLEAN`, autorizado e ligado por binding. O conteúdo documental nunca é promovido automaticamente a facto verificado.
- Experiência anterior à plataforma entra como `GOVERNED_EXTERNAL_RECORD` ou tipo específico aprovado, com fonte, período, referência, snapshot/digest, ator que declarou e principal distinto que verificou.
- URLs, identificadores externos ou documentos são evidência candidata; não são prova aceite apenas por existirem.
- O snapshot deve conter factos mínimos necessários, não cópias indiscriminadas de contratos/documentos nem dados pessoais de participantes.

### 5. Nível, quantidade, duração, recência e resultado

- `declared_level` é uma alegação. Um nível verificado precisa de verificação própria e método compatível com o scheme.
- Quantidade, duração e medidas de resultado só são permitidas como observações tipadas com unidade, período, provenance e método. Não são agregadas numa pontuação pela F13.
- Recência é derivada posteriormente de datas fixadas no snapshot; F13 não mantém um score temporal mutável.
- Resultado usa código fechado e contextual ao tipo de experiência; texto livre pode existir apenas como nota não autoritativa, limitada e fora do caminho determinístico.

### 6. UNKNOWN, NONE e validade

- `UNKNOWN` significa não avaliado ou informação insuficiente; não significa ausência nem incompatibilidade.
- `NONE` significa uma afirmação explícita e revista de ausência no scope/data aplicável; exige provenance e aprovação. Ausência de registo nunca é convertida em `NONE`.
- Uma declaração pode expirar (`valid_until`) ou exigir revisão segundo política versionada. Expiração bloqueia uso futuro, mas não apaga snapshots históricos.
- Revogação cria estado/versionamento novo com reason code fechado; não reescreve a declaração/evidência anteriormente usada.

### 7. Scope, overlays e exclusões

- Declarações e experiências pertencem a `ORGANIZATION`, `UNIT` ou `TEAM` segundo entidades canónicas existentes.
- O snapshot efetivo segue a decisão aprovada: baseline organizacional + no máximo um overlay. Unidades/equipas podem acrescentar afirmações próprias conforme contrato fechado; não herdam entre si.
- Uma exclusão organizacional aplicável não pode ser neutralizada por declaração local. Uma declaração contraditória pode permanecer em draft para correção, mas não pode ser aprovada/ativada no snapshot efetivo.
- Evidência local não altera por si mesma a declaração organizacional; qualquer promoção exige nova versão e aprovação.

### 8. Autoria, aprovação e maker-checker

- Declarante, verificador, aprovador e revogador são papéis distintos no modelo, derivados de membership/sessão F5 e nunca do payload.
- Maker-checker é obrigatório para verificar evidência, publicar uma declaração verificada, revogar uma declaração/evidência usada e aprovar `NONE`.
- A política poderá permitir publicar uma declaração `UNVERIFIED` com rotulagem explícita, mas isso ainda exige autorização e não equivale a verificação.
- F7 regista criação, alteração, verificação, aprovação, publicação, expiração, disputa e revogação com IDs/digests sanitizados.

## Como a F14 consumiria sem inferência lexical

O snapshot F13 forneceria factos fechados semelhantes a:

```text
CompetencyFact {
  competencyConceptId,
  catalogVersion,
  levelSchemeVersion?,
  declaredLevel?,
  verificationStatus,
  validAt,
  supportingEvidenceRefs[],
  assertionVersion,
  digest
}
```

F14 compara IDs e versões através de regras explícitas. Não extrai competências de labels, notas ou documentos; não converte quantidade/recência/verificação em peso sem decisão F14 versionada.

## Segurança e integridade

- Toda persistência é tenant-local com RLS e testes A/B; scope e resources são carregados internamente.
- Referências a F11 respeitam autorização própria, estado `CLEAN`, binding e minimização. A F13 conserva referência/digest e metadata necessária, não acesso implícito ao documento.
- Referências externas usam schemes/hosts/tipos allowlisted e snapshots sanitizados; conteúdo remoto mutável nunca é fonte suficiente sem captura/versionamento governado.
- Pessoas individuais não são necessárias para provar experiência institucional por omissão. Quando autoria ou papel pessoal for indispensável, usa-se referência opaca autorizada e minimização, não nomes/contactos livres.
- Correção cria nova versão; disputas/revogações preservam o estado anterior e o snapshot usado.
- IDOR, cross-tenant IDs, scopes arquivados, catálogo/versão desconhecidos e evidence references incompatíveis falham fechado.

## Riscos e decisões humanas restantes

1. Aprovar ou rejeitar a Opção C.
2. Aprovar o catálogo interno de competências e a governance de conceitos globais/tenant-local.
3. Aprovar a lista inicial de tipos de experiência e papéis institucionais.
4. Decidir se declarações `UNVERIFIED` podem integrar snapshots disponíveis à F14 ou apenas drafts.
5. Aprovar os estados de verificação e lifecycle, incluindo `DISPUTED` e `REVOKED`.
6. Definir frameworks/competências que admitem nível e respetivos level schemes; rejeitar uma escala universal por defeito.
7. Definir validade/revisão por tipo de competência e evidência.
8. Definir critérios/métodos de verificação e permissions F5 exatas para declarante, verificador, aprovador e revogador.
9. Aprovar a semântica de `NONE`; até lá, só `UNKNOWN` e declarações positivas devem ser consumíveis.
10. Definir quais recursos futuros (projetos, candidaturas, contratos) podem ser referências internas e em que estado.
11. Definir minimização, retenção e eventual tratamento de dados pessoais nas evidências.
12. Definir mappings externos iniciais e verificar licença/attribution de cada dataset selecionado.

## Implicações para F13 e F14

Se aprovada, F13 deve:

- separar catálogo, declaração, experiência e relação de suporte;
- fixar IDs, versões, estados, datas, provenance e digests;
- impedir inferência a partir de texto/documentos;
- tornar níveis opcionais e específicos do framework;
- preservar `UNKNOWN` e exigir afirmação explícita para `NONE`;
- aplicar scope/overlay e exclusões já aprovados;
- materializar no snapshot apenas factos permitidos pela política de completude/verificação.

F14 deverá decidir separadamente como estados de verificação, níveis, quantidade, duração, recência e mappings influenciam matching. Nenhuma dessas observações tem peso intrínseco na F13.

## Limites da investigação

- Os nomes `CompetencyAssertion` e `ExperienceEvidence` são modelos candidatos, não entidades aprovadas.
- Não foram definidos schema SQL, endpoints, UI, migrations, jobs, scoring ou integrações externas.
- ESCO, DigComp e PROV são referências/mappings potenciais; nenhum foi adotado como contrato canónico.
- A recomendação não é arquitetura aprovada e não autoriza implementação.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/features/matching-and-qualification.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-thematic-taxonomy.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `backend/src/opportunities/contracts.js`
- `backend/src/opportunities/provenance.js`
- `backend/src/opportunities/digests.js`
- `backend/src/utils/researchAreaMatcher.js`
