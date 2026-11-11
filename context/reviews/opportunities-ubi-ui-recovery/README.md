# Lista e detalhe de oportunidades UBI na C4G — Review

17/10/2026. [Contrato](../../features/opportunities-ubi-ui-recovery.md). Referência de apresentação: `3a79b25539040c2024051cf9ab6295680b760277`, identificada na [comparação página a página](../2026-10-17-frontend-ubi-referencia-recuperacao.md). A recuperação adapta a tabela, os indicadores e as secções dos componentes UBI aos serviços atuais; não liga o frontend multi-entidade aos endpoints legacy.

Ambiente disponível: **http://localhost:5189/catalogo**. Atualizar a página já aberta para carregar o novo frontend. Mantém login OIDC/MFA e seleção de organização. Os scripts de arranque existentes continuam a servir a demonstração; não houve nova recolha, migração, seed, reset ou alteração dos registos de domínio.

## O que foi recuperado e preservado

| Elemento UBI | Resultado deste recorte | Adaptação necessária |
| --- | --- | --- |
| Tabela de oportunidades e cartões móveis | Referência, título completo, programa/fonte, estado do registo, abertura, fecho, indicação de urgência e acesso às candidaturas | Apresentação comum em `OpportunityPresentation.jsx:24`, consumida pela lista central e privada. Serviços separados e identidades atuais mantidos |
| Cabeçalho e ações do detalhe | Referência, título, etiquetas, fonte oficial e criação de candidatura | Catálogo fixa a revisão central no link de criação (`CentralOpportunities.jsx:64`). Edição/arquivo privados preservam permissões, CAS e idempotência |
| Indicadores e ficha | Próximo prazo, programa, financiamento, abertura, financiador, referência, origem, validação e última recolha quando disponível | `OpportunityPresentation.jsx:40`. Ausência de montante não vira zero. ACTIVE é traduzido como estado do registo, não abertura do concurso |
| Descrição e áreas | Texto importado legível, secção temática quando existem códigos | Texto inerte, sem HTML executável; URL oficial apenas HTTP(S), sem credenciais. Não são inventadas condições estruturadas |
| Candidaturas no detalhe | Lista da organização, estado, prazo, acesso direto e paginação | `OpportunityApplications.jsx:7` usa o serviço privado existente, reinicia por organização/oportunidade e descarta respostas tardias. Erros de acesso são distintos de lista vazia |
| Filtros entretanto melhorados | Pesquisa, programa, datas inclusivas, atuais/histórico, a encerrar em 7/14/30 dias, paginação e recuperação de erro | Preservados em `CentralOpportunities.jsx:13`; filtros aplicados ficam no URL e são restaurados ao voltar do detalhe |

Os caminhos de criação manual continuam independentes de matching. O painel de critérios privado só aparece com a capacidade já anunciada pelo servidor; esse contrato não foi alterado.

A alteração backend está limitada à projeção de leitura em `backend/src/fundingTenders/repository.js:106`: a lista passa a devolver financiador, referência, data de abertura, estado e identificador externo já persistidos. Filtros, paginação, recolha, identidade, revisões e autorização permanecem existentes. As chamadas frontend continuam centralizadas em `frontend/src/api/api.js`.

## Verificações efetivamente realizadas

