# Fundações visuais, shell e cabeçalhos de página (Metronic 9.5 Demo 1)

Estado: In Progress. Pedido do utilizador em 10/11/2026, na sequência das [superfícies comuns](metronic-shared-surfaces.md).

## Problema
Cada página afinou tamanhos, raios e separadores em separado. Títulos de página variam entre 22 e 32 px, botões entre 34 e 42 px, existem três estilos de separadores e cartões com raios e títulos diferentes.

## Âmbito
Apenas apresentação no frontend. Sem alterações a dados, ações, permissões, rotas, contratos HTTP ou backend.

1. **Fundações** — escala única em `frontend/src/c4g-foundations.css`: texto 12/13/14/16/20 px, controlos de 34 px (44 px em ecrãs táteis estreitos), raio 6 px em controlos e 12 px em cartões, sombra leve de cartão.
2. **Shell** — sidebar a 280 px, barra superior a 70 px, grupos da navegação em maiúsculas discretas, conteúdo com largura máxima de 1280 px centrada.
3. **Cabeçalho de página e separadores** — título de página único (20 px, peso 600) e um só estilo de separadores sublinhados nas navegações de página (Dashboard, Perfil da organização, Candidaturas/Interesses, Entidades/Utilizadores).

## Critérios de aceitação
- Todos os `h1` da área de conteúdo usam o mesmo tamanho e peso.
- Botões `.btn`, campos de texto e seleções da área de conteúdo partilham altura mínima, raio e tamanho de letra.
- Os quatro separadores de página têm a mesma apresentação; o item ativo distingue-se por cor e sublinhado, e mantém `aria-current`/`aria-pressed`.
- Cartões partilhados usam raio de 12 px e a mesma sombra; tabelas dentro de cartões não duplicam sombra.
- Paleta petróleo, fontes do sistema e foco visível preservados; contraste WCAG 2.2 AA mantido.
- Suite frontend e build passam. Verificação no navegador a 1440 e 390 px sem transbordo horizontal.

## Fora de âmbito (decisões pendentes do utilizador)
- Cor do botão de criação (verde, [hierarquia de botões](button-color-hierarchy.md)) e do atalho lima do catálogo.
- Tom da borda dos campos.
- Remoção do utilizador/“Sair” duplicados no rodapé da sidebar (coberto por `SidebarProfile.test.jsx`).
- Tabelas (colunas das Candidaturas), mosaicos do Dashboard e passagem página a página: entregas seguintes.

## Validação (10/11/2026)
- Frontend: 870 testes / 101 ficheiros PASS; build Vite PASS.
- Navegador, conta da entidade, 11 páginas a 1440 e 390 px (Dashboard, Candidaturas, Catálogo, Perfil da organização, Pessoas, Parceiros, Alertas, Matching, Acessos, Perfil pessoal, Segurança, Faturação): todos os `h1` a 20 px/600, botões a 34 px (44 px a 390 px), separadores a 40 px, cartões com raio 12 px, sidebar 280 px, topo 70 px, sem transbordo horizontal.
- Não verificado: páginas da Administração C4G (incluindo os separadores Entidades/Utilizadores), diálogos, fichas de detalhe e estados com dados diferentes.

## Continuação: tabela das Candidaturas e Dashboard (10/11/2026)
- **Candidaturas** (≥ 769 px): colunas com largura fixa, células a 13 px com espaçamento de 10 px, datas sem quebra, estado como etiqueta compacta, cabeçalhos a 13 px/500. A tabela cabe em 1104 px sem deslocamento horizontal. Cartões móveis inalterados.
- **Dashboard, vista Gráficos**: nova faixa “Indicadores principais” com quatro mosaicos (Candidaturas acessíveis, Oportunidades abertas, Fecham em 14 dias, Orçamento global aprovado). Reutilizam os valores, definições e ligações da vista Indicadores operacionais; não há dados novos. Grelha de gráficos com espaçamento de 20 px e cartões alinhados no topo.
- Cabeçalhos de `.data-table` a 13 px/500 em toda a área de conteúdo.
- Validação: 871 testes / 101 ficheiros PASS (um teste novo para os mosaicos); build PASS; `test/integration/dashboard/responsive-css.cjs` PASS. Navegador a 1440 px: linhas de 60 a 115 px (antes 78 a 190 px), nenhum cabeçalho cortado, cartões da mesma linha com o mesmo topo; a 390 px sem transbordo e mosaicos em duas colunas.
- Não verificado: Candidaturas com muitos registos ou títulos muito longos, larguras entre 769 e 1100 px, Dashboard sem dados.

