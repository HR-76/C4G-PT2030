# Filtros do Catálogo — recuperação UBI

State: Complete

Pedido autorizado: completar os filtros em falta no Catálogo, aproveitando a UBI, preservando fontes oficiais e melhorando UI/UX. A validação integrada da importação/R2 fica adiada por decisão do utilizador; não integra esta entrega.

## Evidência e âmbito

UBI: `frontend/src/pages/Opportunities/OpportunitiesList.jsx` e `utils/sourceUi.js` têm filtro Fonte e persistência na URL. C4G: `/catalogo` usa `CentralOpportunities` e `fundingTenders/repository.list`; o leitor adicional `/catalogo/consulta` já tem source. O filtro em falta é Fonte no percurso comum (RF-02). Pessoas/áreas temáticas são outra componente.

Usar namespaces canónicos existentes: EU Funding & Tenders, Portugal 2030 plano/aviso, Interreg Europe, POCTEP e manual C4G. Não copiar códigos legados incompatíveis, nem inferir CORDIS/Erasmus a partir do título/programa. Registos com múltiplas fontes correspondem a cada fonte efetivamente registada.

## Aceitação

- Fonte única, Todas as fontes por omissão; código inválido recusado no servidor.
- Combinação por E com pesquisa/programa/área/estado/datas antes da paginação; reutilizar varrimento limitado existente quando necessário, sem omissões ou duplicações.
- URL, atualização, paginação e regresso da ficha preservam a fonte. Aplicar/limpar/remover filtro reinicia cursor.
- UI apresenta seleção aplicada, possibilidade de remover fonte e mensagem específica para filtros inválidos. Alterar estado não apaga datas.
- Administração C4G e entidades usam o mesmo comportamento público e respetiva autorização existente.
- Exportar página mantém apenas resultados carregados; links oficiais e dados de origem não são alterados.
- Testes backend e frontend focados, suites completas, sintaxe e build. Sem migrations, serviços externos ou deploy.

## Resultado e revisão

Implementado o seletor Fonte no Catálogo comum, usando códigos canónicos e labels C4G compatíveis com a UBI. A condição SQL parametrizada é aplicada antes de LIMIT, combinada por E com os restantes filtros; EXISTS permite múltiplas fontes sem multiplicar linhas. O processamento mantém a verificação canónica e o varrimento limitado existente para áreas.

A seleção persiste na URL, na paginação e no regresso da ficha. O utilizador pode remover a fonte isoladamente, ver alterações por aplicar e recuperar de um filtro inválido. Alterar estado preserva datas. Grelha local de filtros: três colunas no desktop, duas em largura intermédia, uma em móvel. Consulta oficial e exportação da página mantidas.

Revisão focada: pronta a fechar. Sem alterações de autorização, esquema, dados, importação ou deploy. A diferença de códigos UBI/C4G foi respeitada: CORDIS e Erasmus não são inferidos como namespaces distintos a partir dos títulos.

## Validação

- Regressão inicial: teste de fonte falhou com INVALID_INPUT antes da implementação.
- Backend final: 2.575 PASS, 7 SKIP, zero falhas (2.582 testes); sintaxe aprovada. Testes específicos cobrem SQL parametrizado, códigos inválidos, combinação com área, várias fontes, paginação e links preservados.
- Frontend: 642 PASS; build PASS. Após o ajuste de grelha, repetidos os 32 testes focados e o build, ambos PASS.
- Chrome com API simulada: 1440px e 390px, aplicar/atualizar/remover fonte, sem overflow horizontal; capturas inspecionadas. Não é prova contra PostgreSQL real nem autenticação real, não executados neste incremento.
- Evidências: `output/catalog-source-backend-final.log`, `output/catalog-source-frontend.log`, `output/catalog-source-frontend-focused.log`, `output/catalog-source-build.log`, `output/playwright/catalog-source/verification.json` e capturas no mesmo diretório.

Próximo passo: recuperar o filtro por área temática na lista de pessoas da organização (RF-03), mantendo o isolamento de cada cliente.
