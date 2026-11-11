# Auditoria e finalização Central sob C4

Estado: execução autorizada para ensaio sintético isolado. Implementação atual congelada da última H (Central043/tenant034); a arquitetura multi-instituição e a membership Central continuam fonte de verdade.

## Objetivo

Identificar no C4 da versão medida os processos que bloqueiam `audit.prepare_append_v1`, reduzir uma causa demonstrada da latência sem enfraquecer auditoria ou autoridade, validar em A/B e repetir H integral.

## Critérios de aceitação

1. O diagnóstico usa as fontes congeladas e imagens pinadas da última H, infraestrutura sintética própria, OIDC/HTTP real, mesmos limites de operação/lease e um C4 completo sem reexecutar até obter sucesso. Relaciona PID de espera, PID bloqueador, estado/idade da transação e pedido sintético, sem persistir SQL bruto, parâmetros, IDs de negócio ou segredos. Verifica a limpeza e a integridade das fontes.
2. A alteração só segue de uma causa medida. Conserva a cadeia de auditoria, idempotência e append na mesma transação, membership Central, snapshots frescos, revalidação após lock/auditoria, limites e guard de COMMIT. Não aumenta prazos ou pools.
3. Regressão automatizada RED→GREEN e prova PostgreSQL isolada para auditoria, drift, autoridade após lock e falha fechada. `node --check`, testes focados, suites backend/frontend e build antes da carga. Falhas preexistentes separadas.
4. A/B usa versões, fixtures e protocolo fixados, com verificações funcionais e resultados de cauda preservados. Se houver erro HTTP, o resultado é FAIL, sem repetição para o esconder.
5. Só depois de prontidão HTTP e A/B íntegros, H executa oito braços AB/BA/AB/BA, 288 tentativas, 56 aquecimentos e 136 controlos. Qualquer 503, perda de auditoria/autoridade, drift ou cleanup reprova. A análise compara latência e retenção do lock sem tratar spans sobrepostos como parcelas aditivas.

Sem commit, deploy ou acesso a bases habituais.
