# Revisão dos seis avisos sinalizados em P2

Estado: pesquisa concluída em 28/10/2026. As propostas foram posteriormente implementadas e ativadas localmente em 29/10, na [correção complementar P2](../features/opportunity-source-resolution.md). As descrições abaixo preservam a evidência e o estado observado durante a pesquisa. P3 não iniciado.

## Decisão e contexto

Determinar, por aviso e por campo, quais os dados sustentados por fontes oficiais. Mantém-se a decisão confirmada pelo utilizador: preservar dados perante versões contraditórias e resolver com evidência, conservando revisões e snapshots das candidaturas. Esta revisão não autoriza uma regra global de precedência entre resultados da API.

O [P2](../features/opportunity-temporal-calibration.md) terminou a verificação dos 531 conhecidos: 525 atualizados e seis conflitos, cada um com duas versões. Os seis conservaram a revisão anterior e `source_review=CONFLICT`. O catálogo ficou com 533 identidades e 1074 revisões. A pesquisa atual consultou apenas fontes públicas e artefactos locais; não escreveu na base nem alterou o runtime.

## O que a API efetivamente devolve

Seis consultas exatas, limitadas a 25 resultados/2 MiB/15 segundos cada, sem `displayFields`, devolveram **12 representações para seis identificadores**, às 23:47:30–23:47:33Z. Mesmo `type=1`, idioma `en`, identificador e `ccm2Id` em cada par. Há diferenças em `DATASOURCE`, `callccm2Id`, calendário, conteúdo e, em dois casos, URL.

| Avisos | `SEDIA_PRD_CENTRICITY` | `SEDIA` |
| --- | --- | --- |
| Quatro CEF | Ingestão 03/02/2023; OPEN; última ronda 07/11/2023, horas 17:00Z | Ingestão 30/06/2025; CLOSED; mesmas datas civis, horas 00:00Z |
| ECHE | Ingestão 18/11/2022; OPEN; inclui 27/01/2026 e 26/01/2027 | Ingestão 06/10/2026; OPEN; termina em 24/03/2026 |
| ESC humanitário | Ingestão 08/03/2023; OPEN; calendário até 24/09/2024 | Ingestão 22/09/2026; CLOSED; calendário até 22/09/2026; submissão explicitamente indisponível |

**Facto:** coexistem representações de duas origens para cada identidade. **Inferência sustentada nestes seis casos:** a representação CENTRICITY conserva informação antiga. A ingestão mais recente não é prova de atualização editorial, nem foi encontrado contrato público que permita escolher sempre `SEDIA`, o último resultado ou CLOSED. A [documentação oficial da API](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis) descreve pesquisa, detalhes e idiomas, mas não esta precedência. A duplicação observada também não se explica apenas por idiomas: ambos são `en`.

Evidência reproduzível: [probe.cjs](../../output/funding-conflict-review-20261028/probe.cjs), [observações](../../output/funding-conflict-review-20261028/observations.json), [comparação e hashes SHA-256 das respostas](../../output/funding-conflict-review-20261028/comparison.json). Cada resposta completa está no mesmo diretório, com o identificador como nome. `comparison.json` aplica o normalizador existente às respostas completas; não representa uma nova recolha pelo worker.

## Resultado por aviso

As horas abaixo são de **Bruxelas**, com o offset aplicável à respetiva data. São propostas documentais, não alterações já persistidas.

