# Filtros do Catálogo — recuperação UBI
State: Complete
Data: 2026-11-02

Feature: [Filtros do Catálogo](../features/catalog-source-filters.md).

Entregue filtro Fonte no percurso comum, combinação no servidor antes da paginação, persistência URL/ficha, recuperação de seleção inválida, remoção individual e grelha responsiva. Preservados links oficiais, exportação da página e autorização.

Validação: backend 2575 PASS/7 SKIP/0 FAIL; frontend 642 PASS; 32 testes focados finais, sintaxe e build PASS. Chrome desktop/móvel com API simulada PASS. Não foi executada prova SQL contra PostgreSQL real neste incremento.

Importação/R2 operacional continua adiada por decisão explícita do utilizador; ver feature própria. Sem deploy ou operações Git.

Próximo passo: filtro por área temática na lista de pessoas da organização (RF-03).
