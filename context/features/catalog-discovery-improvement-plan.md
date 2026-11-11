# Catálogo e descoberta — plano de melhoria

Estado: **Draft**. Plano solicitado em 01/11/2026; implementação não iniciada por este trabalho. Objetivo confirmado: tratar a descoberta como componente central da APP, acrescentar filtro por áreas ao Catálogo e articular com o Matching existente. As propostas de comportamento abaixo precisam de confirmação antes da respetiva implementação.

## Resultado pretendido

O utilizador encontra oportunidades por pesquisa, área e programa, compreende rapidamente os dados essenciais, consulta correspondências com o perfil e regista interesse sem perder o contexto. A descoberta funciona mesmo sem perfil temático preenchido. O catálogo mantém cobertura de todas as fontes autorizadas; relevância temática não certifica elegibilidade.

Separar explicitamente três conceitos:

- **Áreas do Catálogo:** seleção temporária para explorar oportunidades, independente do perfil pessoal.
- **Matching:** correspondências explicadas a partir das áreas/interesses do perfil e regras determinísticas.
- **Interesse numa oportunidade:** vínculo privado da organização para acompanhamento, já existente; não é área temática nem favorito a duplicar.

## Nova análise do concorrente

Reconsulta em 01/11/2026. Homepage voltou a devolver 403; acesso parcial a páginas indexadas e PDFs públicos. Sem autenticação, testes de navegação, mobile, entrega de newsletters ou avaliação da área paga. Não atribuir ao concorrente filtros interativos, matching, pesquisas guardadas ou workflow de candidaturas que não foram comprovados.

