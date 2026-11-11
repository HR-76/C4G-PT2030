# Rampa de throughput HTTP isolada

Estado: medição exploratória concluída em 9 de novembro de 2026. A meta de p95 ≤ 3 s é uma proposta ainda não aprovada, usada aqui como limiar experimental; exigiu-se também zero erros. O resultado não estabelece a capacidade de produção.

O ensaio utilizou PostgreSQL e Keycloak descartáveis, acessíveis apenas em loopback, com dados sintéticos de 10 000 candidaturas e 1 000 pessoas. Cada percurso foi testado separadamente, com uma sessão autenticada, um pedido de aquecimento e 40 pedidos por nível de concorrência, em circuito fechado. O throughput é o número de respostas HTTP 200 dividido pelo tempo total da amostra. Os percentis incluem apenas respostas bem-sucedidas. A instrumentação SQL estava ativa. Os contentores deste ensaio foram removidos; não foram utilizadas as bases habituais nem o R2 real.

| Percurso | Concorrência | Pedidos/s | p95 (s) | Erros | Limiar experimental |
|---|---:|---:|---:|---:|---|
| Listagem | 1 | 0,52 | 2,064 | 0 | Cumpre |
| Listagem | 2 | 0,95 | 2,209 | 0 | Cumpre |
| Listagem | 4 | 1,63 | 2,758 | 0 | Cumpre |
| Listagem | 6 | 1,80 | 4,078 | 0 | Não cumpre |
| Relatório | 1 | 0,32 | 3,299 | 0 | Não cumpre |
| Relatório | 2 | 0,64 | 3,198 | 0 | Não cumpre |
| Relatório | 4 | 1,07 | 3,899 | 0 | Não cumpre |
| Relatório | 6 | 1,28 | 5,546 | 0 | Não cumpre |
| Dashboard | 1 | 0,31 | 3,490 | 0 | Não cumpre |
| Dashboard | 2 | 0,59 | 3,976 | 0 | Não cumpre |
| Dashboard | 4 | 1,04 | 4,061 | 0 | Não cumpre |
| Dashboard | 6 | 1,24 | 5,731 | 0 | Não cumpre |

O maior débito observado que cumpre o limiar na listagem foi 1,63 pedidos/s, a quatro concorrentes. O nível seguinte testado não cumpriu. Nenhum nível testado do relatório ou dashboard cumpriu; não se demonstrou um débito global que satisfaça o limiar para os três percursos. Não se pode deduzir o máximo exato nem afirmar capacidade nula para os percursos que falharam. O estado PASS no JSON refere-se às verificações do harness e à ausência de erros, não ao cumprimento da meta de latência. O campo failures contém respostas recusadas em testes de autorização, não erros da amostra de carga.

Risco: a latência do relatório e do dashboard excede a meta proposta mesmo no nível mais baixo testado, e a listagem degrada com concorrência. O perfil regista 614, 673 e 686 chamadas SQL por pedido, respetivamente, incluindo metadados; investigar o custo e a necessidade dessas chamadas e da seleção de dados antes de alterar mecanismos de autorização.

Correção proposta: identificar e reduzir trabalho repetido nos percursos de relatório e dashboard, preservando permissões e isolamento; depois comparar antes/depois no mesmo ambiente. Teste adicional: repetir amostras mais longas e independentes, testar mais pontos junto da transição, diferentes utilizadores e tenants e uma carga mista com taxa de chegada independente. Aprovar SLOs e definir uma carga representativa antes de declarar capacidade operacional. Quarenta amostras por ponto e uma execução não fornecem uma estimativa robusta das caudas; a configuração do leitor central do ensaio também não prova equivalência com privilégios de produção.

Evidência detalhada: [results.json](results.json); harness reproduzível em `test/integration/http-throughput-ramp/gate.ps1`.
