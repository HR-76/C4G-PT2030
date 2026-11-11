# Gate PostgreSQL — segunda tentativa

**28/10/2026 — FAIL em TENANT_ENSURE, tenant A.** [Evidência](evidence.json), [manifest desta execução](sources.json), [preservação](verification.json). A [primeira falha](../partner-portal-pg-f8ca4c45e35a826640ac25d2f8fa97ef/README.md) não foi alterada.

Execução explicitamente autorizada com o diagnóstico revisto. Mesmo âmbito descartável: imagem local `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`, contexto Docker local, um contentor próprio, SQL/migrations/grants apenas aí e dados sintéticos. Sem pull, utilização de Dev, paragem de serviços existentes ou integração.

## Resultado

- Manifest de 1011 fontes conferido; PostgreSQL 17 e READ COMMITTED confirmados.
- Início 00:18:08.256 e fim 00:18:16.902, hora de Lisboa (UTC nesta data); exit code 1.
- Código exterior `ENVIRONMENT_SETUP_FAILED`; fase `TENANT_ENSURE`, tenant sintético `A`, classificação `UNKNOWN`, código interno não exportado (`null`).
- O fecho local retornou: `localCleanup:COMPLETED`. O environment não foi devolvido ao runner, pelo que `cleanup.environmentClosed:false` se mantém.
- Contentor próprio removido (`containerRemoved:true`, sem erros); ausência confirmada posteriormente por ID completo e label, ambos com zero resultados e exit zero. Remoção solicitada com `--volumes`; sem inventário independente dos volumes anónimos.
- Repositório 0/14, autoridade 0/9, capacidade 0/52 tentativas e 0/26 aquecimentos. Não há medições antes/depois nem prova de snapshot/RLS/revogação/cleanup de cursores.
- Reavaliação offline com as fontes desta tentativa reproduziu FAIL. O resultado `CLEANUP_NOT_PROVEN` não foi removido: fecho local e remoção do contentor não substituem os critérios de cleanup do gate.

O campo `execution:NOT_RUN` mantém-se até o environment ficar preparado; não significa que nenhum SQL foi executado. O preflight e a preparação anteriores a `TENANT_ENSURE` foram alcançados. A evidência não determina a subetapa nem as migrations concluídas dentro de `ensure`.

## Diagnóstico e limitação restante

A fase identifica a chamada `provisioner.ensure(input)` em `test/integration/partner-portal/environment.js:143`. A inspeção read-only mostra que `backend/src/platformOnboarding/postgresProvisioner.js:42` agrega reserva, roles/base, migrations, identidades, preflight e publicação do diretório. Não é possível atribuir a falha a uma dessas subetapas com a evidência atual.

**P2 — classificação ainda insuficiente:** `environment.js:68` usa uma lista permitida de SQLSTATE, conexão, dependência e asserção; erros de domínio do provisionamento/migração não estão nessa lista. `UNKNOWN` não prova que ocorreu um desses erros, apenas que a classificação atual não o reconheceu. Recomenda-se acrescentar, com regressão primeiro, códigos de domínio explicitamente verificados nas fontes e diagnóstico seguro das subetapas relevantes. Nunca copiar mensagens, stack, SQL, credenciais ou qualquer código arbitrário. A causa funcional permanece por identificar; não houve correção ou nova repetição neste turno.

## Alterações e validação

Apenas novos artefactos desta execução (`evidence.json`, `sources.json`, `README.md`, `verification.json`) e atualização de `context/features/partner-postgres-gate.md` e `context/current-work.md`. Sem código ou testes novos; suites/build não repetidos porque as fontes não mudaram. Última validação anterior: sete regressões novas, foco 159 PASS, backend 1497 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS. Não confundir estes resultados offline com aprovação PostgreSQL.

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline 2596 entradas no worktree e 30970 ficheiros. Runtime, protótipo, fontes de migrations/grants/permissões e dados Dev preservados. SQL autorizado exclusivamente no contentor descartável. Sem commit, merge, push ou deploy.

**Próximo passo:** cobrir por regressão os erros de domínio e subetapas de `TENANT_ENSURE`, acrescentando apenas diagnóstico permitido antes de outra tentativa.
