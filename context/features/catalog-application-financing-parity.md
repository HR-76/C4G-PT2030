# Catálogo C4G — candidaturas e financiamento / Review

Pedido autorizado: fechar as duas diferenças da lista/detalhe identificadas na revisão de 17/10/2026. Recuperar indicação das candidaturas da organização na lista e apresentar financiamento de forma coerente com o detalhe. Sem avançar para outro domínio.

## Critérios de conclusão

- Uma consulta privada limitada às oportunidades da página devolve apenas candidaturas que o utilizador pode consultar na organização ativa. Reutilizar APPLICATION_READ, OPPORTUNITY_READ, membership e isolamento atuais. O catálogo central não recebe dados de candidaturas.
- Lista mostra estado e ligação direta quando existe uma candidatura visível; várias apresentam contagem e estados; ausência só é afirmada após consulta autorizada completa. Erro/sem permissão permite repetir e nunca aparece como zero. Mudanças de organização, página e filtros descartam respostas antigas.
- Sem carregar todas as candidaturas da entidade no browser, nem um pedido por linha. Limitar IDs, linhas lidas e tempo; falhar explicitamente se não for possível completar a contagem autorizada.
- Lista e detalhe usam a mesma apresentação financeira: montante/moeda exatos quando registados; referência à descrição quando esta contém valores monetários ou percentagens; montante não identificado nos dados quando não existe evidência textual ou estruturada. As referências textuais não se tornam orçamento, máximo, taxa ou intervalo por inferência.
- A ligação para valores na descrição abre essa secção, mantendo os filtros da lista. Fonte oficial permanece disponível. Não recolher fontes nem escrever revisões para obter estes dados: ler a revisão já persistida.
- Preservar filtros por programa/prazos/datas, catálogo central, criação manual com revisão central exata, edição/arquivo privados e identidade C4G. Sem migrations, seeds, resets, Git mutável ou alterações de negócio na demonstração.
- Testes de autorização/limites/contagens e erros, apresentação financeira e respostas tardias; build, sintaxe e prova local A/B com a candidatura já existente.

## Critério para a adaptação seguinte

Produto e interface C4G, sem o nome da universidade como identidade do produto. Perfil da organização → departamentos/unidades → pessoas afetas à entidade. Reutilizar tabelas, serviços e percursos existentes, adaptando vínculos e permissões à organização; membership central continua a fonte de verdade do acesso. A estrutura organizacional não é implementada neste recorte. Não se presume que todas as pessoas registadas têm conta ou acesso à aplicação.

## Implementação e prova

As duas diferenças foram corrigidas: resumo privado de candidaturas para a página e apresentação financeira comum baseada na revisão persistida. [Evidência e limites](../reviews/catalog-application-financing-parity/README.md): 51 testes frontend, 44 testes backend distintos, sintaxe e build PASS; quatro detalhes e navegação/filtros, candidatura existente em A/recusada em B, montantes da fixture privada e larguras 1440/768/390 verificadas localmente. Não houve alteração de dados de negócio ou recolha externa.

Permanece registada uma intermitência de autoridade no recarregamento direto da lista privada (`AUTHORITY_WRITE_PENDING`), anterior à consulta SQL; a navegação normal e a leitura isolada passaram. Este recorte não corrige a coordenação de sessões nem declara validação de produção. A adaptação organizacional permanece apenas como critério seguinte.
