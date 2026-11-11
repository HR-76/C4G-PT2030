# EU Funding & Tenders — API e apresentação das oportunidades

Análise de 01/11/2026, pedida pelo utilizador. Comparação da documentação pública atual com o código do workspace; sem recolha, atualização do catálogo, SQL, infraestrutura ou ativação de worker. A implementação existente contém alterações anteriores que foram preservadas.

## Conclusão

O transporte implementado está alinhado com o contrato público consultado. Não há evidência de incumprimento técnico da API nesta revisão. Isso não certifica quotas desconhecidas, operação produtiva, completude do catálogo ou direitos sobre cada conteúdo de terceiros. Os problemas visíveis são sobretudo de seleção/apresentação de informação e de um mapeamento de descrição demasiado limitado.

## Referência oficial verificada

A [documentação oficial da API](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis) apresenta SEARCH por HTTPS POST, filtros JSON em Form Data, FACET para interpretar códigos, e recomenda `language` devido a resultados multilingues. Distingue chamadas, detalhes de tópicos e projetos/resultados. Os exemplos incluem tipos `0`, `1`, `2` e `8`; permitem subconjuntos. Não foi encontrada quota numérica, frequência obrigatória, SLA ou garantia de snapshot de paginação nessa página nem nas pesquisas oficiais dirigidas a esses limites. Ausência de quota publicada não significa acesso ilimitado.

A abertura direta da página devolveu apenas a estrutura da SPA; o conteúdo indexado integral da mesma URL oficial foi recuperado pela pesquisa web. Não se usaram descrições de terceiros como norma.

