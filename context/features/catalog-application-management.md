# Catálogo e acompanhamento de candidaturas

State: Review

## Pedido e âmbito

Pedido de 03/11/2026: simplificar a última coluna do Catálogo para registo de interesse e ligação à zona de Candidaturas; distinguir linhas por interesse/estado; ação por linha para abrir candidatura; recuperar estatísticas de orçamento no Dashboard. Apenas GCNI_C4G, reutilizando os contratos e percursos atuais.

## Critérios

- No Catálogo central habitual, coluna Interesse no fim da tabela; sem estados de candidaturas nem texto «Sem candidaturas visíveis». Um botão de registo, com confirmação visual após sucesso, e ligação à área Candidaturas. Interesse ativo distingue a linha inteira; pendente, erro, arquivo e desconhecido não aparecem como sucesso. Links oficiais mantidos.
- A zona Candidaturas reúne navegação para Interesses e Candidaturas existentes. Nos interesses, Nova candidatura abre o formulário existente com revalidação, sem criação automática. Nas candidaturas existentes, Abrir candidatura é ação explícita na última coluna. Retorno/filtros, permissões e intenções pendentes preservados.
- Cinco estados principais visíveis: Identificada, Em preparação, Submetida, Aprovada, Reprovada. REJECTED passa a rótulo Reprovada. Cores de linha distintas e texto do estado sempre presente. Estados adicionais existentes continuam consultáveis, sem apagar histórico ou alterar transições/autorizações.
- Dashboard operacional recupera Orçamentos por estado da UBI usando `report.states` já disponível: contagem, orçamento da organização e orçamento total das candidaturas por estado atual. Não somar estados cumulativos como se fossem exclusivos; valores ausentes permanecem identificados. Totais respeitam a visibilidade autorizada existente.
- Desktop e mobile legíveis, foco de teclado visível, sem depender só da cor. Paleta C4G: petróleo #075b59, branco #fff, cinza #eef2f5, azul #e5effb, âmbar #fff0cd, verde #e2f2df, vermelho #fbe5e5; acentos de maior contraste, tipografia existente e dados alinhados.

## Validação

Regressões focadas de coluna final, ação única/registo confirmado, navegação, permissões, estados e métricas sem orçamento; suites locais e build; Chrome com dados simulados em desktop/mobile. Sem alterações de esquema, migrações, dados reais, deployment ou envios.

## Resultado

Integrado na GCNI_C4G:

- Tabela habitual do Catálogo com **Interesse** como última coluna, um botão de registo, confirmação no próprio botão e ligação **Candidaturas** após registo. Linhas verdes apenas para interesse ativo confirmado; sem resumos de candidaturas nesta tabela e sem a consulta adicional que os carregava. Consulta do detalhe e fontes oficiais mantidas.
- Navegação comum **Interesses / Candidaturas**; `/candidaturas?ver=interesses` reutiliza a lista existente e mantém a secção ao aplicar/limpar filtros, abrir o formulário e cancelar. `/interesses` continua compatível. Nenhuma candidatura é criada por registar interesse ou navegar.
- Última coluna **Ações** na lista de candidaturas com **Abrir candidatura**, fixa à direita em desktop para permanecer visível. Oito campos e ordenações anteriores mantidos. Cinco estados principais com cores de linha e rótulo **Reprovada**; restantes estados acessíveis em **Outros estados**, sem alterar transições.
- Dashboard operacional com contagem e dois orçamentos por estado atual, ligações para candidaturas filtradas, valores ausentes/parciais identificados e paleta partilhada. Recuperação do bloco existente na UBI, usando agregados já autorizados da C4G.

Validação automatizada: regressões antes da implementação; 89 testes focados de Catálogo/Interesses/formulário, 50 de lista/estados e 28 de Dashboard PASS. Suite frontend 767 PASS (87 ficheiros); backend 2652 PASS/7 SKIP/0 FAIL; build PASS. Logs `output/catalog-management-{focused,frontend,backend,build}.log`, `output/dashboard-budget-focused.log`. Avisos preexistentes de jsdom/React sem falhas. Revisão visual corrigiu caption redundante no Dashboard e garantiu ação sempre visível na tabela larga.

Validação em Chrome com API simulada aprovada nos perfis administrador e membro/consulta: Catálogo + percurso direto 1440/390; candidaturas 1440/1024/390; Dashboard 1440/390. Gates `test/integration/local-platform/{catalog-interest-management,application-list-visual,dashboard-budget}-ui.cjs`; evidências e capturas verificadas em `output/playwright/{catalog-interest-management,application-list-visual,dashboard-budget}/`. Build final após correções de CSS: `output/application-state-rows-build.log`. Cor após confirmação, fontes oficiais, filtros/retorno, ação sempre visível, montantes exatos/ausentes e ausência de overflow/erros de página confirmados. Provas simuladas, sem login/dados reais.

Sem alterações backend, esquema, dados reais, permissões ou envio de mensagens. Valores financeiros são orçamentos registados nas candidaturas por estado, não prova de financiamento recebido. A consulta alternativa `/catalogo/consulta` e o detalhe mantêm o percurso de consulta anterior; simplificação aplicada à tabela habitual pedida.

Próximo passo: harmonizar o formulário **Nova candidatura** com o padrão visual da ficha, mantendo os campos e regras atuais.
