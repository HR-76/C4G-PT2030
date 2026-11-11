# Lista de candidaturas — padrão visual
State: Review
Pedido de 03/11/2026. Apenas lista GCNI_C4G.

Direção: cabeçalho verde-petróleo #075B59, superfície branca, contornos #84968F e linhas alternadas #EAF2F0, ação verde #39751F. Mesma tipografia da ficha, dados legíveis e valores monetários alinhados. Ação Nova candidatura destacada no cabeçalho; abrir ficha evidente no título, sem duplicar ligações/colunas. Preservar oito colunas ordenáveis e todos os dados; tabela com scroll horizontal em ecrãs intermédios e cartões no telemóvel. CSS da lista isolado, sem modificar tema global.

Critérios: filtros/ordenação/paginação/retorno mantidos; seletor de estado apenas quando permitido, confirmação/motivo/recuperação inalterados; zero/null/valores grandes distinguíveis; títulos longos legíveis; foco visível; nova candidatura conserva percurso atual pelos interesses. Verificar administrador/consulta com API simulada, desktop/tablet/mobile. Sem alterações backend, dados reais ou permissões.

## Resultado

Cabeçalho e ação Nova candidatura em destaque; filtros por estado com contornos/seleção claros; oito colunas originais preservadas com cabeçalho escuro, linhas alternadas, valores monetários alinhados e acesso explícito Abrir ficha dentro da mesma ligação de título. Nome/unidades agrupados para cartões mobile. Seletor de estado legível sem cortar Em preparação; tabela rolável por teclado com barra de maior contraste. CSS da lista consolidado em application-list.css, removendo o bloco anterior de aplicações genérico.

Validação: 9 testes focados PASS; frontend final 734 PASS (85 ficheiros); backend 2652 PASS/7 SKIP/0 FAIL; build PASS. Logs output/application-list-visual-{focused,frontend,backend,build}.log. Chrome com API simulada: ORG_ADMIN/VIEWER, 1440/1024/390, oito campos, textos longos, zero/null/valor monetário máximo, filtros/ordenação/paginação e ações permitidas. Nenhuma escrita de negócio real. Gate test/integration/local-platform/application-list-visual-ui.cjs; output/playwright/application-list-visual/verification.json e capturas adjacentes.

Limites: tabela larga mantém deslocação horizontal em desktop/tablet quando necessário; mobile usa cartões com os mesmos dados. Nova candidatura continua a abrir interesses, conforme percurso existente. Sem alterações de permissões, API ou dados.

Próximo passo proposto: simplificar o percurso Interesses → Nova candidatura, mantendo escolha explícita e reutilizando o formulário existente.


O estado editável abre um único modal com o estado atual, os destinos autorizados e o motivo obrigatório. Cancelar descarta a edição. Confirmar exige destino e motivo.

Estados principais: Identificada, Em preparação, Submetida, Aprovada e Reprovada. Outros estados: Cancelada e Arquivada. Registos em Intenção contam como Identificada, preservando as revisões históricas.
