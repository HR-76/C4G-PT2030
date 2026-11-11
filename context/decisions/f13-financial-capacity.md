# Decisão: capacidade financeira institucional F13

## Estado

**Aprovada.**

## Contexto

A F13 precisa representar capacidade financeira institucional de forma determinística e historicamente reproduzível, sem se tornar um sistema contabilístico, antecipar regras de elegibilidade da F14 ou expor informação financeira além da projeção autorizada. Requisitos financeiros encontrados em oportunidades F12 descrevem a oportunidade; não constituem factos sobre a organização.

## Decisão

1. A capacidade financeira F13 v1 existe apenas no scope `ORGANIZATION`.
2. Unidade e equipa não possuem overlays financeiros na v1.
3. F13 não agrega automaticamente organizações, grupos empresariais ou entidades relacionadas.
4. Factos financeiros usam catálogo fechado e versionado de métricas.
5. O caller não define:
   - `metric_code`;
   - unidade;
   - semântica;
   - banda;
   - política de derivação.
6. Cada definição de métrica determina:
   - dimensão;
   - unidade permitida;
   - se exige moeda;
   - se aceita valor exato;
   - se aceita intervalo;
   - periodicidade;
   - validade;
   - se `NONE` e `NOT_APPLICABLE` são semanticamente admissíveis.
7. Um facto `KNOWN` contém exatamente uma representação:
   - valor exato; ou
   - intervalo.
8. Valor exato e intervalo nunca coexistem no mesmo facto.
9. Valores numéricos usam decimal exato, não floating point.
10. Intervalos preservam limites e semântica fechada aprovada.
11. Valores monetários preservam:
    - moeda original ISO 4217;
    - unidade;
    - período;
    - origem.
12. F13 v1 não executa conversão cambial.
13. `reporting_currency` F3 não autoriza conversão F13.
14. Os estados de disponibilidade são fechados e mutuamente exclusivos:
    - `KNOWN`;
    - `UNKNOWN`;
    - `NONE`;
    - `NOT_APPLICABLE`;
    - `WITHHELD`.
15. `KNOWN` exige valor ou intervalo válido.
16. `UNKNOWN` não contém valor e significa informação insuficiente.
17. `NONE` é declaração explícita de ausência/zero:
    - só permitida pela definição da métrica;
    - autorizada;
    - temporal;
    - versionada;
    - nunca inferida.
18. `NOT_APPLICABLE` exige razão compatível com a definição da métrica.
19. `WITHHELD` significa que a informação existe mas não é divulgada naquela projeção.
20. `WITHHELD` não equivale a `UNKNOWN`.
21. `verification_status` é independente de `availability_status`.
22. Declaração e verificação financeira são atos distintos.
23. Verificação exige método fechado, autoridade F5, provenance, `verified_at` e validade opcional.
24. Limite de cofinanciamento, compromissos assumidos, disponibilidade e volume financeiro são métricas distintas.
25. Não se calcula disponibilidade subtraindo compromissos sem política publicada.
26. Bandas:
    - são derivadas;
    - usam política imutável e versionada;
    - registam `policy_version`;
    - não substituem o facto original;
    - ficam materializadas no snapshot publicado.
27. Thresholds externos não são bandas universais C4G.
28. Snapshots preservam:
    - versões dos factos;
    - catálogo de métricas;
    - períodos;
    - moeda/unidade;
    - availability e verification status;
    - política de bandas;
    - projeção autorizada;
    - digest.
29. Atualizar um facto ou política não altera snapshots históricos.
30. Valores exatos e evidências possuem acesso mais restrito que bandas ou projeções autorizadas.
31. F11 pode referenciar documentação, mas não promove automaticamente um facto a `VERIFIED`.
32. F13 exclui:
    - demonstrações financeiras completas;
    - movimentos bancários;
    - reconciliação;
    - IBAN/pagamentos;
    - salários;
    - transações detalhadas;
    - forecasting;
    - orçamento de candidatura;
    - conversão cambial;
    - elegibilidade e scoring.
