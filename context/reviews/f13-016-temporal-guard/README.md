# F13/016 — evidência da correção temporal, 2026-10-15

Resultado: **READY_FOR_HUMAN_REVIEW**, sem fecho humano. F13 integral permanece **In Progress**.

HEAD: `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; branch `feat/f13-organizational-profile`. Worktree com resíduos preexistentes, sem stage/commit/push/deploy. `tested-snapshot.json` contém SHA-256 de 671 ficheiros de código, testes, migrations, scripts, frontend e manifests de dependências. O snapshot foi conferido novamente após as execuções. `preexisting-snapshot.json` identifica os resíduos presentes antes da correção; o delta produtivo deste trabalho limita-se ao deadline e à validação pré-prepare em `authorityCoordinator.js`.

## Comandos e resultados

Comandos a partir da raiz, salvo `npm test`, executado em `backend/`. Todos os gates usam os seus wrappers PowerShell e recursos PostgreSQL 17 descartáveis próprios; cleanup pelos respetivos finally. Nenhuma credencial está guardada nestes artefactos.

| Comando | Resultado | Artefacto |
|---|---|---|
| `docker info --format '{{.ServerVersion}}'` | exit 0, 29.7.2, após indisponibilidade inicial | docker.txt |
| `node --test backend/test/f13EditorialApprovalDeadline.test.js backend/test/f5AuthorityCommitGuard.test.js backend/test/f42TenantLeaseExecutor.test.js backend/test/f12TenantOperationMatrix.test.js backend/test/f43TenantManifest.test.js backend/test/f13EditorialMaterial.test.js backend/test/f13EditorialRelease.test.js backend/test/productionCompositionParity.test.js` | exit 0, 110/110 PASS | focused.txt |
| `npm test` | exit 0, 761/761 PASS, zero skips | backend-suite.txt |
| `powershell -NoProfile -File test/integration/f13/editorial-gate.ps1` | exit 0, quatro cenários temporais + security/recovery + HTTP A/B PASS | editorial-gate.txt |
| `powershell -NoProfile -File test/integration/f13/migration-gate.ps1` | exit 0, F13/Central, 47 ACL drifts, duas warm, seis corridas, recovery PASS | f13-coordinator.txt |
| `powershell -NoProfile -File test/integration/f13p1/migration-gate.ps1` | exit 0, PASS | f13p1.txt |
| `powershell -NoProfile -File test/integration/f12/migration-gate.ps1` | exit 0, cumulativo 16 entradas e F9 PostgreSQL 3/3 PASS | f12-cumulative.txt |
| `powershell -NoProfile -File test/integration/f12-import/migration-gate.ps1` | exit 0, asserts 014→015→014 PASS; script silencioso | f12-import-migration.txt |
| `powershell -NoProfile -File test/integration/f12-import/functional-gate.ps1` | exit 0, F12_IMPORT_ENTRYPOINT_CENTRAL_AB PASS | f12-import-functional.txt |
| `powershell -NoProfile -File test/integration/ubi/private-opportunity-gate.ps1` | exit 0, HTTP/Chrome, cadeia cumulativa até 016 e 29 drifts PASS | ubi-gate.txt |
| `node --check` em cada um dos sete JS do recorte | 7/7 PASS | syntax.txt |
| `git diff --check` nos ficheiros tracked do recorte + scan de whitespace dos sete JS | PASS | whitespace.txt |

Os sete JS são o coordenador, `backend/test/f13EditorialApprovalDeadline.test.js`, e `test/integration/f13/{central-authority-fixture,runtime-fixture,editorial-gate,editorial-probes,editorial-temporal-probes}.js`. Os clocks/expiração opcionais das fixtures conservam os defaults dos outros gates. A suite backend final foi executada depois destas alterações.

## Prova temporal e ausência de efeitos

O coordenador e executor F4 reais são usados nos 19 testes novos, com doubles de Central/F3/F5/persistência expressamente identificados. O gate adicional usa Central e tenant PostgreSQL reais, aprovação persistida por A e publicação por B. Um relógio aplicacional partilhado é avançado deterministicamente depois dos INSERTs e seals, antes do assert final. Não há sleep para produzir a corrida.

- `EXACT` e `AFTER`: recusa em `validUntil` e `validUntil+1`; guard ABORTED; zero publicação da versão e contagens de publicação, idempotência e evento funcional inalteradas; epochs iguais antes/depois.
- `ALREADY-EXPIRED`: recusa F13_APPROVAL_STALE sem criar guard ou efeitos.
- `VALID`: publicação permitida 1 ms antes; guard TENANT_COMMITTED e exatamente um novo registo em cada contagem.
- Unitários adicionais: limites de sessão/MFA/lease/transação mais restritivos, operações sem approvalEvidence, null explícito e valores omitidos/inválidos.

Teste de sensibilidade (`deadline-mutation.txt`): execução `node` via stdin, carregando com `Module._compile` uma cópia **apenas em memória** do coordenador em que `identity.expiresAt,approvalDeadline,` é substituído por `identity.expiresAt,`, seguida de `require('./backend/test/f13EditorialApprovalDeadline.test.js')`. Resultado esperado: exit 1, 17 PASS e 2 FAIL, exclusivamente nos casos exact/after. Nenhum ficheiro produtivo foi revertido para executar a mutação.

## Fingerprints

- Tenant 016 observado em A e B: `bc47c3c859f9790136b70dc40d1159978f2f30ce80ffb124ec6522b546a6ea5a`.
- Down vazio reconfirma igualdade exata ao pin 015: `8c96af15c713ba36658d462e348ff3b69324042cd163bf426bb9b55353bec5ac`.
- Autoridade Central observada: `9e975a00c3f11a6a4b7995c954d3cb437407751b10d35789a597acd69b0e6581`.
- Up/down 016 não alterados: `18365bce636ff77a257b55724545711db33b12520d6b34e0f613c1a256b6331d` / `b3ed12fac21708f16bdb8d66a23f9d08d2f301dd3b313125f46bb1b785e5b87c`.

## Revisão e limites

Revisão read-only do delta e da prova temporal sem findings materiais remanescentes. O guard só é encurtado; validação interna e assert final permanecem. Nenhuma alteração em SQL, pins, protocolo de autorização, recovery ou UI.

Provas locais e sintéticas; clock aplicacional controlado no cenário temporal, PostgreSQL real para rollback/persistência. Não validam IdP externo, staging, produção, dados UBI reais ou SLO. Sem fecho humano nem promoção de F13 integral. O índice permaneceu vazio. O frontend residual foi exercitado pelo gate UBI, sem implementação de UI editorial.
