# Ficha de candidatura — separadores e modais
State: Review
Pedido de 03/11/2026. Foco exclusivo na ficha GCNI_C4G. Percurso de interesses fica para entrega posterior.

Direção visual: manter identidade C4G (verde profundo #005b58, verde de ação #347b24, fundo #f5f8f8, superfície #ffffff, texto #173d4a, contorno #d2dfe0), tipografia existente. Cabeçalho compacto, alinhado à esquerda, título e estado; separadores Resumo, Documentos, Equipa e tarefas, Parceiros, Histórico. Evitar longa sequência de formulários. Editar dados em modal; tarefas e parceiros em modais com formulários existentes; estados mantêm confirmações atuais. Sem novas capacidades de negócio.

Critérios: só painel selecionado visível; componentes continuam montados para preservar rascunhos/envios; atalhos do resumo e links #documento/#tarefa/#revisao revelam painel correto; teclado e foco nos separadores/modais; edição respeita permissões atuais; perda de permissão não desbloqueia mutações; modais bloqueiam fecho durante envio e exibem erro/recuperação; não criar automaticamente. Corrigir datas ausentes e formatação estreita. Verificar desktop/mobile, admin/membro com API simulada, suites e build. Sem dados reais, migrações ou deployment.

## Implementação e validação

Ficha organizada em cinco separadores, mantendo componentes montados: Resumo, Documentos, Equipa e tarefas, Parceiros e Histórico. Cabeçalho com nome da entidade (incluindo displayName da sessão real), título, estado e prazo; removido título duplicado. Resumo conserva valores, orientação e pendências. Atalhos de tarefa/documento/revisão revelam o painel antes de navegar. Separadores têm semântica tab/tabpanel e navegação por setas/Home/End.

Modais existentes reutilizados para dados/orçamento, adicionar colaborador, criar/editar tarefa e parceiro. Rascunhos preservados ao fechar e alternar separadores; recuperação de envios continua explícita. Formulários de consulta não expõem ações de edição. Estados mantêm confirmação anterior, agora recolhidos em Alterar estado. Históricos secundários recolhidos; corrigida apresentação de datas documentais ausentes e de decisões de revisão.

Validação final: frontend 734 PASS (85 ficheiros), backend 2652 PASS / 7 SKIP / 0 FAIL, build PASS, diff-check sem erros. Testes de recuperação/permissões mantidos e adaptados aos cliques necessários; novas regressões para rascunhos, navegação/painéis e modais. Evidência: output/application-workspace-frontend.log, output/application-workspace-backend.log, output/application-workspace-build.log.

Chrome real com API simulada: administrador e consulta, 1440/390, apenas um painel visível, teclado/foco/Escape, modais dados/tarefa/colaborador/parceiro, rascunhos entre separadores, atalhos para tarefa/documento/revisão e ausência de overflow. Capturas inspecionadas. Gate test/integration/local-platform/application-workspace-ui.cjs; output/playwright/application-workspace/verification.json. Não foi utilizada sessão real nem criado/editado qualquer registo real. Sem mudanças backend, infraestrutura ou permissões nesta entrega.

Próximo passo: validar a apresentação na candidatura da entidade, percorrendo documentos/Budget, equipa e parceiros. A simplificação de interesses → candidatura permanece registada para depois desta ficha.


## Refinamento visual — pedido seguinte do utilizador

Objetivo: reforçar contraste e qualidade CSS, reduzir texto redundante na ficha. Escopo local; não alterar tema global da APP nesta entrega.
Plano: verde-petróleo #075B59 no cabeçalho e separador ativo, branco #FFFFFF nas superfícies, texto #20262B, linhas de dados alternadas #EAF2F0/#FFFFFF, contornos #84968F e ação verde #39751F. Tipografia existente, dados maiores e rótulos em frase normal. Consolidar CSS específico num ficheiro, sem acumular remendos. Não repetir oportunidade/prazo no resumo se já estão no cabeçalho. Modais com a mesma hierarquia; manter mensagens úteis de erros, permissões, paginação e revisão interna. Inspecionar todas as secções e modais desktop/mobile após build.

## Resultado do refinamento visual

CSS da ficha consolidado em application-detail.css; removido o bloco anterior de apresentação do workspace de applications.css. Cabeçalho verde-petróleo e separador ativo preenchido, painéis brancos delimitados, contornos fortes e linhas alternadas nos dados; largura desktop até 1180px e rótulos sem maiúsculas pequenas. Modais têm cabeçalho e campos coerentes com a ficha, com seletores próprios para portais. Em mobile os cinco separadores ficam visíveis em linhas, sem depender de deslocação horizontal.

Oportunidade/prazo mantidos no cabeçalho, sem repetição nos dados. Explicação do resumo acessível no controlo de informação existente; contagens mais curtas e detalhes técnicos recolhidos nos históricos. Mantidas mensagens necessárias para permissões, envio pendente, carregamento/associação e revisão interna. Sem alteração de contratos, permissões ou operações.

Validação final: frontend 734 PASS, backend 2652 PASS/7 SKIP/0 FAIL, build PASS. Chrome com API simulada repetido após os últimos ajustes, administrador/consulta em 1440/390 PASS; capturas de resumo/documentos/modais desktop e mobile inspecionadas. Contraste das cores principais: branco sobre #075B59 ≈7,93:1, branco sobre #39751F ≈5,62:1; isto não constitui certificação global de acessibilidade. Logs output/application-polish-{frontend,backend,build}.log; prova visual no gate e diretório application-workspace já referidos.

Próximo passo proposto: aplicar este padrão visual à lista de candidaturas, depois de confirmar a apresentação da ficha com o utilizador. Não foi alterado o tema global da APP.

## Linha de atividade no Histórico

Pedido de 10/11/2026. Reaproveitar as revisões da candidatura numa linha vertical inspirada no Metronic. Cada resumo apresenta ação, data e, quando aplicável, o estado da candidatura. Os detalhes ficam recolhidos por defeito e abrem individualmente por rato ou teclado, com motivo, diferenças verificadas e dados da revisão. Usar os tokens C4G e preservar a paginação, os estados de consulta e a autorização do histórico existente.

Critérios de aceitação

- Apresentar criações, edições e mudanças de estado na ordem já devolvida pelo histórico e identificar a revisão atual.
- Manter os dados e a comparação entre revisões consecutivas, incluindo montantes a zero e revisões antigas com campos ausentes.
- Confirmar abertura e fecho por teclado e leitura sem transbordo em computador e telemóvel.

Validação de 10/11/2026. Os 41 testes focados e os 872 testes da suite frontend passaram. Build concluído. O Chrome confirmou paginação, expansão por teclado, leitura a 1440 e 390 px e apresentação de uma recusa HTTP 403 com a API simulada. Foram usados perfis simulados de administração da entidade e de consulta. O Histórico consome a operação de leitura já autorizada e paginada.

Seguimento de 10/11/2026. O atalho «Ver histórico», junto a «Dados da candidatura» no Resumo, abre o separador Histórico. Em Chrome na aplicação local, a ficha «Estágios Profissionais - 3º Aviso» devolveu HTTP 200 e apresentou um evento expansível de criação, na revisão 1.

## Ações para adicionar membros e parceiros

Pedido de 10/11/2026. Apresentar «Adicionar membro» e «Adicionar parceiro» no cabeçalho dos respetivos separadores. Cada ação abre o formulário existente num modal, com foco inicial no primeiro campo e regresso ao botão ao fechar. Mostrar o estado da consulta enquanto a autorização é carregada, indicar quando o acesso é só de consulta e explicar quando a equipa não tem membros disponíveis para adicionar. Usar as permissões, a recuperação de envios e a preservação de rascunhos existentes.

Aceitação. Confirmar os botões nos respetivos separadores, os formulários abertos por teclado e por clique, o fecho com Escape, o caso sem membros disponíveis e a ausência das ações para perfis de consulta. Validar na ficha local sem gravar dados.

## Resumo orientado para pendências

Estado: Review. Proposta aprovada em 10/11/2026.

- Mostrar responsável, estado e prazo interno no cabeçalho. No Resumo, apresentar «A tratar» antes dos dados da candidatura.
- Dar destaque a tarefas em atraso, pedidos atuais com alterações solicitadas, versões indisponíveis e revisões pendentes. Usar os atalhos existentes para o registo.
- Basear o estado sem pendências em consultas completas de tarefas e revisões. Informar quando há dados indisponíveis, incompletos ou pedidos com acesso limitado.
- Preservar permissões, consultas, estados transitórios, separadores e foco dos atalhos. Validar em computador e telemóvel.

Validação. Build e 50 testes focados aprovados. Na suite frontend, 877 passaram e repetiu-se a falha já observada no teste do diálogo «Adicionar membro» em ApplicationWork. Chromium com API simulada a 1440, 390 e 320 px confirmou atraso, alterações solicitadas, ambos, ausência de pendências e falha na consulta documental. Atalhos ativados por teclado ou toque abriram os separadores e deram foco ao registo. Foi feita uma consulta inicial por fonte. A instância local habitual estava indisponível.
