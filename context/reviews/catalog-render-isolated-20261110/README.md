# Atualizações do catálogo — medição isolada

Estado: correções no temporizador do aviso de repetição, na atualização de disponibilidade sem alterações e no cálculo de contagens de tarefas por participante. Os pedidos de disponibilidade, expiração, invalidação e permissões mantêm-se; testes simulados cobrem esses comportamentos.

Medição: `test/integration/catalog-render-isolated/profile.cjs` constrói o componente React real com um Profiler em modo de desenvolvimento e abre Chrome headless contra servidor temporário em 127.0.0.1. A página contém apenas o aviso sintético de erro 429, com prazo de dois segundos, e não faz chamadas à API ou a bases. Conta disparos de intervalos e commits React até 3,5 segundos depois de o botão ficar disponível.

| Medida | Antes | Depois |
|---|---:|---:|
| Disparos de intervalo | 3 | 2 |
| Commits React, incluindo montagem | 5 | 4 |
| Botão após a espera | Disponível | Disponível |

Cada lado é uma execução e o ambiente é instrumentado em desenvolvimento; não é uma medição de abertura de página, latência de API, produção ou ganho percentual geral. A regressão com relógio simulado confirma que não restam temporizadores após o prazo. A verificação periódica de disponibilidade foi preservada; o teste confirma que uma resposta inalterada não volta a renderizar o conteúdo protegido. O cálculo das contagens de tarefas utiliza uma passagem por lista em vez de uma filtragem por participante; teste focado verifica tarefas abertas/concluídas e acesso de consulta. Não foi medido o impacto dessas duas alterações no navegador.

Validação: suite frontend 96 ficheiros / 841 testes PASS antes da adição do teste final de contagem; depois, suite focada de equipa 23 testes PASS. Build frontend PASS. Sem bases habituais, API real ou R2 real.
