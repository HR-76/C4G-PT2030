# GCNI — interface de leitura isolada

Estado: Complete neste incremento (01/11/2026). Melhoria global mantém-se em curso; sem ativação habitual.

## Resultado
Barra de filtros G1, tabela e ficha integradas em CentralOpportunities exclusivamente no modo catalog-isolated. Reutilizam FilterBar, estilos GCNI, AuthProvider e transporte HTTP existente; o serviço real mantém a autorização por membership. O ensaio usa identidades sintéticas e não comprova OIDC institucional externo.

Filtros: código/título, estado, qualidade, programa, fonte, tipo, intervalo de prazo, dotação mínima/moeda e ordenação. Prazo inicial UTC visível e removível. Opções paginadas. Tabela paginada com 25 itens, retorno da ficha conserva página/filtros. Ficha com janelas, financiamento, regras, documentos/versões, conflitos, correspondências, histórico e evidências; secções carregadas quando abertas e paginadas.

Snapshots/cursors ficam apenas em memória. Mudanças de contexto abortam pedidos e invalidam respostas atrasadas. 401, 403 e 410 removem dados e capacidades; 410 exige atualização explícita. Validade absoluta máxima de 15 minutos. 503 por secção permite repetição local; 429 respeita Retry-After. Sem repetição automática. Revogação é detetada na próxima leitura/revalidação de foco, não por notificação instantânea.

## Validação executada
- Frontend: 73 ficheiros, 576 testes PASS, zero falhas. Inclui 22 testes novos da interface/controller.
- Construções habitual e catalog-isolated: PASS.
- Dois ensaios PostgreSQL 18.3/HTTP reais: 36 verificações PASS por execução; ambos os clusters encerrados.
- Browser Chromium: 27 oportunidades sintéticas, páginas 25+2, pesquisa, opções, ficha, retorno à página 2, erro 503 por secção e recuperação, expiração 410, revogação real de membership 403 e sessão terminada 401.
- Revisão visual a 1440×1000 e 390×844; sem overflow horizontal na ficha móvel. Tab desloca o foco com contorno visível. Sem auditoria integral de leitor de ecrã/WCAG.
- URL apenas com filtros/ID; localStorage e sessionStorage vazios no percurso verificado. Sem fontes externas nem base da APP habitual. As verificações finais confirmam fontes QUIESCED e histórico preservado.

## Autorrevisão
Veredicto: pronto a fechar este incremento isolado. Corrigidos: leitura duplicada após alteração de filtros; verificação de acesso no retorno à lista; impedimento de apresentar ficha de outro ID durante navegação; apresentação explícita de fuso/precisão temporal; tradução das razões de estado; distinção entre não recolhido, não encontrado, não aplicável, conflito e formato não suportado; identificação da alternativa selecionada e substituição documental; espera obrigatória para Retry-After. Valores financeiros permanecem strings exatas, sem arredondamento Number. Links externos são HTTPS sem credenciais e texto da fonte é renderizado como texto React.

Os dados/tokens são limpos em erros de autoridade/expiração, mesmo quando originados numa secção. Pedidos antigos não podem repor conteúdo após troca de filtros ou organização. Ações privadas de interesses/candidaturas/matching não foram acrescentadas ao DTO comum. A UI não publica conflitos nem escreve dados tenant.

## Limites e operação
O build isolado e o helper de ensaio não são a ativação operacional. O launcher --ui-review serve apenas a base própria, com cookie sintético, controlo local e limite de 15 minutos; nunca deve ser montado na APP habitual. O servidor de teste e o browser foram encerrados. Não foi exercitado OIDC externo nem carga de 10000 oportunidades/p95. O serviço backend de produção, as migrações ativas e os conectores não receberam alterações funcionais neste incremento. As alterações backend restringem-se ao harness de integração e respetiva documentação. Não há commit, publicação ou deploy.

A evidência HTTP cobre o serviço real; os testes de UI cobrem também opções/secções com mais de uma página, conflitos, precisão financeira e respostas atrasadas. As capturas usam dados sintéticos. Não interpretar as datas de 2027 nem os links oficiais presentes na fixture como recolha atual.

Próximo passo: executar a aceitação funcional e o ensaio de carga com perfis e volume representativos do GCNI, antes de ativar a interface no ambiente habitual.

## Âmbito e aceitação
- Integrar barra de filtros, tabela e ficha G1 com o serviço de leitura já validado; usar componentes/tokens GCNI e apresentação do laboratório aprovada.
- Ativar apenas no modo de construção catalog-isolated. Rotas e comportamento habituais preservados; fontes não reativadas.
- Manter snapshots/cursors apenas em memória e ligados ao contexto autorizado. URLs partilháveis só transportam filtros e ID, nunca tokens.
- Preservar filtros/página ao voltar da ficha; carregar secções e opções progressivamente, com paginação. Distinguir vazio, erro, expiração, revogação e sessão terminada.
- Cancelar pedidos e ignorar respostas antigas em mudanças de contexto/filtros; limpar dados e tokens em401/403/410. Expiração não mistura páginas antigas/novas.
- Usabilidade desktop/mobile e teclado, campos e condições financeiros/temporais sem interpretação enganadora; links externos seguros.
- Testes frontend, build habitual e isolado, HTTP/PostgreSQL próprios e revisão em browser; autorrevisão com limites explícitos.

