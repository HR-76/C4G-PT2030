# Robustez das esperas de rede nos testes
Estado: Complete
Implementação e validação do âmbito concluídas em 2026-11-06. As suites globais têm falhas externas descritas abaixo.

## Âmbito aprovado
Sete ficheiros de testes backend e auxiliar partilhado; sem alterações de código de produção, dependências ou configuração de execução.
Ficheiros: dashboardLoadingObserver, dashboardTenantCostObserver, reportAuthorityObserver, documentDownloadNavigation, f11RealTransportAdapters, launcherDrain e serverLifecycle.

## Implementação
- Auxiliar test/support/networkWait.js: espera pelo evento em simultâneo com a conclusão/falha da operação; erros identificam a fase e preservam a causa/código.
- Evento ausente: prazo de 5 s por omissão. Conclusão prematura: TEST_OPERATION_ENDED. Cancelamento: TEST_WAIT_ABORTED.
- Corpo dos testes abrangidos limitado a 10 s; proteção adicional do runner de 15 s. Limpeza independente, em ordem inversa, com prazo de 2 s por recurso.
- Limpeza tenta todos os recursos mesmo que uma operação de limpeza falhe; AggregateError conserva o erro original e as falhas de limpeza.
- Servidores e sockets registados antes das esperas; pedidos de saída destruídos na limpeza; bloqueios artificiais libertados e observers restaurados. O cenário normal mantém as verificações de encerramento da aplicação.
- Não se usa process.exit nem force-exit para esconder recursos pendentes. Erros de rede inesperados continuam a fazer os testes falhar.
- Regressões em networkWait.test.js: ECONNREFUSED/EACCES, evento ausente, conclusão prematura, rejeição tardia observada, cancelamento e limpeza parcial/com prazo excedido.
- Regressão em processos filhos injeta recusas num agente HTTP de teste e confirma saída natural com código 1, preservando a fase/código e libertando um servidor aberto. O limite externo de 8 s apenas deteta bloqueios; não foi atingido.

## Validação
- Regressão adicionada antes do auxiliar: falha inicial por módulo inexistente registada em .tmp/network-wait-before.log.
- Auxiliar: 7 PASS.
- Sete ficheiros mais regressões do auxiliar, com rede local permitida: 68 PASS, 0 FAIL/0 SKIP/0 cancelados, 0,63 s. Evidência: .tmp/network-wait-focused-final.log.
- Mesmos ficheiros sob restrição real de rede: 37 PASS, 31 FAIL esperados por recusa de rede, 0 cancelados, término natural com código 1 em 0,77 s. Nenhum teste ignorado ou processo forçado. Evidência: .tmp/network-wait-denied-final.log.
- Ajuste final para destruir explicitamente pedidos de saída: 18/18 testes dos dois ficheiros de lifecycle/drain PASS. Evidência: .tmp/network-wait-outbound-cleanup.log.
- node --check: sete ficheiros, auxiliar e regressões PASS.
- Backend completo (npm test, com rede local permitida): 2695 testes, 2666 PASS, 22 FAIL, 7 SKIP, 0 cancelados, 51,76 s. A suite terminou normalmente, sem timeout global acrescentado. Evidência: .tmp/network-wait-backend-full.log.
- Frontend completo: 783 PASS, 18 FAIL, 90 ficheiros. Evidência: .tmp/network-wait-frontend-full.log.
- Build frontend: PASS. Evidência: .tmp/network-wait-build.log.
- Após o ajuste final de limpeza, repetiram-se os dois ficheiros afetados; os resultados globais acima correspondem à execução imediatamente anterior a esse ajuste.

## Falhas externas ao âmbito
- Backend: as 22 falhas reportam F13 productive authorization catalog is invalid, diretamente ou como erro inesperado na asserção de paridade de composição. Origem reportada: src/authorization/productionAuthorization.js:33. Os testes afetados não usam o novo auxiliar.
- Frontend: 18 falhas em C4gShell.test.jsx porque o mock de ../api/api não exporta customerBillingApi, agora usado por Layout/Sidebar.jsx:20.
- Existem alterações concorrentes nessas áreas do workspace. Não se fez rollback, não se estabeleceu um baseline histórico equivalente e não se alteraram esses ficheiros.
- A validação focada confirma o âmbito desta tarefa; os resultados globais não são apresentados como PASS. Correções de autorização e do mock de faturação ficam fora desta tarefa.
