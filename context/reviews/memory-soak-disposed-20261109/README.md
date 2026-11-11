# Memória sob carga HTTP isolada

Estado: duas execuções exploratórias concluídas em 9–10 de novembro de 2026. Em ambas o heap do processo Node continuou a crescer após recolhas explícitas. A origem não foi isolada: o mesmo processo contém aplicação, cliente Playwright, fixtures e instrumentação. O resultado é um sinal a investigar, não prova de fuga da aplicação nem de crescimento ilimitado.

## Ensaio

PostgreSQL e Keycloak descartáveis, loopback, duas organizações isoladas, uma sessão autenticada usada na carga e dados sintéticos com 10 000 candidaturas e 1 000 pessoas. Alternaram-se listagem, relatório e dashboard em lotes de quatro pedidos concorrentes, durante cerca de cinco minutos depois do aquecimento. O processo Node foi amostrado a cada segundo e sujeito a recolha explícita de lixo aproximadamente uma vez por minuto, entre lotes. A primeira execução conservava as respostas do cliente de teste; na segunda as respostas foram explicitamente libertadas. Os registos de eventos do próprio harness foram desativados durante a carga e os registos de instrumentação por pedido são eliminados após leitura. Os contentores das duas execuções foram removidos; não foram usadas as bases habituais nem o R2 real.

| Medida | Primeira execução | Respostas libertadas |
|---|---:|---:|
| Duração | 302,6 s | 303,8 s |
| Pedidos / erros | 276 / 0 | 272 / 0 |
| Heap após GC inicial | 63,34 MiB | 63,09 MiB |
| Heap após GC final | 79,22 MiB | 78,06 MiB |
| Variação após GC | +15,88 MiB | +14,97 MiB |
| Pico de heap amostrado | 158,17 MiB | 152,82 MiB |
| Pico RSS amostrado | 489,25 MiB | 384,86 MiB |

Na segunda execução o heap após GC foi 63,09; 66,57; 69,58; 72,77; 75,62; 78,28 MiB às marcas aproximadas de 0, 64, 122, 182, 242 e 304 segundos. Uma recolha final adicional marcou 78,06 MiB. O RSS final após GC foi 351,84 MiB, face a 352,73 MiB inicialmente; RSS inclui memória não heap e não é obrigado a acompanhar o heap. Os picos são amostras a intervalos de um segundo, não máximos instantâneos garantidos. A comparação entre execuções não controla totalmente as condições do host.

Risco: retenção persistente durante a janela observada pode levar a pressão de memória em períodos superiores. A libertação das respostas não eliminou a tendência, mas não exclui outros efeitos do harness ou aquecimento de caches. Cinco minutos não demonstram comportamento a longo prazo. Não foram medidos separadamente Node servidor, navegador, PostgreSQL ou Keycloak; não se testaram todos os fluxos, outros volumes ou cargas mistas representativas.

Correção efetuada: o harness liberta as respostas do cliente HTTP e evita acumular eventos durante a carga. Não foi aplicada correção ao produto sem localizar a origem. Próximo teste: separar servidor e gerador de carga em processos independentes, repetir por horas com fases de carga e repouso, acompanhar RSS/heap de ambos e dos contentores, e comparar snapshots de heap após GC para localizar objetos retidos antes de corrigir a causa. Repetir com limites de memória e dados sintéticos em ambiente isolado.

Evidência: [segunda execução](results.json), [primeira execução](../memory-soak-20261109/results.json); harness em `test/integration/http-memory-soak/gate.ps1`. O estado PASS dos JSON refere-se às verificações funcionais e à ausência de erros HTTP, não a uma aprovação de memória.
