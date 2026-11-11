# F13 — Capacidade operacional institucional

**Estado:** Investigação; recomendação sujeita a aprovação humana
**Decisão:** Como representar capacidade operacional institucional de forma temporal, versionada, auditável e determinística, sem criar RH, inventário patrimonial ou planeamento de projetos?

## Limites da investigação

Inclui disponibilidade agregada de pessoas, capacidade de execução, instalações, equipamentos/infraestruturas, capacidade administrativa e técnica, horizonte temporal, evidência, verificação, scopes aprovados, estados explícitos e snapshots. Exclui pessoas individuais, salários, horários, desempenho, recrutamento, timesheets, gestão detalhada de ativos, manutenção, procurement, planeamento/calendarização de projetos, orçamento, scoring, elegibilidade e matching.

## Factos estabelecidos pelo repositório

### Contratos aprovados

- O perfil F13 tem base organizacional obrigatória e overlays opcionais apenas para unidades/equipas canónicas existentes; equipa não herda implicitamente da unidade e a composição publicada é explícita e imutável.
- F13 não governa unidades ou equipas. O modelo lógico futuro prevê `organizational_unit` e `team`, mas as migrations tenant atuais ainda não as materializam.
- F5 usa scopes fechados e não admite herança implícita. F7 exige auditoria source-local sanitizada; F10 proíbe IDs de organização, unidade, equipa, perfil ou ator como labels operacionais.
- A decisão de competências separa `CompetencyAssertion` — aquilo que a instituição declara saber/fazer — de `ExperienceEvidence` — aquilo que demonstra historicamente. Capacidade operacional ainda não tem contrato aprovado.
- A decisão financeira estabelece um precedente útil: catálogos fechados, períodos, valores/intervalos exatos, availability e verification independentes, políticas derivadas versionadas e snapshots imutáveis.
- Documentos F11 podem sustentar uma verificação autorizada, mas nunca são promovidos automaticamente a prova verificada.
- F12 preserva requisitos e provenance de oportunidades. Esses requisitos descrevem procura externa; não provam oferta/capacidade institucional.

### Implementação atual e piloto

- O piloto UBI contém professores, afiliações, centros/faculdades, equipas de candidatura e responsáveis. Não contém um modelo aprovado de capacidade agregada, disponibilidade, instalações ou recursos operacionais.
- Professor, área de investigação, contagem de pessoas ou afiliação não podem ser convertidos por inferência em capacidade institucional.
- Não foi encontrado um catálogo operacional, contrato de FTE, modelo de inventário ou política de prevenção de dupla contagem que possa ser promovido a F13.

## Distinções necessárias

- **Competência:** aptidão institucional declarada ou verificada para executar uma classe de trabalho.
- **Experiência:** evidência histórica governada de atividade realizada.
- **Capacidade operacional:** recursos ou serviços agregados que a instituição pode disponibilizar num horizonte e âmbito definidos.
- **Disponibilidade corrente:** observação temporal dentro de uma assertion; não constitui reserva, compromisso de projeto ou agenda operacional.
- **Inventário:** cadastro de pessoas ou ativos concretos; permanece fora da F13, embora uma fonte governada possa sustentar uma assertion agregada.

## Evidência externa relevante

