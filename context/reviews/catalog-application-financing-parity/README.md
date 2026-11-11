# C4G — fecho das diferenças de lista/detalhe

17/10/2026. [Contrato](../../features/catalog-application-financing-parity.md). Recorte: indicação das candidaturas na lista e coerência da informação financeira. A referência do piloto orienta a apresentação; identidade, catálogo central e acesso continuam C4G multi-entidade.

## Alterações e fronteiras

| Diferença | Comportamento implementado | Evidência técnica |
|---|---|---|
| A lista tinha apenas «Consultar» | Uma candidatura acessível mostra o estado e liga diretamente à ficha; várias mostram contagem/estados e ligam à lista filtrada. Ausência só após resposta válida; falha/sem permissão mostra indisponibilidade e permite repetir. | `frontend/src/pages/Opportunities/OpportunityListTable.jsx:8`; `OpportunityPresentation.jsx:20` |
| Lista remetia para detalhe e detalhe dizia «Não indicado» apesar de haver valores na descrição | Apresentação comum: montantes estruturados exatos, «Valores na descrição» com ligação à secção, ou «Montante não identificado». Mantém moeda, zero e precisão; não interpreta prestações, taxas ou percentagens como dotação. | `OpportunityPresentation.jsx:14`, `:49`, `:68`, `:79` |
| Informação financeira não chegava à lista | Projeta apenas os campos financeiros e a descrição da revisão atual já persistida, central e privada. Não altera a fonte nem cria revisões. | `backend/src/fundingTenders/repository.js:107`; `backend/src/opportunities/repositorySupport.js:106` |

`GET /api/applications/opportunity-summaries?opportunityIds=…` pertence ao serviço privado. Aceita 1–25 UUIDs distintos, sem organização fornecida pelo cliente. Reutiliza membership, runtime tenant, `APPLICATION_READ`, `OPPORTUNITY_READ` e autorização por recurso da listagem existente. O catálogo comum não recebe estados privados. A consulta lê apenas os campos necessários, com organização parametrizada, paginação interna de 100 e limite de 10 000 linhas; não devolve contagens parciais quando atinge o limite. Mantém o timeout de 10 s da operação. Referências: `backend/src/applications/contracts.js:18`, `repository.js:75`, `composition.js:20`, `backend/src/routes/applicationSliceRoutes.js:18`, `frontend/src/api/api.js:124`.

O browser faz uma consulta para as oportunidades visíveis. A tabela invalida respostas antigas ao mudar organização/página e verifica cobertura e consistência da resposta; não converte erros em «Sem candidaturas». A expressão identifica somente a presença de valores na descrição, sem extrair nem classificar montantes como orçamento.

## Verificação automatizada

- Frontend: **51/51** testes nos cinco ficheiros `CentralOpportunities`, `PrivateOpportunities`, `OpportunityApplications`, `OpportunityPresentation` e `OpportunityListTable`. Inclui contagem/estados, erro/repetição, respostas incompletas, troca de organização/página, dinheiro exato/zero, texto inerte, filtros e foco na descrição.
- Backend: **16/16** em `applicationOpportunitySummaries`, `applicationFirstSlice`, `fundingCatalogQuery`, `fundingTendersAuthority`, `fundingDetails`, `fundingCurrentSelection`; **32/32** no conjunto adicional `applicationOpportunitySummaries`, `f12OpportunityDomain`, `f12PrivateOpportunityHttp` (**44 testes distintos**, quatro repetidos após restringir os campos SQL).
- `node --check` nos seis ficheiros backend alterados: PASS. `npm run build` em `frontend/`: PASS, incluindo a última correção visual das ligações financeiras.
- O sandbox recusou inicialmente subprocessos dos testes (`spawn EPERM`); os mesmos testes passaram com a execução local autorizada. Não foi uma falha da aplicação.

## Demonstração local

Ambiente existente em `http://localhost:5189/catalogo`, PostgreSQL dedicado em 5561, login OIDC/MFA real. API/worker reiniciados para carregar o código; configuração, volume, nove oportunidades centrais e candidatura existente preservados. Nenhuma recolha externa, alteração de negócio, migration, seed, reset, deploy ou operação Git mutável. O registo privado preexistente «Synthetic private 0» é uma fixture: a sua apresentação `0 – 20.5 USD` comprova a projeção e a preservação do zero/moeda, não uma oportunidade financeira real.

A prova usa `.tmp/catalog-parity-browser.cjs`, o login existente e bloqueio de POST/PUT/PATCH/DELETE de negócio. Exceção apenas para o fluxo de autenticação/troca de organização; os serviços mantêm os seus registos normais de sessão e auditoria. Não é uma transação global sem escritas de infraestrutura.

Os ensaios preliminares precisaram de duas correções no script: ler o título no campo editável da candidatura e trocar organização no catálogo, sem presumir que a troca a partir de qualquer página regressa ao catálogo. Nenhuma dessas páginas foi alterada para satisfazer o teste. Resultado final e capturas: ver `verification.json` e os PNG nesta pasta.

**Ensaio final PASS às 17:30 de Lisboa, em arranque normal**, sem observador: quatro oportunidades atuais/quatro detalhes, três ligações para valores na descrição e um montante não identificado; filtros programa/prazos e regresso à lista preservados; âncora com foco na descrição; nove registos centrais no histórico; candidatura existente com estado e ligação direta em A, contagem zero e GET 404 em B; mesmo catálogo público A/B; lista privada HTTP 200. Zero escritas de negócio e zero erros JavaScript. Capturas inspecionadas em computador e móvel; sem marca UBI nos percursos verificados. [Resultados do ensaio](verification.json), [lista](catalog-desktop.png), [candidatura em A](existing-application-a.png), [catálogo em B](catalog-organization-b.png), [lista privada com fixture](private-list.png).

**Limitação adicional observada:** um carregamento direto de `/oportunidades` produziu HTTP 503. O observador temporário identificou `AUTHORITY_WRITE_PENDING` em `authenticatedAuthority.js:86`, na captura da autoridade, antes de executar a consulta do catálogo. A mesma consulta SQL, na base local em transação `READ ONLY`, passou e devolveu um registo; a leitura HTTP isolada também devolveu 200. A navegação pelo link da aplicação passou, com projeção financeira e sem precisar de repetição. Esta intermitência de autoridade/sessão não foi corrigida nem atribuída à projeção SQL; requer reprodução própria antes de produção. O observador de diagnóstico foi retirado do arranque e preservado apenas como ficheiro temporário local, sem segredos.

## Limites e critério seguinte

Não é validação de produção nem fecho dos restantes percursos. Várias candidaturas/estados são provados com fixtures unitárias; não foram criadas candidaturas para esta prova. O catálogo continua a ser uma amostra da fonte. Os quatro registos não têm montante estruturado; três têm valores no texto persistido e o quarto não os tem no excerto disponível. A fonte oficial permanece acessível; não houve nova confirmação externa nesta tarefa. A lacuna de identidade Gnomon/METU anteriormente documentada não foi alterada.

Critério confirmado para a adaptação seguinte: **Perfil da organização → departamentos/unidades → pessoas afetas à entidade**, reutilizando racional, tabelas e serviços existentes, com isolamento por entidade e identidade C4G. Pessoas registadas e contas de acesso não são presumidas equivalentes; membership central continua a autoridade de acesso. Nenhuma implementação desses domínios neste recorte. O trabalho paralelo de plataforma local e todo o residual foram preservados.
