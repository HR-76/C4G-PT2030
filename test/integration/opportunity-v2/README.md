# Ensaios isolados do contrato v2

Executar apenas com autorização para PostgreSQL/PgBoss descartáveis locais:

```powershell
node test/integration/opportunity-v2/gate.cjs --isolated --activation-http-only
```

Esta prova atual instala os candidatos de arquivo, persistência, aprovação, autoridade e controlo EU; usa sessões de fixture persistidas, cookies assinados, middleware de autenticação/CSRF/origem e PgBoss reais. Não faz login num fornecedor OIDC nem acede ao ambiente habitual. Nenhum endpoint de aceitação é exposto.

O modo anterior `--activation-only` foi substituído e recusa execução antes de criar infraestrutura. O novo contrato exige o fence da fonte e prova atual de quiescência; a prova histórica de preparação e os respetivos resultados permanecem preservados em `activation-proof.cjs` e em `output/`. Os seus auxiliares de fixtures são reutilizados, sem contornar a nova barreira.

`--isolated` continua a executar o corpus S6 de reconciliação, persistência, paridade SQL e consumidores. `--temporal-only` e `--bootstrap-only` mantêm os recortes existentes. Todos os modos recusam destinos fornecidos pelo chamador, verificam hashes dos inputs e removem apenas o contentor criado pelo próprio gate.