| Evidência pública | Aprendizagem aplicável |
| --- | --- |
| [Innovation](https://eufundingportal.eu/lv/inov%C4%81cijas/?print=pdf): coleção temática, resumos e anúncio de newsletter | Entradas por áreas ajudam a descobrir sem conhecer o nome do programa. |
| [Research](https://eufundingportal.eu/research/?print=pdf): conteúdo temático encontrado no índice; abertura direta bloqueada | Exploração por intenção/tema complementa a pesquisa textual. |
| [Funding for businesses](https://eufundingportal.eu/funding-for-businesses/?print=pdf): coleção por destinatário e resumos que distinguem, em exemplos, dotação total e apoio individual | Conteúdo legível e segmentação, sem misturar os significados financeiros. |
| [Grantwatch](https://eufundingportal.eu/de/Grantwatch/?print=pdf): diretório de programas, analisado no benchmark anterior | Atalhos por programa e orientação breve. |
| [EU Calls for Applications](https://eufundingportal.eu/eu-calls-for-applications/?print=pdf): newsletter e acesso por subscrição, analisados anteriormente | Descoberta recorrente; pesquisas guardadas são proposta C4G, não capacidade confirmada do concorrente. |

Não copiar a proliferação de páginas para dentro da APP. Usar um catálogo único, filtros combináveis e URLs que preservam o estado. Um portal público/SEO é decisão comercial posterior. Ver também [benchmark inicial](../research/eufundingportal-benchmark-2026-11-01.md).

## Evidência da APP e limites

- `frontend/src/pages/Opportunities/CentralOpportunities.jsx` e `catalogFilters.js`: pesquisa, programa, datas/estado temporal, paginação e filtros na URL.
- `backend/src/fundingTenders/catalogQuery.js`: contrato atual só admite cursor, q, programme, closingFrom, closingTo e temporalState. Filtro por áreas exige evolução backend e cliente; filtrar apenas a página no browser é incorreto.
- `frontend/src/pages/Organization/MatchingWorkspace.jsx`: Matching por perfil próprio/pessoa e por oportunidade; explica áreas e palavras correspondentes; distingue perfil não associado e sem áreas.
- `backend/src/organizationDirectory/thematicAreas.js`: classificador determinístico, `minScore:1`, `maxSuggestions:3`, versão `c4g-pilot-areas-v1`. IDs existentes derivam de versão/nome e devem ser preservados. O Matching também aplica regras temporais próprias; igualdade de resultados com o Catálogo depende dos mesmos critérios.
- `backend/src/organizationDirectory/thematicCatalog.js`: catálogo atual de 30 áreas, com palavras-chave. É implementação existente, não seed universal aprovado para o produto.
- [Taxonomia F13 aprovada](../decisions/f13-thematic-taxonomy.md): conceitos estáveis, releases imutáveis, namespaces separados, mappings explícitos. Não permite converter labels/códigos por semelhança nem alterar implicitamente o scoring.
- [Primeira análise](opportunity-first-analysis.md): trabalho em curso; preservar cinco grupos essenciais, dotação da call e ligação oficial. Áreas entram na barra de filtros; não voltar a sobrecarregar a ficha com classificações/diagnósticos.
- Interesses já têm componentes e fluxo próprios; alertas de candidaturas não equivalem a alertas de descoberta. Não foi executado ensaio runtime nem inventário da base neste planeamento.

## Plano ordenado

### P0 — Base fiável e contrato temático

**Entrega:** inventário de dados e mapa de compatibilidade entre áreas atuais, oportunidades e taxonomia aprovada.

1. Reconciliar o estado da primeira análise e concluir a sua validação no trabalho próprio, preservando alterações concorrentes.
2. Medir, por fonte e estado temporal: oportunidades classificáveis, sem texto, sem correspondência, com múltiplas áreas e potencialmente afetadas pelo limite de três. Usar dados autorizados e leitura apenas; não reativar conectores.
3. Rever uma amostra estratificada EU/PT2030/Interreg/manual, com casos multitemáticos e vocabulário português/inglês. Distinguir ausência de evidência de ausência de relevância.
4. Produzir proposta de seed/mapping para validação editorial, preservando IDs e perfis existentes. Conceitos privados não passam para a Central.
5. Propor classificação global versionada derivada apenas de dados comuns; separar classificação oficial/editorial de sugestão por palavras-chave. Nenhuma alteração retroativa dos snapshots.

**Aceitação:** inventário reproduzível, denominadores e limitações explícitos; exemplos de falsos positivos/negativos revistos; mapping aprovado antes de migrar; todo registo não mapeado continua acessível. Sem metas percentuais inventadas antes de medir.

### P1 — Filtro por áreas no Catálogo (primeira entrega funcional prioritária)

**Entrega:** seletor pesquisável de áreas, seleção múltipla, filtros ativos removíveis e limpeza simples.

Comportamento proposto para aprovação:

- Dentro das áreas, **OU**: Energia ou Ambiente. Entre dimensões, **E**: áreas selecionadas e programa e prazo e texto.
- Estado inicial sem restrição temática. Alterar áreas não edita interesses do perfil nem recalcula/salva configurações de Matching.
- Consulta por conceitos explícitos; sem expansão automática de subáreas na primeira versão. Eventual inclusão de descendentes terá controlo e regra explícitos.
- «Sem classificação» como opção exclusiva da seleção de áreas, para permitir descobrir lacunas. Não significa «não elegível».
- IDs/versão nos contratos; labels apenas para apresentação. Área desconhecida/depreciada recebe tratamento explícito; nunca ignorar silenciosamente um filtro inválido e devolver tudo.
- URL preserva áreas e restantes filtros ao abrir/voltar à ficha, atualizar ou partilhar entre utilizadores autorizados. Mudança de filtros reinicia cursor.
- Opções e eventuais contagens são calculadas sobre o universo autorizado no servidor, nunca só sobre a página recebida. No MVP podem omitir-se contagens até existir implementação eficiente e sem ambiguidades.

**Aceitação:** oportunidade que só aparece em página posterior é encontrada pelo filtro; seleção múltipla não duplica linhas; combinação com programa/prazo funciona; limpar restaura consulta sem áreas; teclado e mobile utilizáveis; desconhecidos e dados em falta tratados; catálogo consultável sem perfil; mesmas permissões e isolamento.

### P2 — Articulação com Matching e interesses

**Entrega:** navegação consistente entre exploração, correspondência e acompanhamento.

1. Manter Matching atual como funcionalidade própria e preservar resultados durante a primeira entrega do filtro.
2. Acrescentar, após aprovação, «Usar as áreas do meu perfil» no Catálogo: preenche filtros visíveis e editáveis; não é uma promessa de igualdade com o Matching completo. Sem perfil/áreas, permitir continuar a explorar e oferecer acesso ao perfil.
3. Preservar contexto de retorno ao abrir Matching de uma oportunidade e ao registar/ver interesse.
4. Testar paridade semântica quando classificação, versão, áreas, universo e regras temporais coincidirem. Divergências por versão, top-3 ou datas têm causa explícita; não ocultar através de alterações silenciosas do algoritmo.
5. Qualquer eliminação do limite de três, alteração de regras ou migração do Matching será incremento separado, com versão e comparação antes/depois.

**Aceitação:** nenhum perfil é alterado pela pesquisa; interesse não é duplicado; técnico continua limitado à equipa nas candidaturas; mudanças de sessão descartam dados privados; regressões provam estabilidade do Matching anterior.

### P3 — Pesquisas guardadas e descoberta recorrente

**Entrega:** guardar uma combinação de filtros com nome, reabrir, editar e arquivar; depois alertas na aplicação.

Proposta inicial: pesquisas pessoais no âmbito da organização, sem partilha automática. Confirmar antes de implementar. Definir eventos separados para «nova oportunidade» e «alteração relevante», baseline inicial sem inundação de alertas históricos, deduplicação e efeito de reclassificação. A revogação de membership termina acesso e distribuição.

Email é subfase própria: preferências de frequência, cancelamento, worker/outbox, retries e idempotência. Não reutilizar como scheduler o check de prazos durante sessão. Não anunciar novidades com uma fonte parada/desatualizada como se fossem atuais.

**Aceitação:** consulta guardada reproduz filtros; mesma oportunidade/evento não gera duplicados; execução repetida é segura; fontes sem novidades não geram ruído; falha de entrega é observável; revogação e isolamento entre clientes testados.

### P4 — Apoio à decisão e orientação

Após observar uso de P1–P3, priorizar comparação de duas/três oportunidades pelos campos existentes e guias curtos por programa. Filtros por beneficiário/território só com dados e semântica validados, sem inferir elegibilidade de uma categoria. Portal público fica fora deste plano de execução inicial.

**Aceitação:** comparação preserva moedas, valores previstos, dotações múltiplas e ausências; não soma valores incompatíveis. Guias têm fonte e revisão identificáveis, sem substituir regras oficiais.

## Componentes, contratos e persistência

- Frontend: `CentralOpportunities.jsx`, `catalogFilters.js`, componentes de filtros, `api/api.js`; posteriormente `MatchingWorkspace.jsx` e percurso de interesses.
- Backend: `fundingTenders/catalogQuery.js`, `fundingTenders/repository.js`, `opportunities/v2/catalogSql.js`, adaptadores/rotas do catálogo e catálogo de operações autorizadas aplicável. Confirmar a composição concreta na especificação P1.
- Classificação: `organizationDirectory/thematicAreas.js`, `thematicCatalog.js`, `matching.js` e contratos F13/F14. Partilhar identidade e evidência quando compatíveis, sem fundir lógica de autorização ou scoring.
- Recomendação técnica a detalhar em P0: projeção/materialização de classificação versionada, indexável na Central, antes da paginação. Evitar descarregar o catálogo completo e classificar em cada GET. Não executar escritas na leitura.
- Se exigir persistência nova: migration central aditiva para classificação e índices; migrations tenant apenas para pesquisas/preferências privadas na P3. Estimar schema, custo e atualização só após inventário; nenhuma SQL está autorizada/executada por este plano.
- Dados editoriais centrais pertencem à administração C4G; interesses e perfis privados permanecem tenant. Cada entrega admite desativação funcional sem apagar classificações, perfis, pesquisas ou histórico.

## Verificação e critérios de lançamento

Para cada incremento: contrato próprio com critérios; regressões antes das correções; testes focados, suites backend/frontend, `node --check` nos JS backend alterados e build frontend. Falhas anteriores/concorrentes registadas separadamente. Gates PostgreSQL/tenancy com infraestrutura e SQL exigem ambiente isolado e autorização própria.

P1 exige testes de parsing, combinação de filtros, classificação desconhecida, paginação, deduplicação, versões, permissões, isolamento, navegação e acessibilidade. Medir latência p50/p95 e custo SQL com catálogo representativo e comparar com baseline sob igual carga; fixar orçamento de regressão antes de implementar. Validar reclassificação e falhas de atualização sem publicar resultados parciais como completos.

Ensaios funcionais com gestor e colaborador: encontrar oportunidade por área fora do perfil; combinar área/programa/prazo; explorar sem perfil; abrir Matching; registar interesse; voltar sem perder filtros. Medir sucesso/tempo destas tarefas, pesquisas sem resultados e conversão para interesse, sem recolher texto privado desnecessário. A melhoria só se considera concluída com evidência funcional e de dados, não apenas com um seletor visível.

## Decisões materiais antes da implementação

1. Aprovar seed/mapping temático e responsável editorial após P0; não assumir as 30 áreas atuais como taxonomia final.
2. Confirmar P1: OU entre áreas, E entre dimensões, sem expansão hierárquica implícita e opção exclusiva sem classificação.
3. Confirmar como apresentar sugestões lexicais versus classificação validada; recomendar não promover sugestões a factos oficiais.
4. Confirmar pesquisas pessoais e política de alertas apenas antes de P3; isto não bloqueia P0/P1.

Ordem recomendada: P0 → P1 → P2 → P3; P4 após avaliação. Sem datas fictícias: esforço e calendário dependem do inventário, mapping e persistência necessária. O estado mantém-se Draft porque essas decisões não foram tomadas pelo pedido de planeamento.

Next step: executar o diagnóstico de cobertura P0 e fechar o contrato do filtro por áreas P1 com base nos resultados.
