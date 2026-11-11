# Executor limitado à11145 — validação isolada

Estado: **Review**, 31/10/2026. O percurso recolha pública → arquivo canónico → plano factual → aprovação autenticada → aceitação foi integrado e ensaiado exclusivamente para `EU_FUNDING_TENDERS / CASCADE:11145`. A entrega não acedeu às bases habituais, não alterou a sua configuração e não executou a janela de instalação/aceitação habitual. A prova usa sessões administrativas de teste persistidas pelo coordenador normal; não representa aprovação por uma pessoa real.

[Contrato](../../references/opportunity-v2/executor-11145-contract.md), [descritor e hashes](../../references/opportunity-v2/executor-11145.json), [operação/recuperação](../../references/opportunity-v2/executor-11145-runbook.md) e [resumo verificável](../../../output/opportunity-v2-executor-11145/validation-summary.json).

## Implementação

O novo `source11145.js` fixa endpoint/query/identidade, uma página, até cinco variantes, dois MiB, zero retries e limite global de 30 s. Usa `createSource` e o adaptador v2 existentes, com enriquecimento ligado. Exige resposta completa e rederivável; não substitui valores da fonte pelos exemplos normativos. O cliente comum oferece `collect11145`, `prepare11145` e `accept11145`; as três rotas têm DTOs fechados, sessão administrativa, origem/CSRF e preflight normal.

O coletor verifica autoridade, identidade existente e fence antes da rede; fecha essa transação e repete as verificações antes de gravar. Run, arquivo, verificação, conclusão `SUCCESS` e auditoria são atómicos. Não chama o writer v1, não cria nova identidade e não deixa um run pendente sem outbox. O binding de replay inclui propósito, ator, pedido, UUID conhecido e fence; um replay confirmado não repete a consulta pública.

A preparação deriva arquivo e CAS no servidor, pelo mesmo ator da recolha. A aceitação exige o digest aprovado, mesmo ator da aprovação, TTL de uma hora desde a preparação, quiescência EU e fences atuais. A restrição11145 e a aprovação são verificadas também no writer final e na recuperação de recibos. CAS corrente protege uma nova escrita; replay valida o recibo vinculado à intenção original, sem exigir que o head continue a ser o anterior à aceitação. Não duplica revisão nem auditoria.

As flags `OPPORTUNITY_ACTIVATION_RUNTIME` e `OPPORTUNITY_11145_EXECUTOR` continuam `disabled` por omissão. A combinação explícita é `authenticated-v2`/`bounded-v2`. Não foi criada uma interface administrativa nem exposto um endpoint genérico de aceitação. O coletor genérico EU permanece fora deste executor.

## Fonte real e persistência

A API oficial foi consultada em 31/10/2026 às01:46:01.052Z. Resposta HTTP 200, 20580 bytes, SHA-256 `8ccc4d934e74af49d5fc5cee416fedac1d81be0e36d803582df34378d234cd75`. [Resposta pública preservada](../../../output/opportunity-v2-executor-b361612540164c0d99a01443ca5e43d9/eu-11145-response-01.json). O contentDigest `355df5dc59a25556d9103fa276921d7e43d66a1087630481b0c4867460a96ce6` coincide com o normativo 11145.

| Facto | Arquivo real / revisão aceite isolada | Resultado |
| --- | --- | --- |
| Total funding available | Decimal canónico `"120000"`; PostgreSQL `numeric`, valor `120000.00000000` | ✅ |
| Moeda da dotação | `NOT_FOUND`; SQL `currency_code = NULL` | ✅ Sem inferir EUR a partir de outros montantes |
| Projeto | SUSA; acordo `101190010` | ✅ |
| Prazos publicados | Sete cut-offs; payloads iguais ao arquivo e projeções SQL de datas/instantes iguais ao contrato ISO | ✅ |
| Fonte/identidade | EU Funding & Tenders; `CASCADE:11145`; URL oficial preservada | ✅ |
| Snapshot completo | Reextraído da evidência pública pelo adaptador e igual ao snapshot SQL aceite | ✅ |

O contrato usa decimal canónico em texto para transportar o montante sem perda de precisão e `numeric` na persistência. A apresentação monetária não pode acrescentar uma moeda que a evidência não declara. A prova de 120000 na revisão aceite é **isolada**; não certifica que o catálogo habitual já foi migrado.

## Provas executadas

[Gate do executor](../../../output/opportunity-v2-executor-b361612540164c0d99a01443ca5e43d9/verification.json): **17 PASS**, PostgreSQL 18.6, 42,232 s, 710 hashes estáveis e contentor próprio removido. Bootstrap 035/033, instalação explícita042/034 por migradores normais e admissão física confirmados. O fixture inicial tem histórico v1 e run legado `ERROR`, sem candidato canónico; o sucesso de recolha é produzido pelo executor com a resposta real.

