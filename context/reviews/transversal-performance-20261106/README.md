# Notificações e Candidaturas — correções e comparação de 06/11/2026

Correções implementadas e validadas: abertura de Alertas **16,04 → 5,46 s (−66,0%)** e Candidaturas **5,54 → 4,13 s (−25,4%)** no browser real isolado. A carga auxiliar das notificações também diminuiu nas outras páginas medidas. Ainda existem tempos de vários segundos e não foi demonstrada melhoria da apresentação em todas as páginas.

## O que mudou

**Notificações:** novo POST `/api/notifications/refresh-list` gera prazos e devolve a seleção numa única transação WRITE protegida. Exige NOTIFICATION_SYNC e NOTIFICATION_READ antes de qualquer efeito. A dependência adicional de autoridade está limitada a essa intenção, esse par de operações e o inbox da mesma organização. O cabeçalho e a página usam este endpoint; os endpoints anteriores permanecem disponíveis. Uma falha transitória permite consultar os alertas guardados numa nova leitura autorizada, sem repetir a escrita; uma recusa de acesso não faz esse fallback.

As decisões de visibilidade continuam a avaliar candidatura, oportunidade, avaliação e participação na equipa, individualmente, com os mesmos eventos de auditoria. Apenas os dados centrais de membership/política são partilhados dentro da operação: carregados depois da preparação da guarda, associados ao ator/versões e validados contra o token, cliente, transação e prazo a cada acesso. O snapshot é imutável, tem vida limitada a essa operação e não é usado na preparação da guarda nem partilhado entre pedidos. Não é cache de decisões. Expiração, guarda inválida ou falha de leitura impedem o uso. O protocolo de commit/revogação e as verificações de metadados permanecem.

**Candidaturas:** novo GET `/api/applications/browse-page` recolhe lista e opções de unidades na mesma operação protegida. Preserva SQL de visibilidade, filtros, totais, contagens por estado, ordenação, cursores assinados, paginação e permissões de transição. A abertura e ações sem alteração do texto deixam de esperar pelo debounce de 250 ms; a pesquisa digitada mantém debounce. Respostas abandonadas são canceladas/ignoradas. A página só publica a resposta combinada completa; uma falha das opções passa a impedir também a apresentação dessa resposta, com erro e possibilidade de repetir. Os endpoints separados continuam disponíveis.

Não foram alterados schema, índices, grants, limites dos pools, timeouts ou bloqueios globais das escritas. NOTIFICATION_SYNC continua WRITE; o limite de resposta dessa operação passou de 1 para 2 MiB para acomodar a mesma lista já permitida por NOTIFICATION_READ. Mantêm-se limite de 100 itens, controlo de destinatário, RLS, CSRF, auditoria síncrona e guardas finais.

## Comparação no browser

Medianas em segundos até apresentação dos dados. A é a versão imediatamente anterior a este incremento, já com as correções de dashboard/perfil do incremento 3; B é a versão final. Esta fixture tem alertas guardados e prazos a gerar, pelo que **os valores absolutos não devem ser comparados diretamente com o relatório anterior**, cuja caixa estava vazia.

| Página | Abertura A | Abertura B | Variação | Navegação A | Navegação B | Variação |
|---|---:|---:|---:|---:|---:|---:|
| Alertas | 16,04 | 5,46 | −66,0% | 10,42 | 3,20 | −69,3% |
| Candidaturas | 5,54 | 4,13 | −25,4% | 3,25 | 2,88 | −11,4% |
| Dashboard | 5,08 | 4,31 | −15,2% | 3,11 | 2,99 | −4,0% |
| Perfil institucional | 4,70 | 4,83 | +2,9% | 3,99 | 3,83 | −4,1% |

O perfil não demonstrou melhoria de abertura: há uma pequena regressão observada e intervalos sobrepostos. A amostra não permite atribuir causalidade a diferenças pequenas nem calcular um p95 representativo de produção. Alertas variou entre 15,59–16,23 s em A e 5,21–5,58 s em B; Candidaturas entre 5,15–5,79 s e 4,00–4,29 s, respetivamente.

O trabalho auxiliar também diminuiu. Tempo mediano até `networkidle`, que inclui a espera de inatividade do browser:

| Página | A | B |
|---|---:|---:|
| Alertas | 16,50 s | 5,92 s |
| Candidaturas | 11,92 s | 4,55 s |
| Dashboard | 11,33 s | 4,74 s |
| Perfil institucional | 12,87 s | 5,99 s |

Isto distingue uma redução efetiva do trabalho de rede de uma simples alteração do indicador de carregamento. O protótipo anterior de adiar os pedidos auxiliares continua rejeitado; não foi reintroduzido.

## Método e evidência reproduzível

Quatro execuções sequenciais **A/B/B/A**, sem suites/build concorrentes. Por execução: duas aberturas de cada uma das quatro páginas e uma navegação interna por página. **48/48 medições concluídas**, respostas principais 200 e sem erros API observados nas aberturas. Por variante/página: quatro aberturas e duas navegações. Não foram excluídas medições.

