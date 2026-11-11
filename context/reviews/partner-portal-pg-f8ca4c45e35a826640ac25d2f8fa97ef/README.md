# Gate PostgreSQL de parceiros — primeira execução

**28/10/2026 — FAIL na preparação do ambiente; sem integração.** [Evidência original](evidence.json), [hashes das fontes](sources.json), [runbook](../../../test/integration/partner-portal/README.md).

## Âmbito e resultado

Execução explicitamente autorizada pelo utilizador: contentor descartável próprio, imagem local imutável, migrations/grants apenas nesse contentor, dados sintéticos e cleanup. Não houve pull, utilização de Dev, paragem/reconfiguração de serviços existentes ou alteração do runtime.

- Branch `feat/f13-organizational-profile`; HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`. Baseline: 2589 entradas no worktree, 30963 ficheiros.
- Imagem local `postgres:17`, executada pelo ID `sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`, sem resolução por tag durante o gate.
- Fontes: 1011 hashes conferidos; contexto Docker local `desktop-linux`, com identidade do daemon e ownership verificados pelo runner.
- Execução entre 00:10:26.684 e 00:10:36.124, hora de Lisboa (UTC nesta data); exit code 1.
- Preflight confirmou PostgreSQL 17 e isolamento READ COMMITTED. `createEnvironment` falhou antes de devolver um ambiente preparado; código sanitizado `GATE_FAILED`.
- Repositório: 0/14 cenários executados; autoridade: 0/9; capacidade: 0/52 tentativas e 0/26 aquecimentos. Nenhuma medição antes/depois disponível.
- O runner regista `containerRemoved:true`, `environmentClosed:false`, sem erros na remoção. Conferência posterior por ID completo e label devolveu zero contentores, com exit zero. A remoção foi solicitada com `--volumes`; não existe inventário independente dos volumes anónimos nesta evidência.

O campo `execution:NOT_RUN` é definido pelo runner até `createEnvironment` terminar; **não significa ausência de SQL nesta tentativa**: o preflight SQL foi executado e a preparação foi iniciada. A evidência não identifica até que migration/etapa o setup chegou. Qualquer SQL de preparação ficou confinado ao contentor próprio posteriormente removido.

O resultado `CLEANUP_NOT_PROVEN` foi preservado: o avaliador exige também `environmentClosed:true`, que não é preenchido quando o setup falha antes de devolver o ambiente. A remoção física do contentor está confirmada; não se converteu esse facto num PASS dos testes de cleanup de sessões/cursores, que não correram. A reavaliação offline da evidência e do manifest reproduziu FAIL.

## Achado e correção recomendada

| Prioridade | Ficheiro/linha | Evidência, impacto e causa | Correção e teste necessários |
| --- | --- | --- | --- |
| P2 | `test/integration/partner-portal/gate.js:152`, `environment.js:150` | O erro de setup foi reduzido a `GATE_FAILED`; não ficou fase nem classificação segura que permita diagnosticar a falha. O sanitizador conserva apenas códigos com formato estrito e o environment relança o erro original. A causa funcional do setup permanece desconhecida. | Acrescentar fase e classificação de erro por lista permitida, sem SQL, mensagem bruta, stack ou credenciais. Começar por regressão de falha de setup que prove diagnóstico seguro e cleanup. Só depois rever fontes e realizar uma nova tentativa, preservando esta. |

Não há evidência para atribuir a falha ao adaptador, a RLS ou à revogação. Não repetir apenas para procurar PASS nem reduzir os requisitos de evidência.

## Validação e preservação

Nenhum código foi corrigido ou teste adicionado neste incremento; alterados apenas este registo, os artefactos produzidos pelo runner e o estado documental em `context/features/partner-postgres-gate.md` e `context/current-work.md`. As suites/build não foram repetidas, porque não houve mudança de código. Última preparação validada: foco 152 PASS, backend 1490 PASS/0 FAIL/7 SKIP, frontend 346 PASS/build PASS; estes resultados são anteriores, não resultados desta execução PostgreSQL.

Fontes de migrations, grants, permissões e dados Dev preservados; operações SQL autorizadas apenas no contentor descartável. Sem commit, merge, push, deploy ou integração. A conferência de worktree consta de [verification.json](verification.json).

**Próximo passo:** corrigir a observabilidade segura da falha de setup com regressão primeiro, para identificar a causa antes de uma nova execução isolada.
