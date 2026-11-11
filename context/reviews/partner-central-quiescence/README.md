# Interrupção do gate perante trabalho Central pendente

28/10/2026 — correção pontual implementada e validada localmente. Sem execução PostgreSQL neste incremento.

## Problema corrigido

P2, `test/integration/partner-portal/capacityProbe.js:185`: um cleanup tenant com duração finita permitia continuar a carga e arquivar a fixture apesar de spans Central/reader/autorização pendentes. A quinta execução demonstrou essa limitação; as suas evidências mantêm-se intactas.

O guard existente recusa agora qualquer span pendente no snapshot `afterCleanup`, mesmo quando o diagnóstico é INVALID. Conserva a amostra, o `LEASE_TIMEOUT` original, os códigos `CAPACITY_CLEANUP_UNCONFIRMED`/`CAPACITY_FIXTURE_ARCHIVE_DEFERRED` e marca o cenário INCOMPLETE. Não executa outra variante, par ou cenário nem arquiva a fixture afetada. O runner mantém o fecho exterior do environment e a remoção do contentor. Nenhum timeout, contrato HTTP, regra de autorização ou runtime foi alterado.

## Regressões e validação

- Cinco regressões do collector: pendência no primeiro/segundo aquecimento e primeira/segunda medição; relógio inválido com pendência. Verificam erro original, snapshot, interrupção, ausência de arquivo e reposição dos hooks. Os controlos existentes cobrem timeout já terminado e relógio inválido sem pendências.
- Uma regressão do runner real com collector real e infraestrutura em memória: fecho do environment, remoção/ausência sintética e veredito FAIL após adiamento da fixture. Não executa Docker ou SQL real.
- RED antes da correção: o collector prosseguia até 78 operações; esperado 31–34 consoante o ponto de falha. O runner também reproduziu 78 em vez de 31. GREEN: seis regressões aprovadas; a fixture afetada não é arquivada e as cinco anteriores são arquivadas.
- Foco: `node --test --test-isolation=none` nos testes `partnerPortalCapacityProbe`, `partnerPortalCleanupGate`, `partnerTemporalDiagnostic`, `partnerPortalCapacityGate` e `partnerPostgresGate`: **68 PASS**.
- Backend `npm test`: **1553 PASS, 0 FAIL, 7 SKIP preexistentes**. Frontend `npm test`: **346 PASS em 55 ficheiros**; `npm run build`: **PASS**. Sintaxe dos três JavaScript alterados: PASS. Revisão independente: sem bloqueios.
- O sandbox recusou inicialmente o spawn do Node com EPERM; não foi uma falha funcional. Foco executado sem isolamento de processos; suites completas executadas com os comandos normais após escalada. Avisos jsdom de navegação e erro sintético de chunk continuam presentes, sem testes falhados. Não foram corrigidos neste incremento.

## Ficheiros e preservação

Alterados: `test/integration/partner-portal/capacityProbe.js`, manifest corrente `sources.json`, respetivo runbook, `backend/test/partnerPortalCapacityProbe.test.js`, contrato `context/features/partner-postgres-gate.md` e estado `context/current-work.md`. Adicionados: `backend/test/partnerPortalCleanupGate.test.js` e este relatório/verificação. O build pode regenerar os seus artefactos locais; não há publicação.

Baseline: branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, 2634 entradas no worktree e 31008 ficheiros. [Verificação de preservação](verification.json) regista hashes e diferenças. Manifest corrente conserva 1014 fontes, alterando apenas o hash do collector. As cinco execuções anteriores e a pré-condição não são reescritas.

Runtime/protótipo, migrations/grants/permissões e dados Dev preservados; nenhuma ligação a bases, execução de infraestrutura, commit, merge, push ou deploy.

## Limites e próximo passo

78→31–34 é uma contagem funcional com doubles, não uma medição de desempenho PostgreSQL. A instrumentação temporal continua nos três cenários definidos; esta correção não prova quiescência Central nos restantes. A lentidão da autorização e a capacidade produtiva permanecem por resolver; integração não autorizada por estes testes.

**Próximo passo:** validar o gate corrigido numa execução isolada, interrompendo na primeira pendência Central.
