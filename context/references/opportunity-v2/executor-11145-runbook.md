# Operação delimitada da chamada 11145

**Atualização31/10/2026:** o percurso foi [executado e verificado no ambiente habitual](../../reviews/opportunity-data-standardization/habitual-11145.md), com pacote042/034, aprovação OIDC real e11145 aceite em revisão5. EU permanece `QUIESCED`, fence3. As instruções abaixo documentam a primeira execução; não repetir a recolha nem tentar retomar o escritor legado após v2. Os defaults do código continuam desativados, com seleção explícita apenas na configuração habitual autorizada.

## Pré-condições

Usar os bytes fixados no relatório do executor, o pacote registado `opportunity-v2-activation-11145` e os preflights normais. O contrato normativo e o SQL036–042/tenant034 permanecem inalterados. As evidências antigas da janela são históricas: renovar observação, consistência, backup próprio e restauro na janela efetiva, conforme [plano de instalação/recuperação](window-11145-runbook.md).

Depois de instalar e verificar o pacote, selecionar explicitamente `OPPORTUNITY_ACTIVATION_RUNTIME=authenticated-v2` e `OPPORTUNITY_11145_EXECUTOR=bounded-v2` na API. O controlo EU no worker deve usar a mesma seleção de ativação autenticada; o executor delimitado é uma operação da API e não liga o coletor genérico. A ausência da flag, um valor desconhecido, uma dependência em falta ou um schema não admitido impedem o percurso.

Usar sessão administrativa persistida, autenticação recente conforme a política individual vigente, origem e CSRF válidos. O servidor obtém ator, destino, fonte, identidade e CAS. O cliente não fornece esses campos nem um snapshot para publicar. Os métodos comuns estão em `opportunityActivationApi`, em `frontend/src/api/api.js`; não existe nova página administrativa nesta entrega.

## Sequência de execução

Base HTTP: `/api/admin/opportunity-activation`. Criar um `requestId` novo por intenção; reutilizar exatamente o mesmo ID apenas para repetir uma intenção cujo resultado ficou incerto. A coleção exige UUID; os restantes pedidos usam o formato já definido pela API. Nunca reutilizar IDs de exemplos como pedidos reais.

1. `GET /sources/eu`: confirmar `ACTIVE` e obter o fence atual. Não inferir disponibilidade a partir do heartbeat.
2. `POST /calls/11145/collect`, com `{requestId, expectedSourceFence}`. A URL/query, identidade `CASCADE:11145`, fonte EU, adaptador, limites de rede e contagem máxima de variantes estão fixados no servidor. A resposta contém `runId`, arquivo, digests, identidade/CAS observado e metadados públicos da consulta. O candidato é arquivado; a revisão aceite permanece intacta.
3. Se a resposta ficar incerta, repetir o mesmo pedido e fence. O binding inclui propósito, ator, pedido, UUID conhecido e fence. Um replay válido devolve o arquivo já verificado sem nova consulta pública; uma colisão com outro propósito/ator/identidade é recusada. Não criar outro pedido apenas para ocultar uma falha de verificação.
4. `POST /sources/eu/suspend`, com `{requestId, expectedFence}`; aguardar ausência de leases e pedir `POST /sources/eu/quiesce` com o novo fence. Suspensão e quiescência são operações distintas. Se houver trabalho ativo, investigar/aguardar sem eliminar filas ou prolongar deadlines.
5. Pelo mesmo ator que efetuou a recolha, `POST /calls/11145/plans`, com `{requestId, runId}`. O servidor verifica que o run pertence ao coletor limitado e deriva o arquivo e o CAS da identidade atual. Não criar plano a partir de um ficheiro local ou de um run legado.
6. `GET /plans/:planId`: conferir candidato, revisão aceite, alterações e campos protegidos. Verificar a dotação publicada, moeda, datas, projeto e prazos na observação real. As expectativas normativas são120000, moeda `NOT_FOUND`, SUSA/acordo101190010 e sete cut-offs; diferenças legítimas da fonte exigem revisão, não substituição silenciosa pelos exemplos.
7. `POST /plans/:planId/approve`, com `{requestId, planDigest}`. O digest vem do plano acabado de rever. O TTL é de uma hora desde a preparação e não é renovado pela aprovação; alterações de arquivo/mapping/CAS ou revogação invalidam a aceitação. Não aprovar automaticamente a partir do sucesso da recolha.
8. Pelo mesmo ator que aprovou, `POST /calls/11145/plans/:planId/accept`, com `{requestId, planDigest, fence, sourceFence}`. `fence` pertence ao plano aprovado e `sourceFence` ao estado EU quiescente. São valores independentes. A restrição11145, digest, aprovação, autoridade, TTL e arquivo são verificados na transação de aceitação e no replay. O CAS atual protege a nova escrita; o replay verifica o recibo ligado à intenção e ao CAS originais, sem exigir que o head atual ainda seja o anterior à aceitação. A auditoria é atómica com a nova escrita e não é duplicada pelo replay.
9. Conferir recibo, nova revisão, leitura comum v1/v2, projeção SQL do dinheiro/calendário e preservação de UUID/histórico/vínculos privados. Uma repetição válida devolve o recibo original sem nova revisão. Manter EU quiescente depois da primeira aceitação v2; o writer legado não pode ser retomado.

`collect11145`, `prepare11145` e `accept11145` são os métodos do cliente para estas três operações. Consulta de plano, aprovação/revogação e controlo EU usam os métodos comuns anteriores. Não existem parâmetros para escolher outra chamada, fonte, organização ou base.

## Atomicidade e recuperação

A primeira transação verifica autoridade/fence/identidade e fecha antes do HTTP público. A gravação ocorre numa segunda transação, depois de repetir essas verificações: cria/claim do run, arquivo, rederivação, completude, `SUCCESS` e auditoria. Não há dispatch para o writer v1 nem run pendente comprometido sem outbox. Falha de rede, parsing, identidade, autoridade, fence, arquivo ou auditoria conserva a revisão aceite e não produz sucesso parcial.

O número de resultados recebidos representa as variantes reais da resposta; a coleção produz um único candidato11145. O verificador compara essa contagem com as variantes arquivadas. Não substituir contagens ou valores factuais por constantes do exemplo normativo.

Antes do commit, falha/interrupção desfaz a gravação. Depois de um commit com resposta perdida, repetir o pedido permite recuperar o arquivo/recibo. Falha de aprovação ou CAS exige novo plano e nova revisão humana. A emissão de um plano não suspende fontes automaticamente, e a aceitação não retoma escritores.

Após aceitação, corrigir por nova revisão auditada e conservar histórico. Recuperação integral usa backup/restauro em nova base/generation, reconciliação das escritas posteriores e prova de autenticação/bindings antes da troca; não executar rollback destrutivo nem restaurar por cima da base habitual. O [plano da janela](window-11145-runbook.md) mantém os limites do restauro lógico e dos serviços externos.

## Limites do ensaio

O ensaio utiliza resposta pública atual da Comissão Europeia, PostgreSQL descartável, HTTP/middleware/CSRF reais e sessões administrativas de teste persistidas pelo coordenador normal. Não autentica uma pessoa real no fornecedor OIDC nem concede aprovação para a instalação habitual. Não ativa Portugal2030, Interreg/POCTEP ou recolha genérica EU; as pendências anteriores dessas fontes mantêm-se.
