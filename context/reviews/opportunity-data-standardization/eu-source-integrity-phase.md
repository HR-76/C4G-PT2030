# Fecho técnico da integridade da fonte EU

31/10/2026. Estado: **correção técnica validada; saneamento do catálogo ainda em revisão**. Este incremento não ativou a recolha habitual, não alterou dados aceites nem executou migrações. A fonte EU permaneceu `QUIESCED`, fence 7.

## Contrato e proteção operacional

- O parser EU não atribui `European Commission` como financiador por defeito. O v2 só identifica o concedente direto quando a evidência oficial permite papel `DIRECT_AWARDER`.
- Na composição com controlo EU, pedidos e claims `EU_FUNDING_TENDERS`, `CORDIS` e `ERASMUS` sem escritor v2 são recusados antes de qualquer escrita do catálogo com `FUNDING_EU_V2_WRITER_REQUIRED`. A API expõe o código e uma mensagem específica com HTTP 503. A suspensão e o fence continuam a preceder o bloqueio no pedido.
- Novos conflitos conservam motivos fechados no checkpoint transacional. Os históricos não foram reescritos com causas observadas posteriormente; a leitura atual dos cinco IDs e a comparação com as resoluções protegidas permanecem num [recibo datado](../../../output/eu-conflict-observation-e078170d-a209-4ce7-921a-7d80ba1be5ea.json).

## Paridade da chamada 11145

A [verificação ao vivo só de leitura](../../../output/eu-11145-parity-821c2e91-3380-45b7-8ed4-fb8ceb2421b7.json) comparou uma nova resposta da API pública EU com o snapshot v2 aceite e as tabelas SQL habituais, em transação `REPEATABLE READ READ ONLY`. Resultado **PASS** para os factos v2: sem mudança semântica entre a resposta atual e a revisão aceite.

| Campo | API EU atual | Snapshot/BD | Resultado |
| --- | --- | --- | --- |
| Dotação total | `metadata.budget = "120000"` | `money.amount = "120000"`; SQL `numeric(32,8) = 120000.00000000` | ✅ |
| Moeda da dotação | Chave ausente no registo da API | `currency.state = NOT_FOUND`, código SQL `NULL` | ✅ ausência representada fielmente |
| Concedente direto | Declaração explícita na descrição oficial | `Gnomon Informatics SA`, papel `DIRECT_AWARDER` | ✅ |
| Prazos | Sete cut-offs publicados | Sete linhas SQL e sete entradas v2 idênticas | ✅ |
| Financiador v1 novo | Fonte não atribui um nome | `funderName` ausente no parser; escritor legado bloqueado no modo operacional | ✅ |

O `€` relativo ao apoio mensal na descrição tem âmbito diferente de `metadata.budget`. O pedido identifica a apresentação da dotação como `120 000,00 €`, mas a resposta da API arquivada e a observação atual não publicam um campo de moeda ligado à dotação. O HTML público da página é uma shell JavaScript e a sessão gráfica oficial não esteve disponível neste ensaio; a moeda da dotação não foi verificada de forma independente no portal renderizado. Não preencher `EUR` por inferência mantém a proveniência fiel. Se surgir evidência oficial explícita para a moeda da dotação, será necessária uma alteração localizada com proveniência e regressão.

O recibo identifica também `staleLegacyFunder: true` na linha auxiliar `funding_identity.last_source_fields` da 11145: conserva `European Commission` de uma recolha anterior. A leitura v2 usa a revisão aceite e apresenta Gnomon como concedente direto, mas a linha auxiliar histórica ainda precisa de saneamento controlado. A paridade v2 não equivale à correção integral de todas as colunas legadas.

## Estado real e decisões pendentes

A [auditoria habitual renovada](../../../output/eu-pending-audit-967cc8de-0622-4950-9df1-3baf048a46d9/review-inventory.json) passou em leitura apenas: **137** candidatos v2 com arquivos verificados permanecem `REVIEW`; **cinco** alvos permanecem `CONFLICT`. A [fila por identidade desses candidatos](../../../output/eu-pending-audit-967cc8de-0622-4950-9df1-3baf048a46d9/decision-queue.csv) contém a comparação para revisão.

A [contagem abrangente](../../../output/eu-legacy-funder-inventory-f6e32b25-c768-4125-9af6-7e6a8e88f32d/inventory.json) de `funding_identity`, excluindo prefixos POCTEP/Interreg Europe, identificou **536** rótulos `European Commission` herdados: **535** revisões v1 e **uma** revisão v2 (11145) cujo campo auxiliar `last_source_fields` ficou antigo. A [fila completa](../../../output/eu-legacy-funder-inventory-f6e32b25-c768-4125-9af6-7e6a8e88f32d/queue.csv) separa **137** casos v1 com candidato/decisão de revisão, **398** v1 que precisam de nova evidência e revisão, e **uma** reconciliação do baseline auxiliar da 11145. Estas contagens não equivalem a aprovação nem provam que todas as 535 chamadas tenham o mesmo concedente direto. O bloqueio do escritor impede novas atribuições erradas, mas não corrige esses dados já aceites. A migração v1→v2 exige decisão humana autenticada, CAS atual, arquivo verificado e aprovação por identidade. Nenhuma aceitação em lote foi inferida.

Para os cinco conflitos, a leitura pública nova encontrou `CANONICAL_TITLE_CONFLICT` em `CASCADE:17045` e `SOURCE_VARIANTS_DIVERGE` nos quatro AFIF. Os quatro fingerprints AFIF coincidem com as resoluções protegidas; isto preserva a evidência anterior, mas não autoriza promoção automática do v2. O título contraditório de 17045 requer conferência editorial antes de escolher um valor.

## Regressões e gates

- RED→GREEN: bloqueio operacional v1 para as três seleções EU e resposta HTTP específica. Testes focados PASS.
- Backend completo: **2339 PASS, 0 FAIL, 7 SKIP** de 2346 testes. [Log](../../../output/eu-source-integrity-backend-tests.log).
- Frontend: **496 PASS** e build PASS. [Testes](../../../output/eu-source-integrity-frontend-tests.log); [build](../../../output/eu-source-integrity-frontend-build.log).
- Sintaxe dos cinco ficheiros alterados neste incremento PASS. A prova SQL descartável dos motivos de conflito do incremento anterior continua [PASS em 15 checks](../../../output/eu-conflict-diagnostics-gate-279c89f1-310f-4c92-bbf1-03cec7868c44/verification.json).

## Critério para declarar o catálogo EU fidedigno

A paridade da 11145 e o caminho automático v2 estão validados. O **catálogo EU completo ainda não pode ser declarado saneado** enquanto os 535 v1, o baseline auxiliar da 11145 e os cinco conflitos mantiverem as pendências acima. A próxima janela deve adquirir evidência para os 398 sem candidato, preparar preview/backup/restauro atualizados, obter aprovação autenticada por identidade e executar migrações com reconciliação posterior. Até lá, conservar `QUIESCED` e não tratar `REVIEW`/`CONFLICT` como dados aceites.
