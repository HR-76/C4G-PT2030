# Diagnóstico de contenção HTTP

Executar na raiz com os mesmos pré-requisitos do [gate HTTP/OIDC](../http-oidc/README.md):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-contention/profile.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-contention/profile.ps1 -Mode capacity -Report authority-contention-capacity
node test/integration/http-contention/summarize.js context/reviews/authority-contention/results.json
node test/integration/http-contention/summarize.js context/reviews/authority-contention-capacity/results.json
```

Contentores exclusivos PostgreSQL/Keycloak, duas bases tenant, migrations existentes e dados sintéticos; cleanup por UUID/label. Não usa bases Dev nem altera código/configuração do produto. O modo standard mede report C1/C2/C4, dashboard C1/C4 e dashboard C4 em dois tenants. O modo capacity faz um único burst de seis dashboards no mesmo tenant aquecido, mantendo os limites reais. Há 1000 candidaturas e 250 pessoas por tenant.

Os wrappers observam queries, checkouts, admissão e spans; preservam argumentos/resultados/erros, guards e allocations originais. O sampler consulta `pg_stat_activity`/`pg_blocking_pids` a cada 100 ms. Texto SQL e parâmetros não são persistidos: apenas categorias, hashes, contagens, tempos e callsites de código. PIDs e identificadores de correlação são efémeros/sintéticos.

`COMPLETE` e exit 0 significam que o diagnóstico terminou; **não significam que todos os pedidos passaram ou que o gate de desempenho foi aprovado**. Consultar successes/errors por cenário. Quantis incluem apenas respostas 200. Não aumentar pools/timeouts nem desativar verificações durante esta prova.

Nas futuras regressões C6, aplicar obrigatoriamente o [gate C6 com SLO versionado](../c6-dedicated/README.md): p95 de admissão ≤3 s, máximo ≤4 s, margem ≥1 s para timeout 5 s e zero erros. Exige série completa AB/BA, fontes fixadas e ambiente reservado/observado válido; um burst capacity isolado mantém valor diagnóstico, mas não aprova a regressão. A CLI do gate deve terminar 0, após cleanup, para permitir aprovação.

Limitações: spans sobrepostos; duração pg inclui fila no client e rede; percentagens de frames não são percentagens exatas de tempo; segundo tenant inicialmente frio no standard; checkout pode ser atribuído ao contexto que despacha a fila, devendo ser analisado agregadamente; `afterResponseQueries` conta conclusões após `finish`, com a duração integral da query. O span exportado de segurança não cobre chamadas lexicais internas. O custo da instrumentação impede usar os números como capacidade produtiva.

Conclusões e evidência em [context/research/authority-contention.md](../../../context/research/authority-contention.md).