PostgreSQL 18.6/central 050, Keycloak e OIDC/PKCE reais, duas organizações em bases distintas, 1000 candidaturas e 250 pessoas por organização. Cada caixa contém seis alertas guardados, dois prazos a gerar e uma linha destinada a outro membro que nunca pode ser apresentada. Autoridade, RLS e auditoria são os componentes reais. Bases/contentores descartáveis, portas loopback e credenciais sintéticas; nenhum uso das bases habituais.

Abertura significa nova página do browser já autenticado, incluindo validação de sessão, pedidos da página e renderização; não inclui login. A condição de pronto exige resposta principal concluída, ausência de indicador de carregamento e renderização; Candidaturas exige linha de tabela e Alertas o marcador de resultados. Navegação usa links reais da aplicação. Não é uma medição de LCP.

Fontes A congeladas com SHA-256, builds Vite separados e preloader apenas para A, sem checkout/restauro do workspace durante os ensaios. Imagens Docker iguais; fontes/harness inalterados em todos os ensaios e builds iguais dentro de cada variante, verificados pelo comparador. Limitações: ambiente local, amostra pequena, dados sintéticos, instrumentação PostgreSQL a cada 100 ms e leitor central da fixture com `pg_read_all_data`. Não constitui garantia de capacidade/SLO nem cobre caixas de entrada com milhares de alertas.

- [Comparação com valores individuais, intervalos e imagens](comparison.json), gerada por `node context/reviews/transversal-performance-20261106/compare.cjs`.
- Resultados brutos: [A1](../transversal-a1-20261106/results.json), [B1](../transversal-b1-20261106/results.json), [B2](../transversal-b2-20261106/results.json), [A2](../transversal-a2-20261106/results.json). As pastas incluem `sources.json` e `run-config.json`.
- Harness: `test/integration/transversal-performance/`; fontes A em `before/manifest.json`, builds em `.tmp/transversal-performance/combined-build-A` e `combined-build-B`.

## Segurança e validação

[Gate final](../transversal-security-final-20261106/results.json): COMPLETE, integridade preservada.

- Organização cruzada e ausência de permissões recusadas; alertas sem acesso à candidatura/oportunidade e de outro destinatário omitidos.
- CSRF inválido recusado; cursores adulterados recusados; lista, unidades, filtros e paginação equivalentes aos endpoints existentes. O prazo de emissão dos cursores varia naturalmente, pelo que se compara o conteúdo/posição e se testa a sua utilização/assinatura.
- Falha de auditoria impede publicação nas duas operações. Falha injetada após inserir um alerta desfaz a inserção e não deixa evento funcional parcial.
- Quatro pedidos simultâneos por operação devolveram 200 e resultados completos. Na geração concorrente de um novo prazo, o total de alertas de prazo e de eventos de auditoria passou de 2 para 4: exatamente dois novos alertas e duas auditorias, sem duplicados. Os prazos antigos permaneceram no histórico e foram omitidos da seleção atual.
- Revogação concorrente nas duas operações: commit da leitura já protegida antes do commit da revogação; pedidos posteriores recusados. Não há alegação de cancelamento retroativo da leitura protegida.
- Testes do snapshot verificam isolamento entre operações, imutabilidade, identidade/versão, expiração, invalidação da guarda durante a leitura e falhas sem recuperação silenciosa. Os testes de composição confirmam duas avaliações e duas auditorias, mesmo quando a leitura central é partilhada.

Regressões iniciais dos novos percursos reproduzidas em RED e depois GREEN. Backend final **2723 PASS, 7 SKIP, 0 FAIL**; frontend **814 PASS, 0 FAIL**; builds A/B e normal PASS. Logs: `transversal-backend-final.log`, `transversal-frontend-final.log`, `transversal-build-final.log` na pasta de artefactos Codex desta sessão. A mensagem `Synthetic chunk failure` da suite frontend pertence ao teste intencional de recuperação; a suite terminou sem falhas.

## Experiências e falhas anteriores preservadas

A primeira comparação de payloads falhou porque incluía o prazo variável dos cursores. O protótipo combinado sem snapshot por operação produziu dois LEASE_TIMEOUT em quatro sincronizações. Retirar o lock global não resolveu: também havia contenção de auditoria. Essa retirada foi rejeitada e o lock original reposto; a versão final reduz as consultas que prolongavam a transação, sem adiar a auditoria. Outro ensaio passou concorrência e a primeira revogação, mas o harness tentou reativar membership através de uma porta que apenas permite suspender/remover; o ensaio final usa organizações distintas para as duas revogações. Relatórios `transversal-security*` preservados, sem misturar tentativas falhadas com os resultados finais.

## Estado e limites

Alterações no código, sem commit, deploy, reinício do ambiente habitual ou alterações nas suas bases. Todos os contentores próprios foram removidos; a consulta final por label não encontrou remanescentes.

Incremento validado nos dois percursos prioritários. Continuam em aberto os custos comuns de metadados/execução, as consultas de Candidaturas, caixas de alertas grandes e as restantes páginas não medidas. O perfil continua perto de cinco segundos neste cenário. PERF-01/02/03 permanecem em curso; não considerar a lentidão de toda a aplicação resolvida.
