# Desempenho do Matching — Review

Pedido: medir e corrigir a lentidão mantendo resultados e regras de acesso.

Critérios ajustados à medição: medir endpoint autenticado e resultados visíveis antes/depois; comparar o resultado completo por hash; eliminar pedidos duplicados e priorizar o resultado principal; preservar filtros, ordenação, explicações, limite de recolha e validação final de autoridade. Leituras privadas e de pessoas continuam pelos serviços autorizados. Falhas não podem produzir resultados parciais. Sem cache partilhada de resultados privados, alterações de scoring, dados ou permissões.

Hipótese inicial, substituída após medição: instrumentação isolada de leitura e eliminação do N+1 central com consulta em lote. A medição abaixo mostrou que essa alteração não atacaria o custo dominante. Não foi implementada. O contrato HTTP permanece igual.

## Medição e ajuste do plano

Endpoint autenticado antes: 8217, 7953 e 7343 ms, sempre dez resultados e o mesmo hash do conteúdo completo. Leitura central isolada: listagem 78 ms e 114 detalhes em 59 ms. O N+1 não é o custo dominante neste ambiente: a proposta inicial de lote fica substituída por correção do agendamento no frontend, após medir a página.

O React StrictMode monta novamente os efeitos em desenvolvimento; os pedidos abandonados continuam na fila autorizada. Adiar o início para uma microtarefa permite cancelar o efeito abandonado antes de emitir pedidos. Priorizar Matching sobre a lista auxiliar de pessoas e dispensar essa lista no modo por oportunidade, onde não é utilizada. Sem cache de resultados, sem remover StrictMode e sem alterar serviços, filas de autoridade ou validação final. Testar cancelamento, mudança de contexto, tentativa após falha e equivalência real antes/depois.

## Resultado no ambiente habitual

Três carregamentos completos antes: **24946, 26465, 26441 ms** até aos resultados visíveis; dois pedidos de Matching e duas consultas de pessoas em cada carregamento. Depois: **11707, 11654, 12224 ms**, um pedido de cada. Mediana de 26,441 s para 11,707 s: redução de **55,7%**. O ganho foi medido no ambiente Vite de desenvolvimento com StrictMode, onde a duplicação se reproduzia; não extrapolar a percentagem para produção.

As três respostas finais coincidem integralmente com o hash anterior e mantêm dez correspondências, incluindo ordem e explicações. O tempo do endpoint continua em cerca de 8 segundos (8404, 8060, 8603 ms após a alteração). Esta correção elimina espera desnecessária no frontend; não declara resolvido todo o custo interno do serviço.

13 testes frontend passaram (sete do Matching, fila real e seleção de organização), seis testes backend existentes passaram, incluindo falha de fontes e revogação final. Build e sintaxe dos dois scripts de medição PASS. Três novos testes reproduziram os problemas antes da correção. Atualizado apenas o mock antigo de `pq1Api.session` no teste de seleção de organização; as asserções de acesso foram preservadas.

Evidência deste incremento: `output/matching-performance/before.json`, `page-before.json` e `page-frontend-after.json`. O nome foi explicitado para preservar esta medição histórica quando a fase backend repetiu o benchmark. Scripts em `test/integration/local-platform/matching-performance.cjs` e `matching-page-performance.cjs`. Guardam tempos, contagens e hashes; não guardam credenciais, cookies ou conteúdo privado. Bloqueiam operações de escrita de negócio, incluindo atualização automática de alertas. Sessões de teste produzem os logs normais de autenticação.

Backend, regras de acesso, bases, infraestrutura e motor determinístico não foram alterados. Não foi necessário reiniciar a API. Próximo passo técnico: medir por fase os cerca de oito segundos do serviço, antes de propor qualquer alteração às suas verificações de autoridade.
