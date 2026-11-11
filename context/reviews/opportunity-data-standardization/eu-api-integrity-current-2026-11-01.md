# Integridade atual da fonte EU após a aceitação dos 391

Verificação read-only de 01/11/2026. Não foi retomada a recolha nem alterado o catálogo.

## Inventário e paridade

| Estado atual | Identidades | Prova |
|---|---:|---|
| v2 aceites do lote legado | 391 | `eu-legacy-acceptance-postcheck.cjs`: 391 planos OIDC, revisões e recibos, 401 dotações e 422 prazos derivados iguais aos snapshots; zero pendentes |
| v1 com candidato oficial arquivado e decisão `REVIEW` | 137 | `output/eu-pending-audit-4a543e54-ddc1-46e0-9c04-d6da0680b051/review-inventory.json`: 137 arquivos íntegros e CAS atual; requerem aceitação separada |
| v1 sem candidato utilizável | 7 | Preview do lote 391 e observação oficial nova abaixo; cinco `CONFLICT` e dois `PENDING` no ciclo antigo, todos os sete continuam em `CONFLICT` na consulta atual |
| v2 auxiliar 11145 | 1 | `output/eu-11145-parity-249c41c4-c8f1-4a52-9c11-a7c5ba88598e.json`: sem diferença semântica face à API atual |
| Total de identidades EU no inventário abrangente | 536 | 392 v2 e 144 v1. Os conjuntos de 391 e 137 não se sobrepõem; os outros sete são precisamente os excluídos. |

A 11145 conserva `120000` como valor numérico SQL `120000.00000000`, sete cut-offs e `Gnomon Informatics SA` como concedente direto no snapshot v2. A moeda ligada à dotação não é publicada no campo de orçamento da API verificado e permanece `NOT_FOUND`; não se fabrica EUR. A coluna auxiliar histórica `funding_identity.last_source_fields.funderName` ainda contém `European Commission` nas 536 identidades. Nos 392 registos v2, a leitura canónica deve continuar a usar a revisão v2 e não esse campo auxiliar; as 144 cabeças v1 continuam sujeitas a revisão ou conflito.

## Sete conflitos em consulta oficial nova

`output/eu-conflict-observation-d3f18c7d-784c-4ed5-a2d2-9a80e182b6d7.json` registou sete lookups oficiais da API, com zero acesso à BD habitual: `CASCADE:17045` continua `CANONICAL_TITLE_CONFLICT`; os quatro `CEF-T-2021-AFIF*`, `ERASMUS-EDU-2022-ECHE-CERT-FP` e `ESC-HUMAID-2021-QUAL-LABEL-FP` continuam `SOURCE_VARIANTS_DIVERGE`. Nenhum desses resultados autoriza escolher silenciosamente uma variante. A [página oficial Erasmus+ da ECHE](https://erasmus-plus.ec.europa.eu/calls/erasmus-charter-for-higher-education-1) confirma a referência e o calendário publicado, mas não resolve por si a divergência entre variantes de evidência recolhidas pelo conector. Para ESC, os resultados de pesquisa por referência não substituem a página/documento da chamada.

## Conclusão desta melhoria

O parser e a persistência v2 da 11145 mantêm paridade atual; os 391 aceites mantêm integridade SQL; os sete conflitos são conservados e causalmente explícitos. O inventário elimina a ambiguidade entre os cinco conflitos do ciclo antigo e os sete do lote legado. **Não declarar o catálogo EU inteiro saneado nem reativar o escritor:** faltam decisões autenticadas para os 137 `REVIEW`, resolução oficial dos sete e janela separada de retoma. A fonte permanece `QUIESCED`, fence 7.
