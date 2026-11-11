# Entrega 1 — validação e comparação com o piloto

Data: 2026-10-17. Estado: **Complete — entrega 1 fechada após aprovação visual do utilizador: «Gostei do Visual podemos continuar».** Continuação para a entrega 2 autorizada. Este fecho mantém os limites das provas abaixo e não declara paridade integral das cinco entregas. [Registo de fecho](../history/c4g-pilot-parity-delivery-1.md).

## Revisão final da comparação — 17/10/2026

**Veredicto: pronta para fechar a entrega 1.** Não foram identificadas novas diferenças que exijam correção dentro dos seus critérios de aceitação. Revistas as comparações de Dashboard, catálogo e detalhe, incluindo a legibilidade do catálogo a 1008 px e a apresentação móvel a 390 px. A revisão usa as capturas e provas finais abaixo; não houve nova execução dos testes nem alterações à aplicação nesta revisão.

| Área | Conclusão da revisão |
|---|---|
| Menu e Dashboard | Composição operacional recuperada, marca C4G e contexto da organização visíveis. Totais disponíveis conferidos na prova real; valores indisponíveis não são apresentados como zero. |
| Lista | Nove colunas separadas, linhas compactas, datas legíveis e ações acessíveis. Sem scroll horizontal nas larguras desktop verificadas; cartões móveis conservam o conteúdo. |
| Detalhe | Prazo, Candidaturas, Dotação e Registo recuperados; Registar interesse visível e ligado ao formulário atual. Descrição completa acessível por expansão e fonte oficial preservada. |

A apresentação não é idêntica ao píxel: o detalhe C4G é mais alto e coloca as ações abaixo do título; acrescenta proveniência, validação e âmbito organizacional. Estas diferenças mantêm a hierarquia recuperada e correspondem às adaptações autorizadas ao catálogo central e aos acessos. Os módulos assinalados «Em integração» e os indicadores dependentes do ciclo completo continuam nas entregas previstas.

Limites da conclusão: a referência esquerda executa componentes originais com respostas simuladas; a direita mostra a instalação C4G real. A criação manual persistida foi demonstrada com oportunidade privada em duas organizações descartáveis; o percurso desde o catálogo central real foi verificado até ao formulário, sem submissão na entidade real. Esta revisão não certifica produção nem recupera funcionalidades das entregas 2–5.

## Correção após revisão da comparação — 17/10/2026

As diferenças visuais identificadas abaixo foram corrigidas: linhas compactas e nove colunas no desktop, sem scroll horizontal a 1008/1280/1440 px; datas legíveis, títulos/referências completos no detalhe e no atributo de ajuda, título da ligação completo para leitores de ecrã; indicação do ambiente discreta e datas personalizadas expansíveis. A tabela em 1440 px começa agora a cerca de 251 px do topo, contra cerca de 383 px na comparação inicial. Móvel mantém todo o conteúdo em cartões.

O detalhe recupera Prazo/Candidaturas/Dotação/Registo. Contagem autorizada com falha distinta de zero, sem consulta privada para ADMIN sem organização e sem reaproveitamento de respostas após mudança de contexto. O endpoint central de detalhe devolve adicionalmente `createdAt` da oportunidade existente; `observedAt` continua a identificar a recolha. “Registar interesse” abre o formulário atual que cria uma candidatura em Intenção. Descrição começa com 800 caracteres, como no piloto, e permite abrir o texto completo; ligação aos valores na descrição abre diretamente o texto expandido. Não há truncagem dos dados persistidos.

Validação final das correções: **72 testes frontend, 12 backend, build e sintaxe PASS**; Chrome/OIDC real ADMIN/gestor, quatro detalhes, contagem zero autorizada, data de registo real, nove colunas, filtros, larguras e teclado PASS. Dados de negócio preservados. Comparação atualizada e renderizada; imagens anteriores preservadas como `antes-correcao-*.png`.

Foi também retomado o ensaio descartável de candidaturas. A preparação histórica usava o manifesto atual em três runners, apesar de instalar outro manifesto; os runners passaram a usar explicitamente o mesmo manifesto instalado. Mantidas as asserções de falha injetada, rollback, downgrade e integridade. A leitura privada isolada passava na API, mas falhava na abertura da página enquanto o seletor atualizava o contexto; as leituras da página passaram a usar a fila de sessão existente. O teste passou depois dessa correção e da uniformização da espera de 7 para 30 segundos nas duas etapas iniciais, igual às restantes etapas do mesmo teste; nenhuma asserção removida.

**Prova final de persistência: PASS** — `test/integration/applications/first-slice-gate.ps1`, PostgreSQL descartável, duas organizações e Chrome. Criação manual a partir de oportunidade privada, responsável/prazo, edição, transição, histórico relido, idempotência, concorrência, auditoria, resposta perdida recuperada após recarregamento e candidatura oculta à segunda organização. [Resultado](../../output/playwright/c4g-pilot-parity/application-proof.json). O percurso do catálogo central na instalação real foi validado até ao formulário; não foram introduzidas candidaturas de teste na C4G real. O ensaio isolado não substitui uma validação em produção.

Estado após a revisão final: comparação revista e apresentada ao utilizador, com veredicto e limites acima. Nenhuma entrega seguinte foi iniciada.