- **41/41 testes de componentes**: `CentralOpportunities.test.jsx`, `PrivateOpportunities.test.jsx`, `OpportunityApplications.test.jsx`, `OpportunityPresentation.test.jsx`. Incluem filtros e regresso do detalhe, revisão central exata, erro versus vazio, paginação, respostas atrasadas após troca de contexto, texto/URL seguros, valores financeiros exatos, permissões e arquivo/CAS privados.
- **6/6 testes backend**: `fundingCatalogQuery.test.js`, `fundingDetails.test.js`, `fundingCurrentSelection.test.js`. Filtros e datas, seleção atual e interpretação segura da fonte. `node --check backend/src/fundingTenders/repository.js` PASS.
- **Build Vite PASS**, incluindo os ajustes finais de apresentação. `git diff --check` do recorte tracked PASS; sem operações Git mutáveis.
- **Chrome com OIDC/TOTP real**, API e PostgreSQL persistentes da demo: quatro oportunidades com prazo atual; nove no total ao limpar filtros; detalhes dos quatro registos lidos; programa HORIZON combinado com 30 dias e conservado ao voltar do detalhe; links oficiais e link de candidatura com revisão central comprovados.
- **Central/A/B**: mesmos identificadores públicos nas duas entidades. Candidatura já existente visível no detalhe da oportunidade em A, ausente em B, acesso direto por B devolve 404; regresso a A recupera o acesso. Nenhuma candidatura criada/editada/arquivada nesta prova.
- **Computador 1440 px e telemóvel 390 px**: capturas revistas e ausência de overflow horizontal da página verificada. Corrigidos cabeçalhos cortados, apresentação das etiquetas e alinhamento de fonte/urgência nos cartões móveis.
- **Arranque normal restabelecido**, sem o módulo temporário de diagnóstico. Prova funcional repetida nesse arranque: PASS, zero erros JavaScript e zero escritas de domínio. Login e seleção de organização mantêm as operações normais de sessão/auditoria. O teste impede chamadas mutáveis fora de `/api/auth/`.

Capturas: [lista desktop](catalog-desktop.png), [lista móvel](catalog-mobile.png), [detalhe desktop](detail-desktop.png), [detalhe móvel](detail-mobile.png), [candidatura privada associada em A](associated-application-a.png). O teste local está preservado em `.tmp/recovery-browser.cjs`; usa as credenciais privadas já existentes, sem as imprimir. `node .tmp/recovery-browser.cjs` verifica os percursos; `--visual-only` reconfere apenas a tabela final. Nenhum dos modos recolhe fontes nem grava dados de negócio.

Durante a primeira automatização houve respostas 503 `AUTHORITY_STALE` em leituras concorrentes à navegação/troca de sessão. Foi diagnosticado apenas o código, sem relaxar a proteção. A sincronização do teste passou a aguardar o fim da seleção na interface e a consulta antes de navegar. A execução completa no arranque normal não reproduziu o 503. Isto não prova ausência de outras condições de corrida; a UI mantém erro/repetição e descarta respostas de contextos anteriores. Um arranque diagnóstico manual sem a CA local falhou no login; foi corrigido usando o arranque canónico, não alterando autenticação. O `spawn EPERM` inicial dos testes Node foi limitação do executor e a repetição autorizada passou.

## Limites — não confundir esta recuperação com paridade integral

- A lista usa **“Ver no detalhe”** para financiamento porque os contratos de listagem não o projetam; o detalhe apresenta montante/moeda quando a revisão os contém. Os quatro registos atuais não têm montante estruturado. Não se apresenta o desconhecido como zero ou como dotação certificada.
- A coluna de candidaturas permite consultar o trabalho da entidade. Ainda não apresenta o estado de uma candidatura diretamente em cada linha, como o piloto, porque a lista pública não agrega trabalho privado. A secção do detalhe já o faz pela API autorizada.
- As descrições atuais podem ser excertos. Elegibilidade, taxas, várias rondas e demais campos UBI não são preenchidos artificialmente; a cobertura depende da integração. O catálogo continua uma recolha limitada, não a totalidade da fonte.
- A distinção Gnomon/METU continua a lacuna de identidade previamente documentada em [detalhes e filtros](../c4g-catalog-demo/details-and-filters.md). Não se alteraram IDs, revisões ou candidaturas para a resolver nesta recuperação visual.
- A prova real de candidaturas usou um registo já existente. A edição/arquivo privados foram verificados por componentes, sem mutações reais ou novos dados de teste. Não é uma validação produtiva de todos os papéis, fontes ou dispositivos.
- Matching, Dashboard, restantes páginas, autenticação e infraestrutura não foram redesenhados. Residual prévio preservado, incluindo os ramos legacy que continuam fora da composição desta demo.

Próximo passo: rever visualmente esta lista e os quatro detalhes na demonstração, usando a referência UBI como critério de aceitação deste recorte.