33. A F14 interpreta thresholds, bandas e estados através de regras próprias e versionadas.
34. Grupos empresariais e entidades ligadas permanecem fora da v1 até decisão específica.

## Invariantes

- Factos são tenant-local, temporais, versionados e associados ao perfil organizacional aprovado.
- Correções criam nova versão ou supersession; nunca reescrevem um snapshot publicado.
- Catálogo, políticas de derivação, estados e reason codes são fechados e versionados.
- A ausência de um facto nunca é convertida implicitamente em `NONE`, zero, capacidade ou inelegibilidade.
- Valores exatos, intervalos, bandas e estados mantêm semânticas distintas.
- Uma projeção redigida não permite reconstruir o valor exato por logs, eventos, digests ou efeitos laterais.

## Segurança, autorização e auditoria

- Criação, correção, verificação, aprovação, publicação, retirada e acesso a projeções restritas exigem grants F5 específicos e produzem F7 conforme a classe transacional aplicável.
- Maker-checker aplica-se à aprovação e à verificação quando o declarante participou no facto ou na evidência.
- Evidência F11 continua sujeita ao seu próprio acesso, estado `CLEAN`, binding, retenção e minimização; a referência não concede acesso documental implícito.
- RLS/IDOR isolam organizações, e respostas, logs e telemetria não expõem valores financeiros nem identificadores de evidência.
- Exportação e retenção respeitam a classificação de confidencialidade e eventual legal hold.

## Impacto nos critérios F13

- **F13-AC-05, AC-06 e AC-09:** métricas, representações, estados, versões, políticas e snapshots são fechados, imutáveis e historicamente preservados.
- **F13-AC-12 e AC-16:** provenance, autoria e o contrato financeiro passam a ter semântica normativa.
- **F13-AC-20:** `UNKNOWN`, `NONE`, `NOT_APPLICABLE` e `WITHHELD` ficam distintos e não inferidos.
- **F13-AC-21, AC-22, AC-24 e AC-25:** acesso, auditoria, observabilidade e isolamento têm de respeitar a classificação dos factos e projeções.
- **F13-AC-30:** bandas e factos não constituem elegibilidade, peso ou scoring.
- **F13-AC-32:** snapshots fixam factos, catálogo, período, moeda/unidade, estados, política, projeção e digest consumíveis futuramente pela F14.

## Decisões ainda pendentes

- seed de métricas;
- políticas de bandas;
- métodos de verificação;
- períodos de validade;
- confidencialidade e grants F5;
- exports/redaction;
- retenção/legal hold;
- grupos empresariais;
- política cambial futura;
- regras F14.

## Consequências

- A v1 minimiza dados e risco interpretativo ao guardar factos necessários, em vez de documentação contabilística completa.
- Comparações entre períodos, moedas ou instituições não surgem por inferência; dependem de contratos e regras futuras explícitas.
- O scope exclusivamente organizacional evita dupla contagem por overlays financeiros, mas não resolve grupos ou entidades relacionadas.
- Consumidores com grants diferentes podem receber projeções diferentes do mesmo snapshot sem alterar a sua identidade semântica.

## Fontes

- `context/project-overview.md`
- `context/architecture.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-competencies-and-experience.md`
- `context/history/f3-membership-session-context.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`
- `context/research/f13-financial-capacity.md`
- [ISO — ISO 4217 currency codes](https://www.iso.org/iso-4217-currency-codes.html)
- [European Commission — SME definition](https://single-market-economy.ec.europa.eu/smes/sme-fundamentals/sme-definition_en)

## Registo da aprovação humana

A aprovação humana confirmou o scope exclusivamente organizacional na v1, o catálogo fechado de métricas, as representações numéricas exatas, os estados de disponibilidade, a separação entre declaração e verificação, as bandas derivadas por política e a minimização financeira. Esta decisão não seleciona seeds, thresholds, métodos, grants ou regras F14 e não autoriza implementação enquanto a F13 permanecer em `Draft`.