## Continuação: passagem página a página, conta da entidade (10/11/2026)
- Títulos de secção `h2` a 16 px/600 e `h3` a 14 px/600 em toda a área de conteúdo (exceto rótulos dos mosaicos da Administração, 14 px).
- Rótulo por cima do título de página (nome da entidade, “A minha conta”, “Conta da entidade”) a 12 px/500, sem maiúsculas forçadas; frase por baixo do título a 14 px.
- Etiquetas `.chip`/`.badge` com raio 6 px e 12 px/500.
- Cartões restantes (fichas de perfil, faturação do cliente, painéis da Administração) com raio 12 px e sombra comum.
- Separadores do relatório da organização com o mesmo sublinhado; paginação das Candidaturas sem caixa; estado numa só linha.
- Telemóvel: campos de texto, datas e seleções a 44 px; percurso do topo mostra só a página atual para não cortar “Entidade”.
- Validação: 871 testes PASS, build PASS. Navegador, 16 páginas/vistas da entidade a 1440 e 390 px: tamanhos uniformes e sem transbordo horizontal.
- Não verificado: Administração C4G (as regras comuns aplicam-se, mas nenhuma página foi vista com a conta `admin`), diálogos, fichas de candidatura e de oportunidade.
- Observado, sem alteração (decisão do utilizador): em Segurança da conta coexistem botões verde, petróleo e preto; “Acessos” e “Perfil pessoal” usam verde na ação principal, ao abrigo da [hierarquia de botões](button-color-hierarchy.md), enquanto as restantes páginas usam petróleo.

## Continuação: Administração C4G (10/11/2026)
- Conta `admin`, 8 páginas a 1440 e 390 px (Dashboard C4G, Entidades, Utilizadores, Faturação, Logs, Importar Portugal 2030, Fontes de oportunidades, Criar oportunidade): títulos 20 px/600, secções 16 px/600, botões e campos a 34 px, separadores Entidades/Utilizadores sublinhados, cartões a 12 px, sem transbordo horizontal.
- Ajustes: cartões de convites e atalhos com raio e sombra comuns; etiquetas de estado (`directory-status`, `operational-badge`) com raio 6 px e 12 px/500.
- Corrigido em telemóvel: o texto “Administração da plataforma C4G” sobrepunha-se ao percurso no topo; fica oculto até 768 px (o menu de perfil continua a indicar “Administração C4G”).
- 871 testes PASS; build PASS.
- Não verificado: diálogos (convites, alteração de estado), fichas de entidade, de candidatura e de oportunidade, ciclo de faturação com dados.

## Continuação: ação principal única em petróleo (10/11/2026)
- Decisão do utilizador: petróleo em todas as ações principais. Alterados `btn-create` e `btn-brand` (`index.css`), Segurança da conta (verde e preto) e o atalho “Segurança da conta” do Perfil pessoal. “Voltar ao perfil pessoal” passa a ação de apoio.
- [Hierarquia de botões](button-color-hierarchy.md) atualizada com esta decisão.
- 871 testes PASS; build PASS. Navegador, conta `admin`: nenhuma cor de botão fora de petróleo/branco/transparente em Segurança da conta, Catálogo e 6 páginas da Administração.
- Não verificado no navegador após a alteração: páginas só da entidade (Acessos, Pessoas, Unidades, Perfil pessoal) e o atalho do catálogo para Candidaturas, por a sessão ativa ser a de `admin`.

## Continuação: fichas e diálogos, conta `admin` (10/11/2026)
- Ficha de oportunidade do catálogo e ficha de entidade: títulos, botões e cartões já na escala comum; etiquetas `cr-status`, `entity-profile-state` e `member-state` passam a raio 6 px e 12 px/500; cartão de identificação da entidade com raio 12 px.
- Diálogo `FormModal` (convite de entidade): raio 12 px, título 16 px/600, rótulos 13 px, campos e botões a 34 px (44 px em telemóvel), botão de fechar a 34 px. Aberto e fechado com Escape, sem envio.
- 871 testes PASS; build PASS. Verificado a 1440 e 390 px sem transbordo.
- Não verificado: ficha e diálogos de candidatura (alteração de estado, parceiros, documentos), ficha de interesse, diálogos de faturação, formulários de unidade e pessoa — exigem a conta da entidade ou dados que a conta `admin` não tem.
- Observado: um pedido `GET /api/auth/session` devolveu 500 uma vez durante a verificação e recuperou no pedido seguinte; não relacionado com esta alteração (só CSS e um componente de apresentação).

## Continuação: ficha de candidatura e cores na conta da entidade (10/11/2026)
- Cores: Acessos, Perfil pessoal, Pessoas, Unidades, Segurança da conta e Catálogo sem botões fora de petróleo, branco ou transparente (“Voltar ao perfil pessoal” em petróleo suave, como ação de apoio).
- Ficha de candidatura (`application-detail.css`): seleção e contornos em petróleo em vez de verde; separadores Resumo/Documentos/Equipa e tarefas/Parceiros/Histórico com o sublinhado comum em vez de separadores preenchidos sobre faixa cinzenta; bordas mais claras; cabeçalho e painel com raio 12 px. As cinco secções foram abertas: títulos 16 px/600, botões 34 px, sem transbordo.
- Diálogo “Editar dados e orçamento”: aberto e fechado com Escape, sem guardar; campos e botões a 34 px (44 px a 390 px).
- Telemóvel: nas fichas, o percurso do topo mostra só a página atual; o regresso à lista continua disponível na ligação “Voltar” da página.
- 871 testes PASS; build PASS.
- Não verificado: diálogos de alteração de estado, parceiros, tarefas e documentos; formulários de unidade e pessoa; ficha de interesse; faturação com dados. A ficha demorou cerca de 10 s a apresentar conteúdo na primeira abertura (comportamento do carregamento, não medido nem alterado).

## Limites conhecidos
A camada de fundações sobrepõe-se às regras por página através de `#main-content`; as regras antigas de tamanho por página ficam inativas mas ainda não foram removidas.
