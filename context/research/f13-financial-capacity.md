# F13 — Capacidade financeira institucional

- Estado: **Proposta — requer aprovação humana**
- Decisão investigada: representação mínima, temporal, versionada e auditável de capacidade financeira institucional para futuro consumo determinístico
- Feature: `F13 — Perfil organizacional para matching`
- Data: 2026-10-10

## Decisão a suportar

Definir quais factos financeiros mínimos a F13 pode preservar sem se transformar num sistema contabilístico, sem armazenar documentação financeira completa e sem executar conversão cambial, elegibilidade ou scoring.

Esta investigação cobre períodos, moeda/unidade, factos ou intervalos, bandas publicadas, provenance/evidência, verificação, validade, confidencialidade, estados de disponibilidade e snapshots. Exclui contabilidade geral, reconciliação bancária, orçamento de candidaturas, forecasting, reporting financeiro, dados bancários, pagamentos e interpretação de avisos.

## Factos estabelecidos pelo repositório

### Dado existente versus capacidade institucional

- F12 preserva `fundingAmountMin`, `fundingAmountMax` e `currencyCode` no snapshot da oportunidade. Estes valores descrevem a oportunidade, não a capacidade financeira da organização.
- O piloto UBI guarda `total_budget` e `university_budget` em candidaturas e produz agregados de pipeline/aprovado. São valores de candidatura/reporting do piloto, não declarações universais de capacidade institucional.
- A Central F3 já exige `reporting_currency` por organização, mas isso é preferência de reporting e não autoriza converter factos F13 nem alterar a moeda original.
- O dicionário lógico futuro distingue valores financeiros de candidatura, snapshots financeiros imutáveis e snapshots de conversão com fonte/data/regra. Esse desenho é evidência útil, mas não é implementação ou contrato aprovado da F13.

### Contratos aplicáveis

- A decisão de âmbito exige baseline organizacional e overlays por campo apenas quando explicitamente permitidos. Alterações não reescrevem snapshots.
- F5/F7 exigem autorização, maker-checker, provenance e eventos sanitizados. F11 pode guardar documentação privada, mas F13 deve referenciar apenas evidência autorizada e mínima.
- F12 usa decimal em formato canónico e códigos de moeda com três letras; montante mínimo/máximo/moeda são presentes em conjunto e integram o digest.
- Retenção, legal hold, exportação e acesso são políticas próprias; dados confidenciais não devem aparecer em logs, métricas ou snapshots destinados a consumidores sem necessidade.

## Inferências sustentadas

1. Capacidade jurídica/financeira pertence à organização por omissão. Uma unidade ou equipa não deve declarar turnover, balanço ou capacidade de cofinanciamento institucional como se fosse entidade autónoma.
2. Orçamento atribuído a uma unidade é uma alocação interna, não capacidade financeira institucional. Misturá-los causaria dupla contagem.
3. Ano civil e exercício contabilístico são conceitos diferentes; todo facto precisa de período exato e tipo de período.
4. Moeda original é parte do facto. Converter sem fonte, data, precisão e regra mudaria o significado histórico.
5. Valores exatos podem ser necessários para verificação, mas a F14 pode precisar apenas de um intervalo/banda publicada. Acesso ao valor fonte e acesso ao snapshot consumível devem ser separados.
6. Volume anual, orçamento aprovado, limite de cofinanciamento, compromissos assumidos e disponibilidade residual são métricas diferentes e não podem partilhar um campo genérico `amount` sem `metric_code`/definição versionada.

## Evidência externa relevante

