# Linguagem do produto e navegação

## Âmbito e origem

Esta referência traduz a identidade observada em `source-docs/brand/` para linguagem e navegação do produto SaaS. As imagens são referências de mood; textos, menus e layouts nelas presentes não definem a arquitetura de informação do produto.

## Princípios de linguagem

- escrever em português europeu, com frases curtas, concretas e orientadas à tarefa;
- adotar um tom profissional, claro, próximo e seguro, sem linguagem publicitária nas operações;
- usar termos do domínio confirmados: oportunidade, qualificação, matching, candidatura, tarefa, aprovação, documento e relatório;
- explicar decisões automáticas e cálculos em linguagem verificável;
- nomear ações pelo resultado: `Qualificar oportunidade`, `Criar candidatura`, `Exportar dados`;
- evitar anglicismos quando existir alternativa inequívoca; manter `matching` enquanto termo de produto confirmado e acompanhá-lo por explicação quando necessário;
- distinguir sempre catálogo central C4G, dados da organização e recursos privados;
- nunca apresentar uma inferência, recomendação ou correspondência como decisão confirmada.

## Tom por contexto

| Contexto | Tom |
| --- | --- |
| operação diária | direto, compacto e orientado à próxima ação |
| gestão e reporting | objetivo, comparável e explícito sobre período e universo |
| erro ou bloqueio | específico sobre causa, impacto e recuperação |
| ajuda e onboarding | pedagógico e progressivo, com iconografia linear ou imagem discreta |
| formação e comunicação | mais dinâmico e expressivo, sem contaminar os padrões operacionais |

## Navegação recomendada

A navegação global pode usar uma superfície escura em verde-petróleo ou azul escuro, sujeita a confirmação da C4G. A área de conteúdo permanece neutra. O verde vivo identifica ação primária e seleção; não preenche toda a navegação nem substitui cores semânticas.

Ordem inicial orientada aos quatro pilares do produto:

1. `Visão geral`
2. `Oportunidades`
3. `Matching e qualificação`
4. `Candidaturas`
5. `Reporting`

Áreas administrativas surgem separadas de tarefas operacionais:

- `Organização`: unidades, equipas, competências e prioridades;
- `Administração`: utilizadores, memberships, permissões e configurações autorizadas;
- `Plataforma C4G`: clientes, catálogo central, integrações e suporte auditado, apenas para administradores C4G.

O cabeçalho mostra a entidade da conta como contexto fixo, sem seletor. Uma conta operacional pertence a uma única entidade; os administradores C4G sem membership veem explicitamente o contexto de administração da plataforma.

## Padrões de rótulos e estados

- usar substantivos no singular para detalhe e no plural para coleções;
- reservar verbos para botões e comandos;
- preferir `Arquivar` a `Eliminar` quando o domínio exige preservação histórica;
- apresentar estado atual e próximo passo como conceitos distintos;
- acompanhar ícones por rótulos nas ações críticas ou pouco familiares;
- não reutilizar verde para significar simultaneamente seleção, sucesso e aprovação sem texto explícito;
- filtros ativos devem ser visíveis, resumíveis e removíveis; `Limpar filtros` não altera dados;
- ações destrutivas ou irreversíveis, quando existirem, não usam o estilo da ação primária C4G.

## Estrutura das páginas

- título e descrição curta do objetivo da página;
- organização ativa e breadcrumbs apenas quando ajudam a localizar o utilizador;
- ação primária única e ações secundárias menos salientes;
- filtros próximos dos resultados que controlam;
- conteúdo principal em cartões, tabelas ou gráficos sobre superfícies claras;
- estados de carregamento, vazio, sem resultados, erro e acesso recusado com explicação e próximo passo;
- ajuda contextual curta; conteúdos extensos de formação ficam fora do fluxo principal.

## Reporting e dashboards

- separar `Visão operacional` de `Visão de gestão` dentro de `Reporting`;
- tornar período, filtros, última atualização e âmbito organizacional visíveis;
- usar títulos que expressem a métrica, não nomes genéricos como `Gráfico 1`;
- apresentar fórmula ou definição acessível junto de indicadores que possam ser interpretados de formas diferentes;
- permitir passar do agregado aos registos de origem quando autorizado;
- manter a mesma linguagem entre dashboard, exportação e definição do indicador;
- não usar slogans, fotografia dominante ou grafismos de campanha nas superfícies analíticas.

## Confirmações necessárias da C4G

- `Reporting` permanece o nome de produto ou deve ser apresentado como `Relatórios e indicadores`?
- `Matching` é terminologia aprovada para todos os públicos ou requer uma designação portuguesa na interface?
- Qual deve ser o nome da página inicial: `Visão geral`, `Painel` ou outra designação?
- A navegação principal aprovada é verde-petróleo ou azul escuro?
- Existem glossário, tom de voz e regras de capitalização oficiais?
- Que conteúdos de ajuda, formação e notícias devem existir dentro da aplicação, se algum?
- A interface será apenas em português europeu no MVP ou deve nascer preparada para outros idiomas?
