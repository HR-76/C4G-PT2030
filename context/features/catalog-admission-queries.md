# GCNI — consultas de admissão do esquema e permissões
Estado: Review. Pedido explícito de 01/11/2026. Sem promoção ou reativação de fontes.

## Critérios
1. Comparar as consultas atuais com variantes em PostgreSQL isolado, conservando baseline imutável e evidências de tempo e equivalência.
2. Preservar exatamente os metadados, ordenação, valores de referência, rejeição de alterações indevidas, identidades, permissões e validação por pedido. Sem cache de admissões ou decisões; locks e ledger mantidos.
3. Regressão antes da correção e provas reais de equivalência e casos adversos. Suites completas backend/frontend, compilação e gate PostgreSQL.
4. Carga final OIDC local: 27/10000 oportunidades, tabela/ficha,10 concorrentes,5 séries de10,10 aquecimentos/cenário. Pools de catálogo e membership com2 ligações. Zero erros e p95<=500ms por série; não alterar a meta.
5. Autorrevisão, integridade das alterações, limpeza própria e exposição OFF. Desempenho acima da meta permanece por aprovar.

Próximo passo: reduzir o custo de execução das verificações do catálogo PostgreSQL, com comparação controlada antes/depois e a mesma validação por pedido, e repetir a carga isolada.

## Opção selecionada
Transporte compacto de linhas do catálogo e definições de funções sem repetição. Reconstrução byte a byte antes dos hashes originais; nenhuma alteração dos valores de referência, migrações ou grants. Só o percurso isolado usa a opção; por omissão o coletor mantém o formato anterior. As variantes de SQL e resumos criptográficos sem ganho consistente não foram aplicadas ao serviço.

## Resultado
Funcional PASS; carga NOT_ACCEPTED. [Resultado e autorrevisão](../history/catalog-admission-queries-2026-11-01.md).