O restante documento conserva o resultado da primeira comparação e os limites então registados; não representa a apresentação após estas correções.

[Comparação lado a lado](../../output/playwright/c4g-pilot-parity/comparacao.html), com Dashboard, lista e detalhe a 1440/1008 px. [Evidência do browser](../../output/playwright/c4g-pilot-parity/verification.json).

## Referência e limites

Esquerda: componentes e CSS do commit `3a79b25539040c2024051cf9ab6295680b760277`, extraídos por leitura de Git para `.tmp/pilot-visual-reference`. Autenticação e serviços substituídos por respostas simuladas apenas nessa referência visual. Dados públicos atuais adaptados ao contrato antigo; não é uma sessão histórica da UBI, nem valida os serviços antigos. Nenhuma base legacy foi reativada. Os zeros de orçamento na referência são comportamento do componente original, não valores confirmados.

Direita: Chrome real, autenticação OIDC de ADMIN/gestor, aplicação habitual em localhost:3000 e API 5000. Capturas guardadas em `output/playwright/c4g-pilot-parity/`. A comparação HTML foi renderizada e todas as imagens verificadas nas duas larguras; versões PNG lado a lado disponíveis na mesma pasta.

## Resultado

- Build final Vite: PASS.
- Frontend: 41 testes em seis ficheiros — Dashboard, shell, apresentação/lista/catálogo e candidaturas privadas: PASS.
- Backend: 14 testes existentes de contratos de candidatura, resumos autorizados e catálogo de plataforma: PASS.
- Browser: ADMIN consulta nove registos, quatro com prazo atual, e os quatro detalhes com fonte oficial. Filtros e recarregamento preservados. Gestor consulta o Dashboard real: nove registos, quatro com prazo atual, zero candidaturas acessíveis; nove colunas no catálogo. Menu visível no desktop e recolhível; diálogo móvel, foco e Escape; larguras 1008/1280/1440/390. Sem erros JavaScript.
- Autoridade: catálogo de plataforma e fontes recusados ao gestor (403); candidaturas/diretório sem organização recusados ao ADMIN (409), catálogo de cliente sem membership ocultado (404); contexto estrangeiro recusado (409). Isto não substitui uma prova completa com duas organizações ativas.
- Formulário manual: abre a partir da oportunidade com responsáveis reais disponíveis, sem Matching ou publicação de perfil. Não foi submetida uma candidatura fictícia na organização real. A persistência completa desse percurso continua sem repetição nesta validação; testes de componente/contrato não a substituem.
- Preservação: zero escritas de negócio ou recolhas externas; hashes do catálogo, revisões/recolhas e diretório iguais antes/depois. Sem migrations, mudanças de acessos, commit, push ou deploy.

As primeiras execuções de build/testes foram impedidas por `spawn EPERM` no sandbox; as execuções com subprocessos autorizados passaram. Não houve rejeição de aprovação automática.

## Correções resultantes da inspeção

No Dashboard, contagem zero já não desenha uma barra positiva. A distribuição por fonte diz “com prazo atual”, sem inferir abertura. Valores indisponíveis usam texto de tamanho adequado, preservando a diferença face a zero. O Dashboard reutiliza a composição original e agrega apenas listas autorizadas atuais, percorrendo páginas e descartando respostas após alteração de contexto; não altera contratos HTTP ou permissões.

## Diferenças que impedem fechar a equivalência

1. Lista C4G mais alta que a referência: títulos/referências completos, informação de ambiente e filtros adicionais. A 1008 px a tabela preserva nove colunas com scroll horizontal; no móvel usa cartões. Esta diferença está exposta para revisão, não declarada equivalente por inferência.
2. Detalhe: faixa atual usa Programa e Abertura em vez de Candidaturas e Registo. Candidaturas estão numa secção própria; ação principal é “Criar candidatura”, não “Registar Interesse”. O esquema visual original ainda não foi integralmente recuperado.
3. Submissões/resultados/orçamentos permanecem explicitamente pendentes, como previsto no plano para entregas posteriores. A referência visual não legitima inventar esses valores na C4G.
4. Percurso de criação persistida e recarregada necessita prova numa organização de ensaio autorizada, preservando a entidade real.

Próximo passo: rever a comparação e resolver as diferenças da entrega 1 antes de avançar para a entrega 2.

## Reprodução

`npm run build` em `frontend/`; `npm test -- src/components/PilotDashboard.test.jsx src/components/C4gShell.test.jsx src/pages/Opportunities/OpportunityPresentation.test.jsx src/pages/Opportunities/OpportunityListTable.test.jsx src/pages/Opportunities/CentralOpportunities.test.jsx src/pages/Applications/PrivateApplications.test.jsx` em `frontend/`.

`node --test backend/test/applicationFirstSlice.test.js backend/test/applicationOpportunitySummaries.test.js backend/test/fundingPlatformCatalog.test.js`.

`node test/integration/local-platform/pilotParity.js`: instalação local existente, acessos privados carregados sem imprimir segredos, pedidos de negócio não GET bloqueados. `pilotReference.cjs` renderiza os componentes extraídos com serviços simulados; `pilotComparison.cjs` valida a comparação HTML e produz as imagens lado a lado. Nenhum destes scripts é um serviço da aplicação.
