# Paginação do histórico de sincronizações

Pedido confirmado em 29/10/2026: máximo de 10 sincronizações por página.

## Critérios de aceitação

- Mostrar até 10 entradas por página, conservando a ordem recebida e todas as colunas.
- Navegação Anterior/Seguinte com página atual e total; desativar os limites.
- Paginar os registos disponíveis no frontend, preservando o limite atual de 100 da API e o respetivo aviso.
- Preservar a página durante consultas; ajustar ao total se o histórico diminuir e reiniciar na troca de conta.
- Preservar os estados de carregamento, erro e histórico vazio.

## Validação

Implementado. Regressão RED → GREEN: 21 entradas repartidas em 10/10/1, navegação e limites, ajuste após redução do histórico. Testes focados 10 PASS; frontend 379 PASS; backend 1632 PASS/7 SKIP; build PASS. Sem alteração de API, dados ou deploy.
