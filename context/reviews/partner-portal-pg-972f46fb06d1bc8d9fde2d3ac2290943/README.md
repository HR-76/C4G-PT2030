# Gate PostgreSQL — terceira tentativa

**28/10/2026 — FAIL em MIGRATION: DATABASE_CONFIGURATION_MISMATCH.** [Evidência original](evidence.json), [manifest desta execução](sources.json), [preservação](verification.json). As [primeira](../partner-portal-pg-f8ca4c45e35a826640ac25d2f8fa97ef/README.md) e [segunda](../partner-portal-pg-a7dc74a8441914bb00646b077a009ce9/README.md) falhas permanecem intactas.

## Resultado da execução autorizada

Mesmo âmbito descartável: imagem local imutável `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`, contexto Docker local, novo contentor próprio e SQL/migrations/grants exclusivamente aí. Sem pull, uso de Dev, paragem/reconfiguração de serviços existentes ou integração.

- 1013 fontes conferidas. Preflight inicial confirmou PostgreSQL 17 e READ COMMITTED.
- Início 00:33:51.725 e fim 00:33:59.938, hora de Lisboa (UTC nesta data); exit code 1.
- Erro exterior `ENVIRONMENT_SETUP_FAILED`, fase `TENANT_ENSURE`, tenant A, subetapa `MIGRATION`.
- Classificação `TENANT_MIGRATION`, código permitido `DATABASE_CONFIGURATION_MISMATCH`, confirmado também em `substepFailure`.
- `localCleanup:COMPLETED`; `cleanup.environmentClosed:false`, pois o setup não devolveu um environment preparado. O critério global `CLEANUP_NOT_PROVEN` foi conservado.
- `containerRemoved:true`, sem erros de remoção. Verificação posterior por ID completo e label retornou zero contentores, ambos com exit zero. O runner solicitou remoção com `--volumes`; não existe inventário independente dos volumes anónimos.
- Nenhum probe: repositório 0/14, autoridade 0/9, capacidade 0/52 tentativas e 0/26 aquecimentos. Sem medições antes/depois ou prova de snapshot/RLS/revogação/cleanup de cursores.
- Reavaliação offline com as fontes correspondentes reproduziu FAIL. Nenhuma repetição adicional.

O campo `execution:NOT_RUN` só muda depois do setup completo; não significa ausência de SQL. Houve preflight e preparação dentro do contentor descartável. A correção do timeout exterior não foi alcançada, porque a migração falhou antes dessa fase.

## Diagnóstico confirmado e hipótese a testar

**P2 — `backend/src/security/tenantMigrationPreflight.js:75`:** `validateDatabaseContract` recusa quando falta a linha de configuração ou quando servidor/base não são UTF8, TimeZone não é exatamente `UTC`, locale provider não é ICU (`i`), locale não é `und`, ou a versão de collation está vazia. A evidência confirma a recusa desse conjunto de condições; não contém a linha observada e, por isso, ainda não identifica qual campo divergiu.

**Hipótese source-backed, não conclusão observada:** `backend/src/platformOnboarding/postgresProvisioner.js:52` cria e usa o pool antes de `ALTER DATABASE ... SET timezone TO 'UTC'` na linha 55, e entrega o mesmo pool ao migration runner. O pool pode reutilizar uma sessão já aberta. O PostgreSQL aplica esse default de base às sessões iniciadas posteriormente, não à sessão já existente. [Documentação oficial PostgreSQL 17 — ALTER DATABASE](https://www.postgresql.org/docs/17/sql-alterdatabase.html).

Esta sequência torna o TimeZone da sessão um candidato concreto ao desvio. Não foi observado nem afirmado qualquer valor alternativo, como `Etc/UTC`, e não se descartam os restantes campos sem prova. O contrato de validação não foi relaxado.

Correção recomendada para revisão: primeiro reproduzir por regressão a sessão já aberta e a configuração efetiva antes da migração; depois garantir a configuração exigida nas ligações do gate, sem editar migrations/grants nem enfraquecer o preflight. Registar apenas os discriminadores de configuração necessários, por lista permitida, caso a reprodução não identifique o campo. Não repetir o gate para procurar PASS sem uma alteração explicada e testada.

## Alterações e preservação

Apenas novos artefactos desta tentativa (`evidence.json`, `sources.json`, `README.md`, `verification.json`) e atualização de `context/features/partner-postgres-gate.md` e `context/current-work.md`. Nenhuma correção ou teste novo neste turno; suites/build não repetidos porque não houve alterações de código. Última validação anterior: foco 187 PASS; backend 1525 PASS/0 FAIL/7 SKIP; frontend 346 PASS/build PASS. Estes resultados offline não são aprovação PostgreSQL.

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline 2609 entradas no worktree e 30983 ficheiros. Runtime, protótipo, fontes de migrations/grants/permissões e dados Dev preservados. Operações SQL autorizadas exclusivamente no contentor removido. Sem commit, merge, push ou deploy.

**Próximo passo:** reproduzir por regressão a configuração da sessão antes da migração e corrigir o desvio no gate, preservando o contrato estrito e as três tentativas.
