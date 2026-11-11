# Correção do financiador EU e diagnóstico causal dos conflitos

31/10/2026. Incremento posterior à [auditoria das pendências](eu-pending-audit.md). Âmbito: parser EU, persistência dos motivos de conflito e regressões. A fonte EU habitual permaneceu `QUIESCED` com fence 7. Não houve aceitação de candidatos, nova identidade, migração, job habitual ou alteração das cinco linhas históricas.

## Correção

- `source.normalizeRecord()` deixou de atribuir `European Commission` a `funderName` por ser um registo do portal. Sem prova do concedente direto, o campo fica ausente no resultado do parser. O adaptador v2 continua a preencher `parties[]` apenas com papel e evidência explícitos. Nenhum snapshot v1 já aceite foi reescrito.
- O contrato persistido v1 exige `funderName`; por isso, um registo EU sem financiador comprovado não deve ser promovido por um escritor v1. Na configuração EU v2, o repositório exige o escritor canónico e rejeita um run EU em modo v1. O exemplo de leitura v1 nos testes mantém um rótulo histórico explícito na fixture; esse rótulo não é produzido pelo parser.
- O lookup devolve códigos fechados para truncagem, variantes divergentes, estado desconhecido, títulos `content`/`callTitle` contraditórios, outros conflitos do adaptador v2 e alteração de resolução protegida. O caso `CASCADE:17045` motivou o código específico `CANONICAL_TITLE_CONFLICT`.
- `KNOWN` grava `conflictReasons` no `funding_batch.next_cursor` com a identidade, run e fase exigidos pelo checkpoint, na mesma transação que muda o alvo para `CONFLICT`. `DISCOVERY_DETAIL` inclui os motivos no checkpoint já existente. O limite físico JSONB de 2048 bytes continua ativo. Um produtor antigo sem diagnóstico grava `UNCLASSIFIED_SOURCE_CONFLICT`; entrada arbitrária, duplicada ou incompatível com `FOUND` é recusada. A resolução protegida que coincide com a evidência remove o motivo antes de devolver `FOUND`.

## Leitura oficial atual dos cinco IDs

Observação **read-only** da API pública em 31/10/2026: [recibo limitado](../../../output/eu-conflict-observation-e078170d-a209-4ce7-921a-7d80ba1be5ea.json). A comparação usa o [inventário histórico read-only](../../../output/eu-pending-audit-9dad5e30-9434-45de-bf70-61ca08cd875b/review-inventory.json). Estes resultados descrevem o estado atual da fonte e não reconstituem a causa dos runs históricos sem arquivo.

| ID | Motivo observado agora | Evidência relevante | Tratamento antes de aceitação |
| --- | --- | --- | --- |
| `CASCADE:17045` | `CANONICAL_TITLE_CONFLICT` | Um resultado; `content` difere de `metadata.callTitle`; sem resolução anterior. | Conferir no portal qual título representa a chamada e corrigir a regra ou abrir revisão editorial com ambas as evidências. |
| `CEF-T-2021-AFIFCOEN-WORKS-LNG` | `SOURCE_VARIANTS_DIVERGE` | Duas variantes; fingerprint atual igual ao da resolução protegida. | Preservar a resolução; rever as variantes antes de qualquer migração v2. |
| `CEF-T-2021-AFIFCOEN-WORKS-ZE` | `SOURCE_VARIANTS_DIVERGE` | Duas variantes; fingerprint atual igual ao da resolução protegida. | Idem, com decisão própria deste ID. |
| `CEF-T-2021-AFIFGEN-UNITS` | `SOURCE_VARIANTS_DIVERGE` | Duas variantes; fingerprint atual igual ao da resolução protegida. | Idem, com decisão própria deste ID. |
| `CEF-T-2021-AFIFGEN-WORKS-LNG` | `SOURCE_VARIANTS_DIVERGE` | Duas variantes; fingerprint atual igual ao da resolução protegida. | Idem, com decisão própria deste ID. |

Os fingerprints AFIF coincidiram nos quatro casos, mas as divergências entre variantes continuam reais. Os cinco alvos permanecem `CONFLICT` na base habitual; não foi feita escrita retroativa de motivos nos checkpoints antigos. A observação limitada é evidência separada para preparar uma futura revisão, sem fingir que o run antigo capturou estes motivos.

## Verificação

- Regressões RED→GREEN do conflito de título: duas falhas esperadas antes da alteração; depois, 56 testes focados PASS. Incluem financiador ausente, cinco tipos de causa, causas combinadas, fase/identidade divergente, replay, resolução protegida e compatibilidade de leitura v1.
- Backend completo após as alterações: **2337 PASS, 0 FAIL, 7 SKIP** em 2344 testes. Um ensaio anterior teve uma falha na fixture v1 que construía um snapshot inválido sem o campo obrigatório; a fixture foi corrigida e a suite repetida integralmente. [Log final](../../../output/eu-conflict-backend-tests-final2.log).
- Frontend: **496 PASS, 0 FAIL**; build PASS. [Testes](../../../output/eu-conflict-frontend-tests.log) e [build](../../../output/eu-conflict-frontend-build.log).
- Ensaio PostgreSQL 18 descartável: **15 checks PASS**, transação/limite JSONB/replay/fase verificados, contentor próprio removido. [Recibo](../../../output/eu-conflict-diagnostics-gate-279c89f1-310f-4c92-bbf1-03cec7868c44/verification.json).
- `node --check`: 15 ficheiros alterados PASS. As primeiras tentativas de suite/build em sandbox falharam por `spawn EPERM`; a execução repetida com capacidade de subprocessos passou.

## Limite operacional e próximo passo

O código já conserva o motivo de **novos** conflitos em checkpoints duráveis. Os cinco motivos observados agora estão no recibo local e não foram inseridos no histórico da base, pois isso atribuiria ao run antigo uma evidência que ele não arquivou. EU continua suspensa. Antes de decisões de aceitação, comparar o título de 17045 com a página oficial e preparar cinco propostas editoriais individualizadas; os 137 candidatos `REVIEW` e os restantes alvos mantêm a ordem da auditoria anterior.
