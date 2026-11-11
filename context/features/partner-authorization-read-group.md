# Parceiros — leituras Central por decisão de autorização

28/10/2026 — Review. Correção pontual explicitamente autorizada após a sexta execução do gate. A implementação anterior abria uma transação de metadados para membership e outra para F5 em cada decisão fresca fora de prepare. O diagnóstico observou custo dominante nesse percurso; não demonstra ainda ganho PostgreSQL da correção.

## Contrato

Ativar apenas em `partnersBrowse`: agrupar as duas leituras Central brutas de uma decisão em `withAuthority`, preservando ordem, consultas, argumentos, curto-circuito, marcas privadas e validações de segurança do coordenador. Validar pedido/ator/operação antes de entrar no grupo. Nenhum dado é reutilizado entre decisões, recursos, pedidos ou organizações.

O novo grupo termina antes de aplicar `snapshotForResource`, consultar política tenant, avaliar e emitir/drenar auditoria F7. Não envolver a autorização inteira nem o scan num lock Central. Dentro de prepare já coordenado, reutilizar o contexto existente sem transação adicional ou alterar a proteção original. Esta fronteira nova é distinta dos grupos captura/resolve anteriormente aprovados.

Preservar resultados/códigos de recusa por fase, eventos/ordem de auditoria, fail-closed perante erro de leitura/COMMIT/deadline, cache existente e assert do guard nos hits. O prazo Central existente passa a cobrir as duas leituras adjacentes em conjunto; não aumentar timeouts, alterar SQL/migrations/grants ou prolongar a lease tenant. Restantes percursos mantêm o modo anterior por omissão; contratos HTTP inalterados.

## Aceitação e validação

Regressões primeiro: mesmo resultado/protocolo/auditoria; duas transações → uma por decisão fresca; membership recusada sem ler F5; falhas por fase/COMMIT/deadline; políticas e auditoria fora do grupo novo; revogação entre decisões; isolamento de organizações/concorrência; reentrância no prepare e guard obrigatório no hit. Comparar contagens de transações/comandos com doubles sem as apresentar como latência PostgreSQL.

Executar foco, suites backend/frontend, build e sintaxe; registar falhas preexistentes. Preservar seis execuções, pré-condição e worktree. Atualizar manifest corrente apenas para fontes efetivamente alteradas após revisão. Sem nova execução do gate PostgreSQL, integração do protótipo, deploy ou acesso Dev neste incremento.

## Resultado local

[Relatório e verificação](../reviews/partner-authorization-read-group/README.md): 12 casos adicionais, RED antes do código; foco 166 PASS, backend 1565 PASS/0 FAIL/7 SKIP preexistentes, frontend 346 PASS/build PASS e sintaxe de cinco ficheiros PASS. Com coordenador/protocolo/F5 reais e persistência/admission controladas: 2→1 transações e 14→8 comandos, mantendo duas queries de domínio, decisão e eventos iguais. Sem medição PostgreSQL; grupos usam o mesmo deadline, não acrescentam cancelamento da lease. Manifest de 1014 fontes atualizado apenas nos três módulos alterados.

## Efeito medido na sétima execução

[Resultado](../reviews/partner-portal-pg-fa1ecdc4e3305af458dc4fb67a96154a/README.md): tentativa única, FAIL e interrupção na primeira pendência em volume-10000/baseline. Comparação do warmup com a sexta: 223,88→141,99 ms por miss concluído, 3700→5800 linhas; ainda LEASE_TIMEOUT. Nas 20 medições pequenas comuns, média 1805,88→1936,85 ms; não demonstrada melhoria geral. Host não controlado e volumes grandes sem medições completas; nenhum ganho causal exclusivo ou aprovação produtiva inferido. Cleanup/remoção confirmados; seis execuções anteriores preservadas.

**Estado posterior:** [agregação do catálogo Central](../reviews/central-schema-catalog-batch/README.md) concluída localmente. Trabalho parado por pedido do utilizador, sem nova execução PostgreSQL ou otimização adicional.
