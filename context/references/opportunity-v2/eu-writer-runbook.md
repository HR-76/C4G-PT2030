# Escritor EU v2 — operação e janela posterior

Estado: integração e ensaio isolado concluídos; consultar o [relatório](../../reviews/opportunity-data-standardization/eu-writer.md) antes da ativação habitual. Este documento não concede autorização para executar a janela habitual.

## Seleção e admissão

O pacote `opportunity-eu-writer-v2` acrescenta apenas Central043 sobre042. Tenant034 e o pacote `opportunity-v2-activation-11145` mantêm-se. A instalação usa `applyRegisteredEuWriterPackage(pool, packageId)` e os preflights normais; o migrador por omissão não avança automaticamente para043. Não aplicar SQL avulso nem preencher manualmente o ledger.

API e worker usam a seleção explícita `OPPORTUNITY_EU_WRITER=canonical-v2`, com `OPPORTUNITY_ACTIVATION_RUNTIME=authenticated-v2`, `FUNDING_TENDERS_RUNTIME=central`, cobertura `durable-v1` e enriquecimento `verified-v1`. Sem seleção, o novo escritor está desativado. A política `eu-existing-v2.0` e o digest dos adaptadores type1/type8 são derivados da implementação; não são valores livres enviados pelo cliente HTTP.

Na configuração nativa local, `opportunityEuWriter` é um descritor separado de `opportunityActivation`: `packageId`, `policyVersion` e `mappingDigest`, exatamente os valores publicados pelo pacote e por `euWriterConfiguration()`. O descritor existente da11145 permanece intacto. A configuração nativa valida a seleção, mas a autoridade de instalação continua a depender da verificação física da base.

O heartbeat publica capacidade, política e digest. A admissão de jobs e a configuração/retoma autenticada exigem correspondência com essa capacidade. Run e sucessores conservam o modo, a política e o digest iniciais. Reiniciar um worker não promove runs legados.

## Procedimento para a janela habitual futura

1. Renovar inventário, preview11145, backup/restauro e plano de recuperação. Revalidar Central042/tenant034, fonte quiescente, ausência de leases e runs pendentes e identidade/revisão atuais. Os valores da janela anterior são evidência histórica, não uma autorização reutilizável.
2. Instalar o pacote043 na janela autorizada, com preflight/fingerprints antes e depois, preservando ledger e dados. Não alterar tenant nem grants funcionais. Verificar a identidade física do serviço e o acesso à role `c4g_eu_writer_runtime`; a role humana `c4g_opportunity_central_runtime` não recebe membership dessa role.
3. Publicar a seleção explícita para API e worker e verificar readiness, digest e política. A fonte continua suspensa durante esta preparação.
4. Com sessão administrativa atual, CSRF e autenticação recente, consultar `GET /admin/opportunity-activation/sources/eu`. Usar `POST .../sources/eu/writer` com `{requestId, expectedFence}` para configurar o escritor enquanto `QUIESCED`, sem runs pendentes. A API vincula a política configurada ao recibo e auditoria; não aceita policy/mapping livres.
5. Rever o estado e a capacidade atual; executar a retoma autenticada por `POST .../sources/eu/resume`, com nova intenção e fence exata. Só depois pedir a recolha pelo endpoint administrativo normal. Verificar primeiro um ciclo controlado, arquivo, revisão11145, contadores, fila de revisão e auditoria antes de ampliar a operação.

## Resultados e revisão humana

Oportunidades existentes em v2, sem perdas/conflitos ou estado protegido, podem ser atualizadas pelo serviço. Uma observação semanticamente igual não cria revisão. Novas identidades, migrações v1, mapping divergente e alterações inseguras ficam como `REVIEW`, sem modificar o head nem contar como criadas/atualizadas. O ciclo expõe as pendências separadamente e não declara sucesso integral quando há revisões por tratar.

`GET /admin/opportunity-activation/eu-writer/reviews` devolve páginas limitadas, cursor, razões, arquivo, payload digest e CAS esperado, sob autoridade administrativa persistida. `canPrepare` indica apenas que o arquivo terminou de recolher; não significa aprovação ou aceitação. O percurso humano existente prepara o plano a partir do arquivo e exige novo preview/aprovação. A publicação HTTP continua limitada ao executor11145; não é introduzido neste incremento um executor genérico para novos IDs. As decisões de revisão são históricas e imutáveis, não uma lista de tarefas automaticamente apagada após uma aprovação posterior.

## Suspensão e recuperação

Suspender pela API existente, aguardar o escoamento/expiração das leases e reconhecer quiescência. Uma suspensão durante transporte impede a aceitação posterior numa época obsoleta. Preservar arquivos, decisões, recibos e revisões para reconciliar redelivery e diagnosticar falhas.

Se043/configuração não puderem operar, manter EU suspensa. Não voltar ao writer v1 sobre oportunidades v2. Uma falha transacional reverte o catálogo, projeções, auditoria e resultado do item conjuntamente. Restaurar uma base exige uma janela própria, cópia coordenada de dados/configuração e reconciliação de escritas posteriores; não apagar revisões nem reescrever recibos ou aprovações. Revalidar autenticação, bindings, fingerprints e autoridade física após restauro.

## Limites do ensaio

O gate descartável verificou o worker/queue reais: baseline11145 com transporte público real, seguida de cenários controlados e fixtures declaradas. Aprovações/sessões sintéticas não equivalem a uma aprovação humana habitual. A ligação de orquestração do worker no gate usa o proprietário isolado; a role limitada de emissão de permits e a sua negação às roles humana/leitor foram verificadas separadamente. Isso não certifica uma nova credencial física de worker com privilégios mínimos de ponta a ponta. A política relativa a metadados previamente protegidos num head v2 tem prova unitária; não foram desativados guards para fabricar esse estado no ensaio SQL.
