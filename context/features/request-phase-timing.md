# Medição por fase de cada pedido à API

Estado: Review. Sem medição em ambiente real.

## Porquê

A análise de 20/11/2026 à abertura das páginas concluiu, por leitura do código, que o tempo é dominado por um custo fixo em cada pedido: várias transações de autoridade por pedido (leitura da sessão, validação, renovação no fim da resposta), todas sob o mesmo lock exclusivo. Nenhum destes custos foi medido com sessão real. O coordenador de autoridade e o armazenamento da sessão já cronometram as suas fases (`security/sessionTiming.js`), mas o observador só era ligado nos ensaios isolados.

## O que faz

Com `REQUEST_PHASE_TIMING=log`, a API escreve no stdout uma linha JSON por pedido `/api` que chega à sessão:

```json
{"signalCode":"c4g.api.request_phases","timestamp":"…","method":"GET","route":"/api/applications/:id","status":200,"totalMs":812.4,"phases":{"authority.lock":{"count":5,"ms":301.2},"authority.verify":{"count":5,"ms":220.9},"touch.total":{"count":1,"ms":140.3}}}
```

- `count` de `authority.lock` é o número de transações de autoridade do pedido; `ms` é o tempo à espera do lock.
- Fases: `authority.pool|admission|lock|verify`, `sessionRead.pool|admission|lock|verify`, `touch.get|validate|set|total|joined`.
- Por transação de autoridade (20/11, segunda volta): `authority.setup` (BEGIN, limites e identidade), `authority.work` (o trabalho dentro da transação) e `authority.commit`.
- Lado do tenant (20/11, segunda volta): `tenant.resolve` (da revalidação à emissão do lease), `tenant.acquire` (ligação ao tenant), `tenant.metadata` (observação do schema do tenant, uma vez por pedido), `tenant.verify` (verificação física), `tenant.revalidate` (membership e diretório na Central), `tenant.transaction` (a transação inteira), `tenant.work` (as consultas da operação), `tenant.guard` e `tenant.commit`. **Estas fases sobrepõem-se**: `resolve` e `transaction` contêm as outras, e `revalidate` e `guard` contêm transações de autoridade. Leem-se lado a lado; não se somam.
- `aborted: true` marca um pedido que o browser abandonou antes de a resposta terminar; as fases dessa linha são parciais.
- `totalMs` conta desde a entrada no middleware (depois dos parsers) até a resposta terminar, incluindo a renovação da sessão.

## Limites

- Desligado por omissão. Sem a variável, ou com `off`, nada é criado e o runtime fica igual. Outro valor falha o arranque.
- Só diagnóstico: não altera autorização, sessão, locks, contratos HTTP nem cabeçalhos de resposta.
- A linha não leva identificadores nem dados do pedido: o caminho é reduzido a um modelo (qualquer segmento que não seja só letras minúsculas e hífenes passa a `:id`), sem query string. Nomes de fase fora da lista são ignorados.
- Uma falha ao escrever a linha nunca afeta a resposta.
- Observações fora de um pedido HTTP (arranque, tarefas internas) são ignoradas.

## Critérios de aceitação

1. Sem `REQUEST_PHASE_TIMING` a composição não monta nenhum middleware novo nem passa observador ao coordenador.
2. Com `log`, um pedido produz exatamente uma linha, com as fases observadas durante esse pedido somadas por nome.
3. Dois pedidos em simultâneo não misturam fases.
4. Caminhos com UUID, números ou outros segmentos variáveis aparecem como `:id`; a query string nunca aparece.
5. Valor inválido da variável falha o arranque.

## Utilização no staging

Acrescentar `REQUEST_PHASE_TIMING=log` a `/srv/c4g-staging/api-private.env`, recriar só a API (`up -d --force-recreate api`, nunca o pod) e ler com `docker logs` filtrando por `c4g.api.request_phases`. Retirar a variável no fim da medição.

## Validação

- `backend/test/requestPhaseTiming.test.js` (10).
- Os cronómetros do tenant e da autoridade são invólucros à volta de chamadas existentes (`measurePhase`): com a medição desligada chamam o trabalho e mais nada. Ficheiros tocados: `security/authorityCoordinator.js`, `security/tenantResolver.js`, `security/tenantLeaseExecutor.js`, `security/tenantRuntimeMetadata.js`.
- Suite do backend: 3553 aprovados, 9 ignorados, 2 falhas anteriores e alheias em `f2Security.test.js` (SEC-AC-01, leem ficheiros do frontend). Lint aprovado.

## Primeira recolha no staging (20/11/2026)

Um utilizador, sessão real. A admissão do schema da Central custa 240–390 ms em cada pedido, quase independente do número de transações (3 a 65). Espera de lock: 1–7 ms em pedidos isolados, 100–225 ms com pedidos em paralelo. Renovação da sessão: 7–19 ms. Nos pedidos ao tenant, 0,9 a 4,3 s ficaram fora das fases então medidas, o que motivou a segunda volta.