| Identificador | Prazo preservado na APP | Conclusão e proposta |
| --- | --- | --- |
| `CEF-T-2021-AFIFCOEN-WORKS-LNG` | 19/01/2022 | Encerrado; última ronda **07/11/2023, 17:00 CET**. LNG marítimo/fluvial, dotação Coesão. [Ficha COEN, pp. 5, 10–11 e 14](https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/cef/wp-call/2021/call-fiche_cef-t-2021-afifcoen_en.pdf) |
| `CEF-T-2021-AFIFCOEN-WORKS-ZE` | 19/01/2022 | Encerrado; **07/11/2023, 17:00 CET**. Infraestruturas de emissões zero, dotação Coesão. [Ficha COEN, pp. 5, 8–10 e 14](https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/cef/wp-call/2021/call-fiche_cef-t-2021-afifcoen_en.pdf) |
| `CEF-T-2021-AFIFGEN-UNITS` | 19/01/2022 | Encerrado; **07/11/2023, 17:00 CET**. Contribuições unitárias para carregamento elétrico e ligação à rede, dotação Geral. [Ficha GEN, pp. 5, 7–8 e 14](https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/cef/wp-call/2021/call-fiche_cef-t-2021-afifgen_en.pdf) |
| `CEF-T-2021-AFIFGEN-WORKS-LNG` | 19/01/2022 | Encerrado; **07/11/2023, 17:00 CET**. LNG marítimo/fluvial, dotação Geral. [Ficha GEN, pp. 5, 10–11 e 14](https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/cef/wp-call/2021/call-fiche_cef-t-2021-afifgen_en.pdf) |
| `ERASMUS-EDU-2022-ECHE-CERT-FP` | 26/01/2027 | Calendário vigente termina em **24/03/2026, 17:00 CET**; temporalmente encerrado. Preservar estado publicado OPEN e explicitar a divergência administrativa. [Ficha ECHE V4, pp. 2 e 5](https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/erasmus/wp-call/2022/call-fiche_erasmus-edu-2022-eche-cert_en.pdf) |
| `ESC-HUMAID-2021-QUAL-LABEL-FP` | 22/09/2021 | Sessão atual encerrada; último corte **22/09/2026, 17:00 Europe/Brussels**, para projetos da call 2027. Não significa extinção da certificação. [Guia ESC 2026, pp. 68 e 73](https://youth.europa.eu/sites/default/files/inline-files/european_solidarity_corps_guide_2026_EN.pdf) e [payload oficial recolhido](../../output/funding-conflict-review-20261028/ESC-HUMAID-2021-QUAL-LABEL-FP.json) |

### CEF: primeira ronda confundida com prazo final

As fichas GEN e COEN V3, de 19/07/2023, conservam cinco cortes: 19/01/2022, 07/06/2022, 10/11/2022, 13/04/2023 e 07/11/2023. O histórico V2 regista adiamento do quinto corte; V3 restringe a última ronda a propostas apoiadas por um Implementing Partner. A [CINEA confirmou em 08/11/2023](https://cinea.ec.europa.eu/news-events/news/cef-transport-almost-eu450-million-requested-deployment-alternative-fuel-supply-infrastructure-2023-11-08_en) que 07/11 foi efetivamente a quinta e última ronda. Confiança alta para CLOSED; não há evidência de cancelamento dos quatro temas.

### ECHE: prazo de 2027 expressamente retirado

A ficha V4 regista que V3, de 04/07/2025, eliminou o corte de 26/01/2027; V4, de 11/11/2025, adiou 27/01/2026 para 24/03/2026. A [página oficial Erasmus+](https://erasmus-plus.ec.europa.eu/funding-opportunities/erasmus-charter-for-higher-education-1) confirma esta última data/hora. É uma certificação ECHE para ensino superior, sem atribuição direta de financiamento; a ficha conserva uma formulação genérica de abertura durante 2021–2027, que não restitui o corte eliminado.

O [payload atual](../../output/funding-conflict-review-20261028/ERASMUS-EDU-2022-ECHE-CERT-FP.json) mantém OPEN tanto em `status` como em `actions`, embora já não contenha qualquer prazo futuro. Recomenda-se corrigir o calendário e manter **estado temporal CLOSED / estado publicado OPEN**, com motivo visível. O motor P2 já distingue estes conceitos; não fabricar um CLOSED administrativo. O prazo retirado permanece no histórico, não no calendário vigente. A revisão não prova a possibilidade de submeter hoje nem inventa uma nova ronda.

### ESC: sessão encerrada e certificação contínua são compatíveis

O Guia ESC 2026 prevê apresentação contínua durante o período de programação, com avaliações periódicas; o corte de 22/09/2026 servia os projetos da call 2027. O payload SEDIA acrescenta confirmação operacional explícita: `sepTemplate` contém **“No submission system is open for this topic.”**, com `actions.status=Closed`. Isto sustenta CLOSED para a sessão atual, sem afirmar cancelamento ou encerramento definitivo do regime de certificação.

Os 11 avisos `latestInfos` chegam apenas a aprovação em 03/10/2023, alteração em 14/08/2024; descrevem fecho em 2023 seguido de nova sessão em 2024. Não há anúncio editorial de fecho em 2026 nesse campo. A página dinâmica não expôs o estado ao leitor web; a prova operacional vem do payload público oficial. Natureza: selo de qualidade prévio ao financiamento, não uma subvenção direta. [Guia ESC 2026](https://youth.europa.eu/sites/default/files/inline-files/european_solidarity_corps_guide_2026_EN.pdf).

## Precisão temporal: correção necessária antes de P3

Nos seis payloads SEDIA, `actions.deadlineDates` contém datas civis; `metadata.deadlineDate` representa os mesmos dias a 00:00Z. CENTRICITY representa-os às 17:00Z. **Nenhuma destas horas coincide com os três prazos finais documentados:**

| Prazo documentado | Instante calculado com o fuso da data |
| --- | --- |
| CEF, 07/11/2023 às 17:00 CET | `2023-11-07T17:00:00+01:00` = 16:00Z |
| ECHE, 24/03/2026 às 17:00 CET | `2026-03-24T17:00:00+01:00` = 16:00Z |
| ESC, 22/09/2026 às 17:00 Bruxelas | `2026-09-22T17:00:00+02:00` = 15:00Z |

O [adaptador atual](../../backend/src/fundingTenders/source.js) copia `metadata.deadlineDate` para `sourceTemporal`; o [motor temporal](../../backend/src/opportunities/temporal.js) trata valores com offset como instantes exatos. A validação sintática P2 não prova que o índice publicou uma hora real. É necessário distinguir data civil de hora comprovada. Não remover horas de todos os resultados nem aplicar um offset fixo: Bruxelas muda de horário e as outras fontes podem fornecer instantes legítimos. O alcance desta discrepância fora dos seis casos não foi medido nesta revisão.

## Recomendação e implicações

Recomenda-se resolução auditável específica destes seis avisos, apoiada nos documentos e payloads identificados, antes do enriquecimento. Selecionar automaticamente uma origem para todo o catálogo exige prova adicional de cobertura e de precedência; não é a recomendação desta revisão.

A resolução deve conservar ambos os payloads, a revisão anterior, o autor/motivo/fontes e os campos efetivamente revistos. Deve vincular-se à evidência observada para não reaparecer inalterada em cada recolha, e reabrir revisão quando surgirem mudanças relevantes. Alterar apenas `closingDate` não basta: a sinalização atual força UNKNOWN e uma nova recolha ambígua voltaria a assinalar o caso. Limpar `source_review` por SQL isolado também não implementa uma resolução durável.

O contrato posterior precisa de cobrir regressões com estes pares, conservação de histórico, ECHE com OPEN publicado/CLOSED temporal, sessão ESC versus validade do selo e precisão data/hora. Os dois processos de certificação devem ser identificáveis como tal no enriquecimento, sem exclusão automática nem contabilização como montantes financiados. São implicações propostas, não novas decisões de produto já aprovadas.

Validação desta pesquisa: seis respostas completas conservadas e comparadas com o normalizador existente; confronto com fichas oficiais, guia e confirmação CINEA. Não houve alterações ao código da aplicação, migrações, escritas Dev, novas recolhas pelo worker ou execução das suites — estas últimas não validariam uma pesquisa documental. As seis sinalizações continuam intactas na APP.

Próximo passo: usar estas conclusões e a correção P2 validada no enriquecimento P3.