- A Comissão Europeia descreve infraestruturas de investigação como instalações que fornecem recursos e serviços e que podem ser físicas, distribuídas ou virtuais. Isto favorece representar capacidade/acesso, não copiar um inventário patrimonial para o perfil ([European Commission — European research infrastructures](https://research-and-innovation.ec.europa.eu/strategy/strategy-research-and-innovation/our-digital-future/european-research-infrastructures_en)).
- A definição europeia de technology infrastructures inclui instalações, equipamento, capacidades e recursos para desenvolver, testar, ampliar e validar tecnologia. A semântica relevante é a capacidade disponível e o modo de acesso, não apenas a posse do ativo ([European Commission — Technology infrastructures](https://research-and-innovation.ec.europa.eu/research-area/industrial-research-and-innovation/technology-infrastructures_en)).
- O Manual de Frascati mede FTE como contribuição anual para I&D e distingue pessoas internas/externas e trabalho parcial/integral; por isso FTE exige domínio e período explícitos e não serve como unidade universal de toda capacidade institucional ([OECD — Frascati Manual 2015](https://www.oecd.org/content/dam/oecd/en/publications/reports/2015/10/frascati-manual-2015_g1g57dcb/9789264239012-en.pdf)).
- O Eurostat observa que FTE depende das horas anuais típicas de tempo integral, que variam entre atividades, limitando comparabilidade. Isto sustenta definições de métrica versionadas em vez de um número FTE sem contexto ([Eurostat — European business statistics manual](https://ec.europa.eu/eurostat/documents/3859598/12433023/KS-GQ-20-006-EN-N.pdf/0c31c77a-5d20-9954-9223-2b856fdb93c9?t=1613481618625)).

## Opções viáveis

| Opção | Determinismo e auditabilidade | Minimização e atualidade | Scopes/dupla contagem | Custo e consumo F14 |
|---|---|---|---|---|
| A. Narrativa ou tags livres | Baixos; depende de interpretação lexical | Poucos campos, mas difícil expirar/verificar | Ambíguos | Baixo na edição, alto e não determinístico no consumo |
| B. Inventário detalhado de pessoas, equipamentos e instalações | Estruturado, mas transforma F13 noutros sistemas | Elevado risco pessoal/patrimonial e rápida desatualização | Pode agregar, mas exige contabilidade operacional extensa | Muito alto; excede o âmbito |
| C. Assertions agregadas, temporais e versionadas | Alto, com catálogo e snapshots fechados | Guarda apenas factos/projeções necessários | Exige política explícita de cobertura e não sobreposição | Moderado; entrega dados estáveis à F14 sem scoring |

## Recomendação

Recomenda-se a **Opção C: assertions operacionais agregadas, versionadas e temporais, apoiadas por evidência governada e materializadas em snapshots publicados**.

### 1. Catálogo fechado de métricas

Cada `capacity_metric_code` pertence a uma release imutável e determina:

- dimensão e definição semântica;
- unidade e representações permitidas (exato, intervalo ou banda publicada);
- scopes permitidos (`ORGANIZATION`, `UNIT`, `TEAM`);
- horizonte/período admitido e validade;
- agregabilidade e chave de partição/cobertura;
- papéis quantitativos admitidos (`TOTAL`, `COMMITTED`, `RESERVED`, `AVAILABLE`);
- se algum papel pode ser derivado e por qual política versionada;
- access modes, estados de disponibilidade e métodos de verificação admitidos;
- confidencialidade e regras de prevenção de dupla contagem.

O caller escolhe apenas códigos permitidos ao contexto carregado pelo servidor; não cria métricas, unidades, scopes, estados, fórmulas ou semântica inline.

### 2. Categorias mínimas candidatas

As famílias seguintes são candidatas a seed editorial, não uma taxonomia já aprovada:

1. **Pessoas em agregado:** capacidade em unidade definida pelo catálogo (por exemplo, FTE ou pessoa-mês apenas quando adequado ao domínio/período).
2. **Execução/entrega:** throughput ou limite de simultaneidade declarado para um serviço ou tipo de atividade fechado.
3. **Capacidade administrativa:** capacidade agregada para preparar/administrar projetos, contratos ou reporting, distinta da competência da equipa.
4. **Capacidade técnica/de serviço:** volume operacional disponibilizável por uma função técnica fechada.
5. **Instalações, equipamentos e infraestruturas:** capacidade ou acesso agregado, sem cadastro patrimonial detalhado.

Nenhuma destas famílias autoriza contagem de colaboradores, ativos ou certificações por inferência.

### 3. Assertion operacional candidata

Uma `OperationalCapacityAssertion` deve fixar, no mínimo:

- scope e ID canónico resolvidos internamente;
- `capacity_metric_code` e `catalog_version`;
- período/horizonte fechado (`POINT_IN_TIME`, `PERIOD_CAPACITY` ou `RECURRING_WINDOW`, se aprovados);
- exatamente uma representação quantitativa permitida ou um estado sem valor;
- unidade e papel quantitativo (`TOTAL`, `COMMITTED`, `RESERVED` ou `AVAILABLE`);
- boundary/partition de cobertura e semântica de rollup;
- `availability_status` e `verification_status` independentes;
- `access_mode`, quando aplicável;
- provenance, evidência referenciada, validade, confidencialidade, versão e lifecycle.

Os nomes são candidatos ao contrato, não arquitetura aprovada.

### 4. Total, comprometido, reservado e disponível

- São observações distintas; a ausência de uma não autoriza inferir outra.
- `AVAILABLE = TOTAL - COMMITTED - RESERVED` só pode ser materializado por política publicada quando métrica, unidade, scope, boundary e período são idênticos e a política define validações e arredondamento.
- Sem essa política, cada valor é declarado/verificado separadamente.
- F13 não cria reservas nem atualiza disponibilidade a partir de candidaturas; isso pertence ao futuro pipeline operacional.

### 5. Scope e prevenção de dupla contagem

- Organização, unidade ou equipa podem declarar apenas métricas cujo catálogo admita esse scope e quando a entidade canónica está ativa.
- O perfil-base organizacional mantém restrições e exclusões; assertions locais especializam um âmbito, não substituem silenciosamente factos organizacionais.
- Equipas não herdam assertions de unidades.
- Factos de níveis diferentes não são somados automaticamente. Cada assertion declara coverage/boundary fechado, por exemplo `DIRECT_ONLY` ou `INCLUSIVE_ROLLUP`, e uma partition key governada quando a métrica for agregável.
- Um snapshot rejeita composições sobrepostas ou ambíguas; a organização não pode contar a mesma capacidade novamente através de unidade/equipa.
- Arquivar unidade/equipa impede novas assertions/ativações, mas não reescreve snapshots históricos.

### 6. Pessoas agregadas e FTE

- F13 guarda apenas agregados, intervalos ou bandas autorizadas; não guarda colaboradores, horários ou timesheets.
- FTE é opcional e específico da definição da métrica, com domínio, período, denominator/método e população de cobertura explícitos.
- Métricas para as quais FTE seja inadequado usam outra unidade aprovada; não existe unidade universal C4G.
- Grupos pequenos exigem política de divulgação: banda, `WITHHELD` ou projeção redigida, conforme limiar humano ainda por decidir.

### 7. Instalações, equipamentos e infraestruturas

- A assertion representa a capability disponível: contagem agregada, slots/horas, throughput, área/capacidade ou simples estado, conforme métrica fechada.
- `access_mode` distingue pelo menos conceitos a decidir como `OWNED`, `LEASED`, `SHARED`, `PARTNER_ACCESS` e `CONTRACTED`; posse não é requisito universal.
- Certificação é evidência de capacidade quando qualifica uma instalação/serviço; é competência/experiência quando qualifica conhecimento ou execução histórica. A classificação é explícita e não se propaga automaticamente.
- Gestão do ativo, manutenção, procurement e reserva ficam fora da F13.

### 8. Estados, verificação e lifecycle

- `KNOWN`, `UNKNOWN`, `NONE`, `NOT_APPLICABLE` e `WITHHELD` são fechados, mutuamente distintos e seguem semântica análoga à decisão financeira, condicionada pela definição da métrica.
- `verification_status` é independente; uma assertion declarada não equivale a verificada.
- Evidência admissível usa tipos e métodos fechados. Documento F11, sistema fonte ou contrato apenas fornece provenance; um verificador F5 autorizado decide o estado.
- Criação, verificação, aprovação, disputa, revogação, expiração e supersession preservam versões e F7. Maker-checker aplica-se onde o declarante participou.
- `valid_until` e revisão periódica são determinados pelo catálogo/política; expiração nunca apaga história.

### 9. Snapshot operacional candidato

Um `OperationalCapacitySnapshot` publicado preserva:

- versões exatas das assertions;
- catálogo e policies usados;
- composição de scopes e boundaries;
- período/horizonte, unidades, estados, verification e access modes;
- projeção autorizada, digest e `effective_at`.

A F14 recebe IDs, códigos, valores/intervalos/bandas, estados e versões fixados. Não lê labels/texto livre, não recompõe disponibilidade a partir de estado corrente e não infere capacity de documentos, pessoas ou ativos.

## Respostas às questões obrigatórias

- **Competência versus capacidade?** Competência descreve aptidão; capacidade descreve recurso/serviço agregadamente disponibilizável num período.
- **Categorias universais?** Apenas famílias editoriais candidatas; métricas concretas exigem catálogo aprovado.
- **Pessoas/FTE?** Só agregados; FTE é opcional, contextual e nunca unidade universal.
- **Total/committed/reserved/available?** Papéis distintos, derivados apenas por política publicada compatível.
- **Horizonte?** Ponto temporal, período de capacidade e janela recorrente são candidatos fechados; F13 não agenda recursos.
- **Scopes?** Podem existir nos três scopes aprovados se a métrica o permitir, sem herança ou soma implícita.
- **Dupla contagem?** Coverage, partition e rollup explícitos; composição ambígua é recusada.
- **Equipamentos/instalações?** Capability/acesso agregado, não inventário; propriedade e acesso são distintos.
- **Certificações?** Classificadas pelo objeto certificado e ligadas como evidência, sem efeito automático.
- **Capacidade administrativa?** Métricas agregadas de serviço/throughput, separadas de competências pessoais.
- **Valores?** Exato, intervalo ou banda apenas conforme catálogo e confidencialidade.
- **Estados?** Disponibilidade e verificação são dimensões distintas; estados de ausência nunca são inferidos.
- **Evidência?** Referência governada com provenance e verificação explícita; F11 não promove automaticamente.
- **Consumo F14?** Códigos/versões/valores/estados fixados, sem inferência lexical ou scoring F13.
- **Futuro pipeline?** Reservas, alocações, calendários, utilização real e planeamento de projeto ficam fora da F13.

## Segurança e minimização

- Dados são tenant-local, com RLS/IDOR e scope resolvido internamente; referências de outras organizações falham fechado.
- F5 separa declarar, verificar, aprovar, publicar, consultar detalhe e exportar. F7 regista ações críticas com payload minimizado.
- Agregados de grupos pequenos podem reidentificar pessoas; exatidão fica restrita e projeções usam banda, supressão ou `WITHHELD` segundo política ainda pendente.
- Identificadores pessoais, nomes, horários e dados laborais não entram no perfil/snapshot. Referências pessoais excepcionais ficam separadas, autorizadas e sujeitas a retenção própria.
- Evidência F11 não é incluída no snapshot; este conserva referência/digest/provenance mínimos e a conclusão da verificação.
- Exports aplicam grants, purpose e redaction próprios. Logs/telemetria F10 não incluem valores, IDs de scope/evidência ou cardinalidades sensíveis.
- Correção cria nova versão; disputa/revogação preserva a afirmação e snapshots já consumidos.

## Riscos e decisões humanas restantes

1. Aprovar ou rejeitar a Opção C e as distinções entre competência, experiência, capacidade e disponibilidade.
2. Aprovar famílias e seed inicial de métricas, unidades e scopes permitidos.
3. Definir coverage, partition, rollups e regras concretas de prevenção de dupla contagem.
4. Definir horizontes e periodicidade, incluindo semântica de janelas recorrentes.
5. Decidir quando `TOTAL`, `COMMITTED`, `RESERVED` e `AVAILABLE` são declarados ou derivados.
6. Decidir onde FTE é admissível, o método de cálculo e alternativas por domínio.
7. Aprovar access modes de infraestrutura e tratamento de certificações.
8. Definir tipos de evidência, métodos de verificação, validade e revisão periódica.
9. Definir thresholds de pequenos grupos, confidencialidade, grants F5, exports/redaction e retenção.
10. Fixar tratamento de `UNKNOWN`, `NONE`, `NOT_APPLICABLE` e `WITHHELD` na política geral F13.
11. Delimitar as futuras regras F14 e a fronteira com reservas, scheduling e planeamento do pipeline de candidaturas.

## Implicações para F13 e F14

- **F13-AC-05, AC-06, AC-09 e AC-17:** catálogo, assertions, estados, periods, políticas e snapshots terão contratos fechados, versionados e historicamente preservados.
- **F13-AC-18:** unit/team só podem ser referenciados quando o modelo canónico dessas entidades existir e estiver ativo.
- **F13-AC-20:** estados desconhecidos/negativos/redigidos permanecem distintos.
- **F13-AC-21, AC-22, AC-24 e AC-25:** dados operacionais exigem autorização, auditoria, observabilidade sanitizada e isolamento, com proteção reforçada para grupos pequenos.
- **F13-AC-30:** nenhum valor, banda, verificação ou access mode produz score ou elegibilidade nesta feature.
- **F13-AC-32:** a F14 consumirá um snapshot inequívoco e não estado operacional mutável ou texto livre.

## Limites reais da recomendação

A investigação não aprova nomes de entidades, métricas, fórmulas, FTE, scopes concretos, horizons, access modes, thresholds de divulgação, grants ou políticas F14. Também não afirma que qualquer framework externo seja contrato universal. Esses elementos exigem decisão humana e validação posterior antes do planeamento F13.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-competencies-and-experience.md`
- `context/decisions/f13-financial-capacity.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f10-operational-observability.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`

## Fontes externas

- [European Commission — European research infrastructures](https://research-and-innovation.ec.europa.eu/strategy/strategy-research-and-innovation/our-digital-future/european-research-infrastructures_en)
- [European Commission — Technology infrastructures](https://research-and-innovation.ec.europa.eu/research-area/industrial-research-and-innovation/technology-infrastructures_en)
- [OECD — Frascati Manual 2015](https://www.oecd.org/content/dam/oecd/en/publications/reports/2015/10/frascati-manual-2015_g1g57dcb/9789264239012-en.pdf)
- [Eurostat — European business statistics manual](https://ec.europa.eu/eurostat/documents/3859598/12433023/KS-GQ-20-006-EN-N.pdf/0c31c77a-5d20-9954-9223-2b856fdb93c9?t=1613481618625)

Next step: aprovar ou corrigir a recomendação de capacidade operacional antes de investigar a política de dados desconhecidos.
