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

- `backend/test/requestPhaseTiming.test.js`.
