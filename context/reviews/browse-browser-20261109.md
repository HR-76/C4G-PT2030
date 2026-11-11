# Comparação de abertura de Candidaturas — 09/11/2026

Resultado: abertura mediana de **4,97 s para 4,17 s**, redução de cerca de **16,1%**, na fixture sintética. Não é uma medição de produção.

| Execução | Versão | Aberturas (s) | Navegação (s) |
| --- | --- | --- | --- |
| A1 | Anterior | 5,073; 4,972; 4,959 | 4,167 |
| B1 | Atual | 4,292; 4,170; 4,164 | 3,027 |
| B2 | Atual | 4,298; 4,034; 4,045 | 2,856 |
| A2 | Anterior | 5,130; 4,913; 4,876 | 4,065 |

Medianas das seis aberturas: A 4,965 s; B 4,167 s. Intervalos: A 4,876–5,130 s; B 4,034–4,298 s. Navegação: A 4,116 s; B 2,942 s, aproximadamente 28,5% menos, mas apenas duas amostras por versão: interpretar como indicativo.

## Método e limites

Quatro execuções sequenciais A/B/B/A. Cada uma criou PostgreSQL 18 e Keycloak descartáveis, duas organizações com 10 000 candidaturas sintéticas e 250 pessoas cada; central 050. OIDC/PKCE e RLS reais da fixture. A abertura é medida até resposta principal, fim do indicador, primeira linha e duas pinturas React; também se registou o fim dos pedidos auxiliares. A navegação foi medida a partir do dashboard. Todos os pedidos API observados responderam abaixo de 400 e não foram apresentados alertas de erro.

A usa exclusivamente `browseSql.js` anterior, congelado em `browse-full-20261109` e verificado pelo hash; B usa o runtime atual. O frontend é o mesmo build, e todos os hashes de fontes/build foram iguais entre as quatro execuções e verificados no final de cada uma. Imagens Docker idênticas. Os contentores próprios foram removidos; consulta final por label não encontrou contentores. Sem acesso às bases habituais ou deploy.

As fixtures são recriadas por execução e usam oportunidades privadas sintéticas; não provam comportamento de todas as combinações v1/v2 nem latência em produção. A comparação SQL anterior incluiu origens mistas e equivalência de resultados e digest. A amostra não permite estimar p95 nem capacidade; não há medição de revogação concorrente neste ensaio. Pode existir ruído de outra atividade na máquina.

O harness adaptado está em `test/integration/browse-browser/`. Evidência: [A1](browse-browser-a1-20261109/results.json), [B1](browse-browser-b1-20261109/results.json), [B2](browse-browser-b2-20261109/results.json), [A2](browse-browser-a2-20261109/results.json). Cada diretório contém hashes e configuração de imagens.