O [aviso legal da Comissão](https://commission.europa.eu/legal-notice_en) permite reutilização do conteúdo UE, salvo indicação contrária, com crédito e indicação das alterações; ressalva direitos de terceiros e exclui certos ativos da licença geral. Recomenda-se ligar esse aviso e identificar a adaptação C4G. Não aplicar automaticamente uma licença UE a todas as chamadas em cascata publicadas no portal.

## Comparação com o código

| Área | Evidência do workspace | Avaliação |
| --- | --- | --- |
| Transporte e filtros | `backend/src/fundingTenders/source.js:9,72,135`: endpoint oficial, POST, FormData com partes JSON, `language=en`, idiomas `en` | Alinhado com a documentação. O parâmetro de aplicação é público; não é credencial de cliente. |
| Âmbito da descoberta | `source.js:75`: tipos 1/8, abertos/previstos, período 2021–2027; `programmes.js:3` | Subconjunto deliberado. Não apresentar como cobertura de todos os concursos públicos, todos os períodos ou todas as vias Erasmus+. CORDIS/Erasmus são seleções da mesma API, não fontes adicionais independentes. |
| Detalhe | `source.js:80,195`; `discoveryDetails.js:35` | Lookup por identidade exata, sem projeção limitada de campos, validação de variantes antes de aplicar. Não confundir o registo de pesquisa com prova de descrição completa. |
| Paginação | `source.js:116,123,175`; `coverage.js:24` | Tamanho constante, cursor vinculado a fonte/consulta/data; continuação durável. Totais variáveis/duplicados geram cobertura parcial. Não há garantia de snapshot remoto; continuar a observar inconsistências. |
| Frequência e falhas | `source.js:13,137`; `worker.js:95`; `repository.js:89` | Máximo 25 registos/página, quatro páginas/collect, 15 s/pedido, 120 s/lote, corpo 2 MiB; dois retries, backoff e `Retry-After` em 429/5xx. Worker serial e bloqueio de execução concorrente. Poll de fila a cada segundo não equivale a um novo varrimento por segundo. Não existe limitador global explícito de pedidos por minuto; quota oficial continua por confirmar. |
| Programas | `programmeTaxonomy.js:3`; `programmeTaxonomy.json:2` | Taxonomia com evidência FACET de 29/10/2026, versão e fallback não interpretado para códigos desconhecidos; não inventa nomes. Precisa de manutenção quando a fonte mudar. |
| Identidade e projetos | `identity.js:4`; `sourceEvidence.js:78`; `adapterV2.js:87,134` | Chamadas tipo 8 identificadas por `callccm2Id`; projeto associado separado. Evita colapsar várias calls do mesmo projeto/topic. |
| Proveniência | `adapterV2.js:66,92`; `sourceEvidence.js:72` | Guarda observação, evidência, transformação e identidade; alterações e divergências são rastreáveis. Estes metadados são úteis para auditoria, mas não precisam de ocupar a primeira análise do utilizador. |
| Crédito na interface | `frontend/src/pages/Opportunities/OpportunityPresentation.jsx` e `OpportunityReadModelView.jsx` | Antes existiam nome e ligação da fonte. A alteração de primeira análise acrescentou atribuição EU, indicação de dados resumidos/formatados pela C4G e ligação ao aviso oficial de reutilização. Não se atribuiu automaticamente licença UE a conteúdo de terceiros. |

## Informação útil e lacunas concretas

- **Datas:** preservar abertura e prazos efetivos, incluindo a distinção entre próximo cut-off e fecho final. A fonte 11145 tem vários cut-offs; `closingDate` do índice não é o prazo de candidatura. O adaptador usa `deadlineDate` e conserva precisão/fuso (`adapterV2.js:119`).
- **Nome/código e programa financiador:** título e referência identificam a oportunidade; Digital Europe/Horizon/etc. identificam o programa. SUSA é projeto associado, não programa financiador. O portal é fonte, não automaticamente a entidade que paga o apoio.
- **Dotação:** `adapterV2.js:153` distingue total da call e montante do tópico ou grupo; apoio por projeto/mês é separado. No exemplo 11145 a evidência contém orçamento `120000`, sem moeda declarada nesse campo. Não inferir EUR de um apoio mensal noutro trecho nem transformar esse orçamento em dotação global do Digital Europe. O rótulo da interface deve refletir o âmbito publicado.
- **Descrição:** `adapterV2.js:104` lê apenas `raw.summary`. Na [evidência local 11145](../references/opportunity-v2/evidence/eu-11145.json), esse campo repete o título, enquanto `metadata.description` contém a narrativa. O adaptador usa a narrativa para apoio/entidade (`adapterV2.js:166`), mas não a projeta como descrição. É uma lacuna real do mapeamento, não ausência de conteúdo na API. Corrigir exige contrato/versão do mapeamento e avaliação das revisões já aceites; uma mudança apenas de UI não recupera texto que não foi projetado. A auditoria não alterou o backend nem os dados persistidos.
- **Campos vazios:** classificação, condições, documentos e parte da informação financeira nascem como `NOT_COLLECTED` (`adapterV2.js:15,50`). Esse estado não prova que a fonte nada publica. Omitir esses blocos na primeira análise; manter a evidência interna e o acesso direto à call.

## Verificação e limites

54 testes focados PASS, sem skips, executados em 01/11/2026: `fundingTendersSource`, `fundingContinuation`, `fundingCascadeIdentity`, `fundingAdapterV2`, `fundingDiscoveryDetail` e `fundingCoverage`.

Comando: `node --test --test-isolation=none test/fundingTendersSource.test.js test/fundingContinuation.test.js test/fundingCascadeIdentity.test.js test/fundingAdapterV2.test.js test/fundingDiscoveryDetail.test.js test/fundingCoverage.test.js`, em `backend/`. A tentativa inicial com isolamento por processos não executou os testes devido a `spawn EPERM`; a variante sem subprocessos passou. Estes testes verificam fixtures e contratos, não quotas ou disponibilidade remota.

O [diagnóstico de 28/10](opportunity-sources-calibration-2026-10-28.md) mantém valor histórico, mas as conclusões antigas sobre ausência de cursor e calendário não representam o código atual. Esta auditoria não verificou heartbeat, base de dados ou estado atual do worker.

A [apresentação simplificada](../features/opportunity-first-analysis.md) está concluída e validada: frontend 554 PASS, backend 2403 PASS/7 SKIP, build e verificação visual desktop/mobile PASS. Campos técnicos saíram da primeira análise; dados persistidos e exportação foram preservados. Descrições iguais ao título não são repetidas como informação adicional.

Next step: tratar a descrição canónica EU num incremento versionado, preservando evidência e revisões existentes.
