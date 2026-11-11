# Opção de teste para baseline de 30 dias

Esta opção faz uma amostra manual por período de 24 horas: PostgreSQL e Keycloak sintéticos descartáveis, API e navegador locais, dois tenants e três aberturas de Candidaturas. Os relatórios persistem em `context/reviews`; os contentores são identificados e removidos pelo próprio ensaio. Não utiliza bases habituais ou R2 real. Os dados descrevem apenas este ambiente sintético.

Pré-requisitos: Docker e imagens locais `postgres:18-alpine` e `quay.io/keycloak/keycloak:26.8.0`, dependências e build do frontend já instalados, e certificados locais de teste em `.tmp/f2-integration`. Não há download de imagens. Manter fontes, build e imagens constantes durante a janela. O processo precisa de portas locais e Docker. Um relatório já existente nunca é substituído.

Na raiz do projeto, executar em cada período de 24 horas, com nome novo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/baseline-test-option/run-daily.ps1 -Report baseline-test-YYYYMMDD
```

Escolher e guardar a data UTC de início antes da recolha. Analisar todos os diretórios recolhidos após 30 períodos, por exemplo:

```powershell
node test/integration/baseline-test-option/analyze.cjs 2026-11-10T00:00:00Z context/reviews/baseline-test-20261110 context/reviews/baseline-test-20261111
```

O exemplo tem apenas dois relatórios e não é uma janela completa. A saída JSON pode ser guardada num ficheiro novo. A análise exige janela fechada, pelo menos uma execução válida em cada período, nenhuma falha, versões iguais e limpeza confirmada; caso contrário devolve `INSUFFICIENT_EVIDENCE`, sem p95. Mesmo com 90 amostras, a precisão do p95 é limitada e o limiar mínimo deve ser aprovado. Não existe coletor contínuo ou agendamento automático: períodos sem execução ficam em falta. Esta opção não mede disponibilidade real, API p95, segurança ou acessibilidade de forma completa, nem RPO/RTO operacional. O restauro e o R2 real requerem provas próprias.

O piloto `baseline-pilot-20261109` valida o mecanismo; não inicia uma campanha de 30 dias.
