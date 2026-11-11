# Reporting

## Objetivo

Apoiar decisões operacionais e de gestão dentro de cada organização, usando histórico preservado e isolamento integral entre clientes.

## Dashboards do MVP

### Operacional

- oportunidades novas e por analisar;
- prazos próximos;
- candidaturas ativas por etapa;
- tarefas pendentes ou atrasadas;
- alertas e bloqueios.

### Gestão

- evolução e qualidade das oportunidades;
- qualificação e distribuição do matching;
- conversão em candidaturas;
- submissões, decisões e taxa de sucesso;
- financiamento solicitado, aprovado, investimento e cofinanciamento;
- participação por unidade, equipa, responsável e parceiro.

## Definições

- Conversão em candidatura = oportunidades qualificadas que originaram candidatura / oportunidades qualificadas.
- Taxa de sucesso = candidaturas aprovadas / candidaturas com decisão final.
- Financiamento aprovado usa o valor efetivamente concedido.
- Candidaturas sem decisão não contam como rejeitadas.

Cada indicador deve documentar fórmula, período, granularidade, filtros, tratamento de ausentes e versão da definição.

## Dimensões e permissões

Filtros do MVP: período, unidade, programa, estado e responsável. O modelo suporta ainda fonte, financiador, tema, território, tipologia, resultado, equipa e parceiro quando houver dados.

Consultas e exportações aplicam organização, perfil, unidades e participação. Administradores C4G não consultam detalhe de clientes sem autorização auditada.

## Atualização e exportação

- Operacional próximo do estado atual; gestão pode ter atualização periódica.
- Intervalos rápidos e personalizados; indicar última atualização.
- CSV/Excel para dados filtrados e PDF para resumos.
- Exportações incluem organização, filtros, período e data e são auditadas quando sensíveis.
- Totais são rastreáveis até aos registos de origem.

### Exportação do relatório de candidaturas

- A ação «Exportar candidaturas para Excel» descarrega `relatorio-candidaturas-c4g.xlsx` com todas as candidaturas acessíveis, incluindo as que estão nas páginas seguintes. O topo identifica a organização e a hora da consulta em Lisboa.
- A folha «Candidaturas» apresenta primeiro os dados de negócio, com o ID e a revisão no fim. Tem cabeçalhos com filtros, linhas alternadas, títulos longos com quebra de linha e painéis fixos para o cabeçalho e a coluna «Candidatura». Os prazos válidos são datas Excel e os orçamentos numéricos têm formato em euros.
- O servidor valida o identificador do relatório e as permissões atuais e regista a auditoria antes de entregar o ficheiro. Os textos são gravados como texto literal. Os orçamentos em EUR são numéricos dentro da precisão do Excel, ficam vazios quando ausentes e são gravados como texto quando necessário para preservar os cêntimos.

Relatórios personalizados, benchmarking e análises preditivas ficam fora do MVP.

## Direção visual dos dashboards

A direção visual usa `source-docs/brand/` como referência de mood e identidade, não como especificação final. As regras transversais estão em `context/references/ui-foundations.md` e a linguagem de navegação em `context/references/product-language-and-navigation.md`.

- usar superfícies neutras claras para conteúdo, com navegação escura em verde-petróleo ou azul escuro por confirmar;
- reservar o verde C4G para ação primária, foco e seleção, sem o usar como fundo dominante;
- separar visualmente a visão operacional, orientada a urgência e próxima ação, da visão de gestão, orientada a tendência e comparação;
- mostrar organização ativa, período, filtros aplicados e última atualização em ambas as visões;
- apresentar KPIs em cartões claros com valor, unidade, período, definição acessível e comparação quando aplicável;
- preservar cores semânticas próprias para sucesso, aviso, erro e informação; nenhum estado depende apenas da cor;
- usar uma paleta categórica acessível e provisória para gráficos, apoiada por rótulos, legendas, formas ou padrões;
- evitar fotografia, slogans e composições promocionais nas áreas analíticas;
- permitir drill-down de totais para registos de origem sem perder o contexto de filtros, respeitando as mesmas permissões;
- garantir que tabelas, gráficos e exportações usam os mesmos nomes e definições de indicadores.

## Estados e acessibilidade

- carregamento, ausência de dados, ausência de resultados, erro e acesso recusado têm mensagens e ações distintas;
- alertas e bloqueios indicam causa, impacto e próximo passo;
- tendências não usam apenas vermelho/verde ou apenas setas sem rótulo;
- gráficos devem ser compreensíveis por teclado e ter alternativa textual ou tabular adequada;
- contrastes, foco e paleta final devem cumprir o nível de acessibilidade aprovado pela C4G.

## Confirmações visuais necessárias

- cor escura principal da navegação: verde-petróleo ou azul escuro;
- paleta oficial da marca e conjunto de cores secundárias permitido em gráficos;
- família tipográfica e biblioteca de iconografia aprovadas;
- nível WCAG exigido e requisitos para impressão/PDF;
- preferência por gráficos estáticos, interativos ou ambos nas exportações e no produto.