- A definição europeia de PME usa headcount e turnover ou total de balanço, considera empresas ligadas e usa o último período contabilístico aprovado. Isto demonstra que thresholds dependem de finalidade, entidade e período; não devem tornar-se bandas universais F13 ([Comissão Europeia — SME definition](https://single-market-economy.ec.europa.eu/smes/sme-fundamentals/sme-definition_en), [Recomendação 2003/361/CE](https://eur-lex.europa.eu/legal-content/en/TXT/?uri=celex%3A32003H0361)).
- ISO 4217 fornece códigos reconhecidos para representar moedas e respetivas unidades menores. É adequado para identidade da moeda, não para selecionar taxa ou política de conversão ([ISO — ISO 4217 currency codes](https://www.iso.org/iso-4217-currency-codes.html)).
- O BCE publica taxas de referência do euro para fins informativos e desencoraja o seu uso transacional. Logo, mesmo uma fonte oficial não resolve automaticamente finalidade, data, arredondamento ou adequação de uma conversão F13/F14 ([ECB — Euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)).

## Opções viáveis

| Critério | A. Bandas livres | B. Valores financeiros detalhados | C. Factos mínimos versionados + bandas por política |
| --- | --- | --- | --- |
| Minimização | Boa em volume, fraca na semântica | Fraca; tende a replicar contabilidade | Boa; guarda apenas factos aprovados e snapshot necessário |
| Sensibilidade | Bandas reduzem exposição, mas caller pode defini-las | Muito elevada | Factos exatos restritos; consumo pode usar intervalo/banda |
| Auditabilidade | Baixa sem política/versionamento | Alta, com custo e superfície excessivos | Alta: métrica, período, moeda, estado, fonte e política fixados |
| Verificabilidade | Fraca | Forte se houver documentação completa | Suficiente por evidência referenciada e método fechado |
| Compatibilidade | Bandas locais não são comparáveis | Métricas contabilísticas variam | Métricas fechadas com applicability/status explícitos |
| Moedas/inflação | Geralmente ocultas | Exige motor financeiro | Preserva moeda/período; conversão fica fora por omissão |
| Reprodução histórica | Fraca se bandas mudarem | Possível | Forte com fact/policy versions e digest |
| Consumo determinístico | Só se banda/política forem fechadas | Possível, mas amplia F14 e dados | Direto através de factos/bandas publicados e versionados |
| Custo operacional | Baixo inicialmente | Muito alto | Moderado e delimitado |
| Risco de interpretação | Elevado | Elevado pela falsa precisão/contexto | Menor com metric definitions e estados separados |

## Recomendação

Recomenda-se a **Opção C: factos financeiros mínimos, temporais e versionados, com evidência governada e bandas derivadas/publicadas apenas por política explícita**.

Os nomes seguintes servem para testar o contrato; não são schema aprovado.

### 1. Âmbito

- Na v1, capacidade financeira institucional pertence apenas ao scope `ORGANIZATION`.
- `UNIT`/`TEAM` não podem substituir, relaxar ou duplicar factos organizacionais de turnover, balanço ou cofinanciamento.
- Orçamentos/alocações de unidade, se necessários no futuro, pertencem a um domínio próprio de alocação operacional e não entram como overlay de capacidade financeira F13 sem nova decisão.

### 2. Facto financeiro (`FinancialCapacityFact`)

Cada facto deve fixar:

- scope organizacional resolvido internamente;
- `metric_code` e `metric_definition_version` fechados;
- `period_start`, `period_end` e `fiscal_period_type` (`CALENDAR_YEAR`, `FISCAL_YEAR`, `ROLLING_PERIOD` ou outro valor aprovado);
- valor exato **ou** intervalo fechado, nunca ambos;
- moeda ISO 4217 e unidade/escala explícita;
- availability state e `verification_status` separados;
- provenance, evidence references, método/verificador quando verificado;
- `valid_until`/review policy quando aplicável;
- classe de confidencialidade;
- versão, lifecycle, supersession e digest.

### 3. Métricas mínimas candidatas

O seed final ainda exige aprovação editorial. As categorias que podem justificar métricas separadas são:

- volume/rendimento operacional anual observado;
- orçamento anual aprovado, quando este conceito se aplicar à instituição;
- limite autorizado de cofinanciamento para um período;
- montante de cofinanciamento já comprometido no mesmo período;
- disponibilidade de cofinanciamento publicada, apenas se derivada por política versionada dos factos compatíveis.

Turnover, total de balanço, orçamento e liquidez não são sinónimos. Métricas não aplicáveis a universidades, municípios, empresas ou outras entidades devem usar applicability explícita, não zeros artificiais.

### 4. Valor, intervalo e banda

- Um facto fonte pode usar valor decimal exato ou intervalo `[min,max]`, conforme a definição da métrica.
- Bandas nunca são texto livre. São produzidas por `band_policy_version` publicada, com limites, inclusividade, moeda/unidade esperadas e applicability definidos.
- A política de banda pode ser global ou específica de um contrato/programa futuro, mas não pode ser inventada pelo tenant/caller. Bandas tenant-local só seriam admissíveis por governance equivalente e não criariam comparabilidade global.
- Thresholds de PME ou de um aviso são policies externas/específicas; não se tornam bandas universais F13.

### 5. Moeda e conversão

- O facto preserva sempre montante/intervalo na moeda original.
- F13 v1 não converte moedas nem aplica inflação.
- Uma futura conversão exige snapshot próprio com moeda origem/destino, taxa, fonte, data, precisão, arredondamento e versão da regra. Não substitui o facto original.
- F14 não pode comparar montantes em moedas/períodos incompatíveis sem uma regra de conversão explicitamente aprovada e versionada.

### 6. Cofinanciamento e compromissos

- Limite autorizado, valor comprometido e valor disponível são factos/derivações diferentes.
- Compromissos usam referência governada e período; não são subtraídos silenciosamente de um limite com período/moeda incompatíveis.
- Disponibilidade residual, se publicada, fixa as versões dos inputs e da regra. Não é recalculada a partir do estado corrente durante F14.
- Capacidade declarada não constitui reserva de fundos nem garantia de disponibilidade futura.

### 7. Estados e verificação

- Availability states são mutuamente exclusivos:
  - `KNOWN`: existe valor/intervalo publicável;
  - `UNKNOWN`: informação insuficiente ou desatualizada;
  - `NONE`: declaração explícita de ausência/zero para a métrica e período;
  - `NOT_APPLICABLE`: a definição da métrica não se aplica à entidade;
  - `WITHHELD`: existe informação, mas não pode ser divulgada ao consumidor em causa.
- Ausência de linha não equivale a qualquer destes estados.
- `DECLARED`, `VERIFIED`, `DISPUTED`, `REVOKED` e `EXPIRED` pertencem à dimensão de verificação/lifecycle, não substituem availability.
- `NONE`, `NOT_APPLICABLE` e `WITHHELD` exigem autoridade, reason code fechado, período, provenance e aprovação; `WITHHELD` nunca revela magnitude por efeitos laterais.

### 8. Snapshot publicado (`PublishedFinancialCapacitySnapshot`)

O snapshot efetivo deve fixar:

- versões dos factos incluídos;
- estados de disponibilidade/verificação;
- versões das definições métricas e policies de banda;
- moeda, unidade e período de cada facto/banda;
- evidence/provenance references mínimas;
- `effective_at`, validade e digest;
- projeção autorizada para F14, que pode conter somente banda/estado e omitir o valor exato.

Atualizar ou verificar um facto cria nova versão/snapshot. Avaliações históricas continuam ligadas ao snapshot anterior.

### 9. Evidência e minimização

- Evidência pode ser declaração institucional aprovada, extrato/relatório certificado, decisão orçamental, documento F11 ou referência oficial externa allowlisted.
- F11 guarda o documento; F13 guarda referência, versão, digest, tipo, método e resultado de verificação necessários. Não replica demonstrações financeiras completas.
- A presença do documento não torna o facto `VERIFIED`; um verificador F5 distinto aplica método fechado e produz F7.
- Dados bancários, movimentos, IBAN, contas detalhadas, salários, transações e documentação contabilística completa ficam fora do modelo F13.

## Segurança e acesso

- Factos são tenant-local, protegidos por RLS/IDOR e operações F5 específicas para declarar, verificar, aprovar, publicar, consultar valor exato e consultar projeção/banda.
- Maker-checker aplica-se à verificação/publicação de factos usados pelo snapshot.
- Valores exatos e evidence references usam classe de confidencialidade superior ao perfil geral; listagens e exports aplicam field-level projection/redaction e são auditados.
- F7 conserva reason codes, versões e digests, não montantes sensíveis em payloads genéricos.
- Retenção e legal hold aplicam-se por classe de dado/evidência; correção cria supersession e nunca sobrescreve o facto publicado.
- Dados pessoais não são esperados no facto. Autoria/verificação usam referências opacas e políticas próprias.

## Respostas às questões obrigatórias

- **Âmbito?** Organização na v1; alocação de unidade é outro domínio e não overlay financeiro.
- **Período?** Datas inclusivas exatas e tipo de período versionado.
- **Ano civil vs exercício?** Distintos; `fiscal_period_type` e datas preservam ambos.
- **Moeda?** Original, ISO 4217. Conversão fora da F13 v1.
- **Métricas universais?** Apenas códigos/definições fechados aprovados; seed ainda pendente. Turnover, orçamento, cofinanciamento e compromissos são distintos.
- **Valor, intervalo ou banda?** Facto exato ou intervalo; banda derivada por policy publicada.
- **Bandas?** Não escolhidas livremente; policy global/contratual versionada. Tenant-local só por governance futura explícita.
- **Compromissos?** Factos separados, ligados a período/moeda e referências governadas.
- **Declarado vs verificado?** Sempre distintos.
- **Evidência?** Referência mínima governada e método fechado; sem cópia contabilística integral.
- **UNKNOWN/NONE/N/A/WITHHELD?** Estados explícitos, mutuamente distintos e nunca inferidos de ausência.
- **Validade?** Por policy/métrica; expiração bloqueia uso futuro sem apagar histórico.
- **Histórico?** Snapshot fixa facto, período, moeda, unidade, policy e digest.
- **Acesso adicional?** Sim, valores exatos/evidências exigem permissions e projeções próprias.
- **Overlays?** Não na v1 para capacidade financeira institucional.
- **Dupla contagem?** Scope organizacional único; compromissos e limites separados; nenhuma soma implícita unidade→organização.
- **F14?** Interpretação de threshold, elegibilidade, conversão, inflação, comparação e scoring.

## Riscos e decisões humanas restantes

1. Aprovar ou rejeitar a Opção C e o scope exclusivamente organizacional na v1.
2. Aprovar o seed de `metric_code` e definições aplicáveis a diferentes tipos de instituição.
3. Decidir quais métricas admitem valor exato, intervalo ou ambos por contrato.
4. Definir policies iniciais de bandas e se alguma projeção F14 pode receber valor exato.
5. Aprovar availability states, verification states e lifecycle final.
6. Definir períodos, validade e frequência de revisão por métrica.
7. Definir métodos fechados de verificação e evidence types.
8. Definir classes de confidencialidade, permissions F5, exports e redaction.
9. Definir retenção/legal hold das facts e evidências financeiras.
10. Decidir se e quando conversão cambial será necessária; fonte, finalidade e regras exigirão decisão própria.
11. Definir como métricas de entidade ligada/grupo empresarial seriam representadas sem assumir a definição PME como universal.
12. Delimitar na F14 as regras de thresholds, comparabilidade, elegibilidade e tratamento de `WITHHELD`/`UNKNOWN`.

## Implicações para F13 e F14

Se aprovada, F13 deve preservar factos mínimos por métrica/período/moeda, estados separados, evidência governada, confidencialidade e snapshots derivados imutáveis. Não deverá ingerir contabilidade detalhada nem calcular capacidade por heurística.

F14 deverá operar apenas sobre a projeção autorizada do snapshot e declarar explicitamente policies de banda, conversão, período, threshold e tratamento de estados. A F13 não responde se uma organização é elegível nem atribui força relativa a um facto.

## Limites da investigação

- `FinancialCapacityFact` e `PublishedFinancialCapacitySnapshot` são modelos candidatos, não entidades aprovadas.
- Nenhum seed de métricas, threshold, banda ou fonte cambial foi aprovado.
- Não foram definidos schema SQL, endpoints, UI, migrations, jobs, relatórios ou integrações contabilísticas.
- A recomendação não é arquitetura aprovada e não autoriza implementação.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/features/opportunity-catalog.md`
- `context/features/matching-and-qualification.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-competencies-and-experience.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`
- `context/references/logical-data-dictionary.md`
- `backend/src/opportunities/contracts.js`
- `backend/src/opportunities/normalization.js`
- `backend/database/central/migrations/002_f3_organization_memberships.up.sql`
