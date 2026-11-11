# Unidades diretamente associadas à organização cliente
Estado: Complete
Pedido aprovado em 2026-11-06.
Validação encerrada por indicação do utilizador em 2026-11-06.

## Critérios de aceitação
- Retirar coluna e ação de mudança da unidade superior.
- Criar unidades exclusivamente na raiz da organização ativa, resolvida no servidor.
- Recusar criação de subunidades e mudanças de unidade superior na API do diretório.
- Preservar registos, vínculos, identificadores e hierarquias históricas; sem migração.
- Conservar consulta e renomeação de unidades existentes.
- Validar contratos, interface, suites e build.

## Verificação inicial
Consulta SQL numa transação READ ONLY à base local c4g_tenant_dev: 3 unidades, 0 subunidades (incluindo arquivadas). Não foram consultadas bases remotas.

## Implementação e validação
- Interface sem coluna, botão ou seletor de unidade superior. Criação envia parentScopeId=null; a organização continua a ser resolvida pelo contexto autenticado no servidor.
- Contrato do diretório recusa pais não nulos na criação e todas as operações unitMove. API e funções de baixo nível conservadas para compatibilidade histórica; não foi alterada a persistência.
- Hierarquias antigas continuam consultáveis, com vínculos e renomeação preservados. Nenhum UPDATE, DELETE ou migração executado.
- Regressão backend observada a falhar antes da implementação; após alteração: 7/7 backend e 22/22 frontend PASS. Build PASS; node --check PASS.
- Suite frontend completa final: 797 PASS, 0 FAIL, 89 ficheiros; duração 28,85 s. Comando: `npm test` em `frontend/`. Evidência: `.tmp/unit-root-frontend-confirm.log`.
- Suite backend completa final: 2679 testes, 2672 PASS, 7 SKIP, 0 FAIL e 0 cancelados; duração 69,53 s. Comando: `node --test --test-timeout=30000 --test-reporter=tap test/**/*.test.js` em `backend/`, fora da restrição de rede para permitir os servidores locais dos testes. Evidência: `.tmp/unit-root-backend-confirm.log`.
- Cenários de integração ajustados à nova regra, mas não executados (requerem infraestrutura isolada).
- Logs locais: .tmp/unit-root-*.log.

## Diagnóstico das execuções anteriores
- A primeira suite frontend registou 782 PASS e 14 FAIL em 7 ficheiros de dashboard, routing e oportunidades. Esses ficheiros foram alterados por trabalho concorrente após essa execução; não foi estabelecido um baseline histórico equivalente. A repetição focada passou 78 testes e a suite final passou integralmente com a alteração das unidades presente.
- As falhas HTTP do backend foram reproduzidas como `fetch failed`, com causa `EACCES`, incluindo num servidor local mínimo. Os mesmos 18 testes HTTP passaram fora da restrição de rede.
- O bloqueio resultava de testes que aguardavam um sinal de entrada no servidor sem tratar a falha da ligação. Exemplo: `backend/test/dashboardLoadingObserver.test.js:155` aguardava `entry`, que nunca era resolvida quando o pedido era recusado. A execução final sem essa restrição terminou normalmente.
- Não foi encontrada relação causal com a alteração das unidades. A análise não introduziu correções de código.

## Encerramento e trabalho separado
- Alteração e validação encerradas; dados existentes preservados, sem migração ou deployment.
- Robustez dos testes perante ligações recusadas fica para uma tarefa separada, conforme decisão do utilizador: limitar esperas de sincronização, propagar erros de ligação e garantir encerramento dos recursos. Não implementada neste âmbito.