O gate verifica:

- Recusa sem sessão, origem, CSRF, autenticação recente ou autorização adequada; recusa de outra identidade, campos adicionais, baseline e flags desativadas.
- Arquivo completo e preservação de v1 antes da aceitação; replay sem rede; conflito de ator; revogação coordenada enquanto a resposta pública está em curso, sem efeitos parciais nem locks de sessão sobre a rede.
- Plano factual derivado do arquivo, recusa de run legado, aprovação ausente/revogada, ator/digest/fences incorretos e fonte ainda ativa. Uma edição pelo repositório v1 antes da suspensão invalida o CAS aprovado.
- Imutabilidade real do arquivo em PostgreSQL. DRAFTs negativos separados comprovam recusa por expiração e mapping divergente; não houve espera de uma hora após aprovação nem alteração de planos/arquivos operacionais.
- Aceitação HTTP restrita, SQL 120000/sete prazos, recibo repetido sem nova revisão/auditoria, recusa de replay entre planos e bloqueio da retoma EU legado após v2.
- Leitores físicos central/tenant, paridade lista/detalhe, histórico v1, snapshots privados, interesses/candidaturas e unidades preservados. Outra organização vê zero linhas; ausência de organização é recusada com SQLSTATE 22P02, sem revelar linhas.

A cadeia de **13 eventos** é válida e houve **14 escritas APPLIED** pelo coordenador normal. Correções e resoluções da identidade usada são vazias; este cenário não prova preservação de decisões não vazias. As provas anteriores de bloqueio/reconciliação continuam pertinentes. Falhas de rede, parsing, arquivo, conclusão e auditoria são cobertas pelos testes direcionados do coletor; não são todas injetadas no novo gate PostgreSQL.

[Gate do pacote registado, novamente executado](../../../output/opportunity-v2-registered-d9112c867d53462989c3ed4584e5313d/verification.json): **12 PASS**, 397 hashes estáveis,9 eventos íntegros e cleanup. Confirma compatibilidade do caminho anterior com o código atual. O apontador operacional da prova foi atualizado, conservando a cópia anterior. PackageDigest `4f83267f1c2d3f41c604453f3489136397f661fbc06a99de8b79ed2980674e7a` e fingerprints 042/034 inalterados.

| Verificação | Resultado |
| --- | --- |
| Backend completo | 2161 PASS, 0 FAIL, 7 SKIP |
| Frontend completo | 492 PASS, 0 FAIL |
| Build frontend | PASS |
| Sintaxe | 23 ficheiros PASS |
| Integridade | 16 artefactos S0, workbook original/fixture 177 linhas, 148 SQL da prova registada e 124 SQL da baseline S6 preservados |
| Revisão independente | Sem bloqueantes; precisões de TTL/ator/replay incorporadas no runbook |

[Logs e resumo](../../../output/opportunity-v2-executor-11145/validation-summary.json), [sintaxe](../../../output/opportunity-v2-executor-11145/syntax.json) e [integridade](../../../output/opportunity-v2-executor-11145/integrity.json). Não houve novas alterações de produto após as suites; os ajustes posteriores limitaram-se ao harness e à documentação.

Dois ensaios FAIL foram conservados: [d129](../../../output/opportunity-v2-executor-d129b002f29c410984d13005c5fa1fa1/verification.json) tentou a edição v1 depois de quiescer e encontrou corretamente a barreira SQL; [ac579](../../../output/opportunity-v2-executor-ac5791d7bf9c42039c001b0bf0f99359/verification.json) esperava zero linhas sem GUC, mas o RLS recusou o UUID vazio. Corrigiram-se as asserções/sequência do harness; nenhum guard ou SQL foi enfraquecido. Ambos fizeram cleanup.

## Limites e continuidade

Não se certificou login num fornecedor OIDC, aprovação humana real, novo backup/restauro ou saúde atual da instalação habitual. O relatório da janela anterior mantém-se histórico. Antes da execução habitual, renovar preview e backups próprios/restauro, instalar/verificar o pacote durante a janela, selecionar as flags explicitamente e obter aprovação autenticada do digest factual vigente. Depois de aceitar EU v2, manter EU quiescente até existir writer compatível.

O percurso interno genérico de aceitação continua fora da exposição HTTP deste executor; a revisão identificou ordem de locks a harmonizar antes de o promover a uso operacional genérico. A sequência delimitada usa funding_run antes do controlo de fonte, coerente com a suspensão. Portugal2030, Interreg/POCTEP e os seus bloqueios documentados não são ativados por esta entrega.

Próximo passo: executar a janela habitual da 11145 com preview/backup/restauro renovados e aprovação autenticada do plano atual, seguindo os runbooks da janela e do executor.
