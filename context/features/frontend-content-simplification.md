# Simplificação do conteúdo do frontend

Estado: Complete — fecho formal em 26/10/2026. Terceira passagem editorial implementada em 21/10/2026.

## Objetivo

Reduzir texto permanente nas páginas ativas da aplicação sem retirar informação necessária para agir, interpretar dados ou recuperar de uma falha. A revisão abrange as rotas montadas em `frontend/src/App.jsx` e preserva os fluxos UBI ainda ativos durante a transição.

## Regra de decisão

- Remover frases que apenas repetem o título, a navegação, os campos ou ações já visíveis.
- Mover contexto secundário importante para um único componente de informação junto do título ou subtítulo a que se aplica.
- Manter visíveis erros, estados de carregamento, confirmações, consequências de ações, limites que alteram a leitura dos dados, requisitos de formulários, organização ativa e orientação de estados vazios.
- Não usar apenas `title`: o controlo de informação deve abrir por hover e foco, ter nome acessível, relação `aria-describedby`, foco visível e largura segura em mobile.

## Revisão por grupo de páginas

| Grupo | Decisão |
|---|---|
| Dashboard organizacional e C4G | Remover subtítulos genéricos; colocar data, cobertura, universo dos totais e cautelas de interpretação em informação contextual; manter ações e alertas visíveis. |
| Logs e diretório C4G | Reutilizar o padrão de informação em Logs; retirar descrições redundantes no diretório e manter a instrução operacional para abrir uma entidade. |
| Alertas, parceiros e segurança da conta | Retirar apenas as frases introdutórias que repetem o conteúdo imediato. |
| Perfil da organização | Retirar o subtítulo geral; mover explicações secundárias de identificação, hierarquia e criação de pessoas para informação contextual; manter permissões e consequências de formulário visíveis. |
| Fontes e integrações | Mover a descrição da fonte, limites da recolha e dimensão do histórico para informação contextual; manter modo de teste, indisponibilidade, execução limitada e erros visíveis. |
| Importação, adesão, candidaturas, oportunidades, matching, pré-qualificação e publicação | Manter instruções e cautelas que condicionam uploads, elegibilidade, decisões, submissões ou acesso; remover apenas duplicação de cabeçalho quando existente. |
| Listas, pesquisa e estados vazios | Manter contagens, filtros, paginação, contexto da organização e orientação de ausência de resultados. |

## Terceira passagem editorial

- Ocultar corretamente a descrição acessível das candidaturas na lista de oportunidades, preservando-a para tecnologia assistiva.
- Retirar a instrução permanente da lista de candidaturas; manter a semântica das contagens num `InfoTooltip` junto ao título.
- Retirar a repetição da organização ativa nas oportunidades privadas, já apresentada no seletor global.
- Retirar a explicação genérica no fim dos resultados de Matching, preservando a explicação contextual e os detalhes por área.
- Abreviar o estado sem histórico das fontes para «Sem atualizações».
- Retirar descrições redundantes dos cartões de Password e MFA, preservando o estado da política, o guia e a ação.
- Mover as cautelas secundárias do detalhe de oportunidade para `InfoTooltip` junto das secções correspondentes.

## Aceitação

- Existe um componente de informação reutilizável e testado, usado também pela página de Logs.
- Os cabeçalhos ativos não apresentam subtítulos puramente descritivos identificados nesta revisão.
- Informação deslocada continua disponível por rato, teclado e tecnologia assistiva, inclusive em mobile.
- Nenhum erro, aviso de dados incompletos, consequência de ação ou requisito de preenchimento é ocultado.
- A interface não expõe notas de implementação, integração, persistência interna ou matrizes gerais de permissões fora do momento em que sejam necessárias para decidir ou confirmar uma ação.
- Testes frontend direcionados e `npm run build` passam.

## Fora do âmbito

Reescrita funcional, alteração de permissões, APIs, dados ou contratos de negócio; remoção automática de todas as tags `p`; redesign visual, mudança de tipografia/paleta ou revisão editorial do conteúdo proveniente das fontes.

## Resultado e validação

