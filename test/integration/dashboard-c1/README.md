# Observação das etapas do dashboard C1

Na raiz, com os mesmos pré-requisitos do [profile existente](../http-contention/profile.ps1):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/dashboard-c1/profile.ps1 -Report dashboard-c1-stages
node test/integration/dashboard-c1/analyze.js context/reviews/dashboard-c1-stages/results.json
node test/integration/http-contention/summarize.js context/reviews/dashboard-c1-stages/results.json
```

Escolher uma pasta de relatório nova para preservar ensaios anteriores. O wrapper define temporariamente `NODE_OPTIONS` para pré-carregar o observador e restaura o valor anterior. Usa o profile standard sem alterações: fixture descartável/labels próprias, OIDC, roles/RLS, mesmos limites e 36 amostras. O cleanup continua a pertencer ao runner original.

`stageObserver.js` acrescenta observação por AsyncLocalStorage às facades usadas pela rota: report, resumo privado, catálogo central e dashboardContext. Mantém chamadas/receiver/argumentos/resultado/erro/ordem, sem substituir objetos branded de autoridade. Observa queries Promise/callback usadas por este percurso; não é uma API genérica para Query/streams customizados. Os wrappers são repostos antes de o observador original ser fechado.

Não guarda SQL, parâmetros, credenciais ou resultados funcionais. Regista hashes, categorias, tempos e spans. Nos quatro dashboard C1 guarda intervalos das queries; os restantes cenários guardam apenas agregados por etapa. Spans de checkpoints são inclusivos e podem estar aninhados. Os intervalos são tempos do driver, não CPU PostgreSQL. O observador acrescenta custo; não o subtrair por inferência.

`analyze.js` verifica a ordem e ausência de sobreposição entre etapas, igualdade de contagens de queries/transações com a instrumentação original e presença de todos os intervalos C1. Calcula a união dos intervalos antes de atribuir cobertura temporal, separando-a da soma. O aquecimento é excluído. Resultados e limitações estão no [relatório](../../../context/reviews/dashboard-c1-stages/README.md).
