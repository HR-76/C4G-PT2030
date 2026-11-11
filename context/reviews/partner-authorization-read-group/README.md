# Parceiros — redução de transações Central por decisão

28/10/2026 — implementado e validado localmente, antes de nova execução PostgreSQL. [Contrato](../../features/partner-authorization-read-group.md), [verificação](verification.json).

## Correção

P2: cada decisão fresca em partnersBrowse fazia as consultas de membership e F5 em transações Central separadas, repetindo admissão, segurança e protocolo. As quinta/sexta execuções localizaram custo dominante nas autorizações sem cache. A correção agrupa apenas essas duas leituras brutas, após validar pedido/ator/operação, e fecha a transação antes da política tenant, avaliação e auditoria F7. Não há cache novo nem reutilização de snapshots entre decisões.

- `backend/src/authorization/authorizationService.js:47`: fronteira interna opcional das leituras, curto-circuito e códigos por fase preservados. Falha de COMMIT/deadline recusa antes de política tenant ou evento ALLOW.
- `backend/src/authorization/resourceAuthorization.js:24`: separa o snapshot bruto da aplicação de snapshotForResource, mantendo o mesmo tratamento de erro e os ports privados.
- `backend/src/applications/composition.js:58`: ativa o grupo apenas em partnersBrowse; restantes métodos mantêm o modo anterior. Dentro de prepare já coordenado não abre transação adicional. Cache existente continua a validar o guard nos hits; drain de auditoria mantém a recusa antes de devolver/cachear resultado.

Sem alteração de SQL, contratos HTTP, permissões, catálogos, regras de decisão, esquema ou deadline. A arquitetura futura não foi alterada; o adaptador SQL continua separado do runtime ativo.

## Testes e medições

Regressões adicionadas antes do código. Novo ficheiro com 11 testes: RED 10 FAIL/1 controlo PASS; teste de composição: RED em partnersBrowse, controlo browse PASS. GREEN após correção. Total de 12 casos adicionais à suite, incluindo o novo controlo de outro método; o teste existente de cache foi reforçado.

Cobertura: resultado/eventos/protocolo equivalentes; membership recusada sem ler F5; erros de membership/policy; COMMIT/deadline; revogação de membership/grants entre decisões; organizações concorrentes; reentrância; validação inicial; política tenant/F7 fora do grupo novo; guard nos hits e falha do drain de auditoria interrompendo antes do hit seguinte.

| Medição controlada por decisão fresca | Antes | Depois |
| --- | ---: | ---: |
| Transações Central | 2 | 1 |
| Comandos observados no cliente | 14 | 8 |
| Queries de domínio membership/F5 | 2 | 2 |
| Eventos de autorização | 1 | 1 |

Coordenador, protocolo fechado, repositório F5 e autorizador reais; persistência e verificações de esquema/admissão controladas. A contagem de comandos exclui o SQL dessas verificações substituídas no teste. Não é medição de latência PostgreSQL, projeção do total produtivo ou garantia de cumprir a lease de 10 s.

- Foco: **166 PASS/0 FAIL**, cobrindo F5/guard, grupos anteriores, metadados, contratos HTTP/paginação, parceiros, protocolo/autoridade/equivalência do portal e diagnóstico temporal.
- Backend `npm test`: **1565 PASS/0 FAIL/7 SKIP preexistentes**. Frontend `npm test`: **346 PASS em 55 ficheiros**. `npm run build`: **PASS**. `node --check`: **cinco ficheiros PASS**.
- Revisão independente sem bloqueios. Avisos jsdom de navegação e falha sintética de chunk continuam presentes; nenhuma falha de teste preexistente observada. As suites normais executaram fora do sandbox para permitir processos filhos, sem execução do gate ou acesso a Dev.

## Ficheiros e preservação

Modificados os três módulos acima, `backend/test/partnerTemporalDiagnostic.test.js`, manifest/runbook de `test/integration/partner-portal/`, `context/current-work.md` e `context/features/partner-postgres-gate.md`. Adicionados `backend/test/partnerAuthorityReadGroup.test.js`, o contrato e este relatório/verificação. Manifest corrente: 1014 fontes, apenas os três hashes de runtime revistos; manifests arquivados intactos.

Baseline: branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, 2641 entradas no worktree e 31015 ficheiros. As seis execuções, pré-condição e correção anterior permanecem intactas. O build regenera artefactos locais; nenhuma publicação.

**Migrations, grants, permissões e dados Dev não alterados.** Sem Docker/PostgreSQL, deploy, commit, merge ou push neste incremento. A alteração de runtime fica limitada ao agrupamento autorizado; o protótipo SQL não foi integrado.

## Riscos pendentes

O mesmo deadline Central cobre agora ambas as leituras: é mais restritivo que dois budgets independentes e não acrescenta cancelamento à lease. Falhas mantêm recusa/rollback e o gate conserva interrupção na primeira pendência. Concorrência PostgreSQL real, efeito em latência e capacidade ainda precisam da execução isolada; nenhuma aprovação produtiva inferida destes testes.

**Próximo passo:** uma execução isolada do gate para medir o efeito, mantendo os limites e a interrupção na primeira pendência Central.