- Criado `InfoTooltip`, com identificador único, nome acessível, `aria-describedby`, abertura por hover/foco, foco visível, largura limitada em mobile e respeito por redução de movimento. A página de Logs passou a reutilizar este componente.
- O posicionamento passou a usar coordenadas fixas calculadas a partir do controlo, com limites horizontais e verticais no viewport e reposicionamento durante scroll/resize. A área interativa é 44 × 44 px; foco repetido já não perde o alinhamento e os painéis ocultos deixaram de criar overflow horizontal.
- Removidas introduções redundantes em Segurança da conta, Alertas, Parceiros, Diretório C4G, Dashboard C4G, Perfil da organização, Fontes de oportunidades e importação C4G. O dashboard organizacional deixou de apresentar o resumo e a nota temporal em permanência.
- Data/cobertura dos dashboards, universo dos totais, cautelas do catálogo, metodologia do relatório, descrições e limites das fontes, histórico de sincronizações e contexto do perfil organizacional passaram para informação contextual.
- Foram revistas as restantes rotas montadas em `App.jsx`. Mantiveram texto visível quando este identifica a organização ativa, orienta upload/formulário/estado vazio, explica dados incompletos, limita elegibilidade ou suporta confirmação e recuperação de erro.
- Testes direcionados: 10 ficheiros, 63 testes PASS. Build Vite PASS.
- Correção visual: 33 testes direcionados PASS e build Vite PASS. Prova Playwright em cinco rotas, a 1440 × 900 e 390 × 844, sem overflow horizontal; primeiro e segundo foco permaneceram entre 16 e 374 px no viewport mobile de 390 px. Navegação por teclado confirmou foco visível e controlo de 44 × 44 px.
- Suite frontend completa: 45 ficheiros e 272 testes PASS; permanecem duas falhas preexistentes e alheias a esta revisão em `OrganizationAccess.test.jsx` (home C4G antiga) e `Editorial/SessionBoundary.test.jsx` (rótulo antigo «Prazo»). Nenhum ficheiro dessas falhas foi alterado por esta revisão.
- Suite frontend após a correção: 47 ficheiros, 273 testes PASS e as mesmas duas falhas preexistentes, sem novas regressões.
- A segunda passagem retirou as explicações permanentes de perfis, âmbito e persistência em Acessos e Comunicação, bem como linguagem de implementação visível sobre integração, armazenamento, antivírus, F11, R2/scanner, recortes editoriais e instalações locais. Estados indisponíveis passaram a usar mensagens curtas orientadas à ação.
- Cautelas necessárias de Matching, análise parcial, competências/evidências e interpretação de critérios passaram para `InfoTooltip`; consequências de confirmação, elegibilidade, MFA, dados de teste, limites de upload e recuperação de erros continuam visíveis no momento relevante.
- Validação final direcionada: 15 ficheiros, 107 testes PASS; build Vite PASS. Suite completa: 45 ficheiros e 273 testes PASS, com as mesmas duas falhas preexistentes em expectativas antigas da home C4G e do rótulo «Prazo».
- Prova Playwright da segunda passagem em Acessos, Matching, Alertas/Comunicação e Importação Portugal 2030, a 1440 × 900 e 390 × 844: sem overflow horizontal e sem qualquer uma das frases removidas. O novo tooltip de Matching mede 44 × 44 px e permanece integralmente no viewport mobile, entre 16 e 374 px.
- Terceira passagem concluída nos sete pontos aprovados: descrição acessível de candidaturas corretamente oculta; instrução permanente de Candidaturas substituída por informação contextual; organização ativa e explicação genérica de Matching retiradas; estado das fontes abreviado; cartões de segurança simplificados; cautelas do detalhe de oportunidade movidas para `InfoTooltip`.
- Testes direcionados da terceira passagem: oito ficheiros, 68 testes PASS. Build Vite PASS. Suite completa: 47 ficheiros e 274 testes PASS; permanecem apenas as duas falhas preexistentes em `OrganizationAccess.test.jsx` (home C4G antiga) e `Editorial/SessionBoundary.test.jsx` (rótulo antigo «Prazo»).
- Prova Playwright da terceira passagem em Candidaturas, Oportunidades privadas, Matching, Fontes, Segurança da conta e detalhe de oportunidade, a 1440 × 900 e 390 × 844: sem overflow horizontal, sem os textos permanentes removidos e sem erros de consola. O texto destinado a tecnologia assistiva mede 1 × 1 px com `clip-path: inset(50%)`; os novos controlos medem 44 × 44 px e os três painéis mobile ficam integralmente entre 16 e 374 px.
- Sem alterações a backend, API, autorização, migrations ou dados.

## Fecho formal (26/10/2026)

O recorte editorial fica concluído com os critérios de conteúdo, acessibilidade e responsividade satisfeitos. Na reconferência, nove ficheiros diretamente relacionados com este lote executaram 39 testes frontend com sucesso; a suite completa executou 52 ficheiros e 314 testes com sucesso antes de parar exclusivamente no parse de `EntityAdmission.jsx`, ficheiro da adesão ainda em desenvolvimento. O build global atual falha pela mesma causa externa; os builds e as provas Playwright exigidos pelas três passagens editoriais tinham passado e permanecem registados acima. Não foram alterados contratos funcionais, permissões, APIs ou dados.
