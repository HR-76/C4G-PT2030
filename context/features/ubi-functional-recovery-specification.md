# Recuperação funcional UBI → C4G

Data: 2026-11-02. Estado: **Draft — especificação consolidada; implementação não iniciada**.

Pedido: consolidar as diferenças identificadas na comparação com GCNI_UBI, começando pela importação central e pelos filtros em falta, antes de alterar a aplicação. O pedido autoriza esta documentação; não ativa importações, recolhas, publicação ou migrações.

## 1. Objetivo e enquadramento

Orientação de execução confirmada em 02/11/2026: a C4G é o fornecedor da plataforma e exerce o papel de Super Admin; administradores das empresas clientes gerem a respetiva organização. Trabalhar uma componente de cada vez, privilegiando integração do código existente, melhoria funcional e UI/UX. Cada entrega deve indicar o resultado, a validação, limitações materiais e um único próximo passo concreto. Primeiro incremento iniciado: [disponibilidade da importação central](central-import-availability-experience.md).

Recuperar capacidades úteis do piloto que ainda não estão disponíveis no percurso C4G, preservando catálogo central, dados privados das organizações, histórico e componentes já implementados. Login excluído.

Este documento é um complemento aos planos de recuperação anteriores, não uma reabertura dos seus fechos nem uma declaração de paridade integral. Não substitui `current-work.md`: na conferência final, esse ficheiro já indicava Complete e ausência de trabalho ativo, com áreas de intervenção como última entrega. Esse estado foi preservado. Os detalhes ainda propostos abaixo não são decisões de produto implicitamente aprovadas.

Contratos relacionados:
- [Propriedade central da importação Portugal 2030](portugal2030-platform-ownership.md), que prevalece sobre o destino privado da [entrega histórica de importação](c4g-pilot-parity-delivery-4-portugal2030.md).
- [Áreas de intervenção em curso](catalog-intervention-areas.md) e [plano de descoberta](catalog-discovery-improvement-plan.md).
- [Criação manual central](central-manual-opportunity-authoring.md), [interesse organizacional](organizational-opportunity-interest.md) e [pipeline](application-pipeline.md).
- [Plano funcional anterior](c4g-functional-recovery-plan.md), [arquitetura](../architecture.md), [produto](../project-overview.md) e [standards](../coding-standards.md).

## 2. Baseline observado e destino da recuperação

Referência UBI: `../../../GCNI_UBI/GCNI_C4G-main`, relativa a este documento. Caminhos C4G abaixo relativos à raiz do repositório.

| Capacidade | Evidência atual | Decisão de planeamento |
|---|---|---|
| Importação central | `frontend/src/api/api.js`: `platformImportsApi.list` termina em `CENTRAL_IMPORT_NOT_CONFIGURED`; `frontend/src/pages/Import.jsx` usa esse cliente | Completar composição central; não encaminhar para o motor privado |
| Preparação central PT2030 | `backend/src/portugal2030/centralImport.js` tem `preview` e `stage`, com documento central verificado e digest | Reutilizar; preparação/staging não prova publicação no catálogo |
| Importação privada anterior | `backend/src/opportunityImports/`, `ImportWorkspace` e testes existentes | Reaproveitar componentes compatíveis; preservar dados e não os publicar automaticamente |
| Fonte no Catálogo | UBI tinha filtro; `frontend/src/pages/Opportunities/catalogFilters.js` não inclui fonte | RF-02: filtro de fonte no catálogo comum |
| Área na lista de pessoas | UBI `frontend/src/pages/Investigators.jsx` filtrava áreas; C4G `OrganizationProfile.jsx` filtra pesquisa/unidade/estado | RF-03: filtro de área e competências na lista |
| Matching | `Organization/MatchingWorkspace.jsx` e `backend/src/organizationDirectory/thematicAreas.js` já implementam os dois sentidos | Preservar motor e explicação; não copiar motor antigo |
| Alertas de descoberta | UBI `backend/src/services/notificationService.js` contém seleção por matching e envio; não foi encontrado produtor equivalente C4G | Incremento posterior; etiquetas na interface não comprovam geração |
| Ficha de unidade | UBI `ResearchCenterDetail.jsx` agrega pessoas/candidaturas; C4G distribui informação entre diretório e relatório | Incremento posterior, sem estrutura universitária fixa |
| Edição e áreas | UBI tinha edição da oportunidade e CRUD de áreas; interface central atual expõe criação/consulta | Especificar correção editorial e governação, sem sobrepor fontes |
| Candidaturas/parceiros | Ficha, pessoas, equipa, tarefas, revisão documental e históricos já existem na C4G | Melhorar percurso e apresentação; diretório reutilizável é evolução adicional |
| Dashboard/notificações operacionais | Relatórios por unidade/estado, CSV, alertas de candidatura e comunicações já existem | Preservar; não duplicar módulos |
| Integrações | Funding & Tenders, CORDIS, Erasmus+, Interreg Europe e POCTEP representados em `FundingTenders.jsx` | Validar operação/cobertura; presença em código não prova serviço ativo |

## 3. Primeira entrega: importação central e filtros

### Requisito transversal confirmado — fontes oficiais e edição pelo Super Admin

Clarificação do utilizador em 02/11/2026: manter a consulta por links às fontes oficiais e permitir ao Super Admin completar/corrigir informação em falta. Estas capacidades ficam confirmadas no âmbito funcional; o documento continua Draft quanto ao plano técnico e às decisões D1–D3. Não foram implementadas nesta atualização.

**RF-00 — Consulta das fontes oficiais**
- Preservar a ação «Consultar fonte oficial» na ficha da oportunidade, acessível aos leitores autorizados, incluindo nos percursos de interesse/candidatura onde já existe contexto da oportunidade.
- Conservar o link original recolhido/importado e as referências oficiais adicionais existentes. Mostrar a fonte de forma reconhecível; não substituir a consulta oficial por texto copiado ou pela ficha interna.
- Permitir ao Super Admin adicionar/corrigir o endereço de consulta e referências oficiais de suporte. Se substituir um endereço inválido ou desatualizado, conservar o anterior no histórico e usar o corrigido na ação de consulta.
- Validar URLs HTTP/HTTPS, recusar esquemas executáveis e não fabricar endereços quando a fonte não os fornece. Link ausente deve ser apresentado como «Fonte oficial por indicar», com possibilidade de preenchimento administrativo.
- Um link introduzido manualmente mantém essa proveniência; a aplicação não deve afirmar verificação oficial automática apenas por ter sido guardado. A indisponibilidade temporária do site externo não elimina o endereço nem bloqueia a consulta dos dados já disponíveis.

**RF-08A — Completar e corrigir a oportunidade pelo Super Admin**
- Disponibilizar «Editar informação» na ficha central para o Super Admin (`C4G_ADMIN`), tanto em oportunidades manuais como importadas/recolhidas. A autorização é validada no servidor; utilizadores das entidades continuam apenas com consulta do catálogo comum.
- Permitir editar informação descritiva/de negócio disponível no modelo: título, descrição, objetivos, programa/financiador, elegibilidade/beneficiários, âmbito geográfico, datas e natureza dos prazos, valores e respetivo significado, e links oficiais. A matriz técnica deve enumerar campos suportados e validações; não criar campos fictícios para preencher lacunas.
- IDs técnicos, identidade da fonte, recibos de importação e eventos de auditoria não são campos de edição livre. Corrigir informação não deve mudar a identidade da oportunidade nem quebrar interesses/candidaturas associados.
- Guardar o original recolhido e a intervenção editorial separadamente, com autor, data, motivo e valores anteriores/novos. Na consulta, identificar de forma discreta os dados completados/corrigidos pela C4G, sem os apresentar como transcrição da fonte.
- Novas recolhas não apagam silenciosamente a intervenção humana. Uma divergência entre atualização oficial e valor editorial deve ser apresentada ao Super Admin para reconciliação; permitir voltar ao valor da fonte através de uma nova ação auditada.
- Alterações produzem uma revisão central nova. Interesse/candidatura históricos mantêm a revisão de origem e usam o mecanismo de aviso de atualização; não modificar retroativamente os seus snapshots.
- Validar datas, montantes e URLs; distinguir desconhecido, previsto e confirmado. Edição concorrente deve pedir releitura em vez de perder alterações; repetição do mesmo envio não cria revisões duplicadas.

**Aceitação adicional:**
| ID | Resultado exigido | Validação |
|---|---|---|
| O1 | Links oficiais existentes continuam consultáveis após importação, edição e nova recolha | Testes de apresentação e preservação das referências; ensaio com fixture de URL |
| O2 | Super Admin completa um registo incompleto e clientes veem os dados publicados com proveniência | Testes de autorização, persistência e leitura pelos dois perfis |
| O3 | Conta de entidade não altera informação central nem links | Recusa HTTP, mesmo em pedido direto |
| O4 | Atualização oficial divergente não apaga edição humana; resolução fica auditada | Testes de reconciliação com revisões e valores anteriores/novos |
| O5 | Candidaturas/interesses anteriores conservam origem; novo leitor recebe revisão atual | Teste de integração com snapshots e aviso de atualização |
| O6 | URL inválida, ausência de link, conflito concorrente e repetição têm tratamento explícito | Testes de validação e recuperação na interface |

RF-00 é transversal a RF-01–03. RF-08A deixa de ser apenas uma sugestão posterior e passa a requisito confirmado a planear em conjunto com a importação, pois condiciona a proteção de correções nas reimportações. A gestão geral de taxonomias continua separada em RF-08B.

### RF-01 — Importação Portugal 2030 central

**Utilizador e destino:** Administração C4G em `/administracao/importar`, sem seleção de organização. Catálogo central como destino; clientes consultam apenas oportunidades publicadas e autorizadas.

**Percurso funcional proposto:**
1. Consultar disponibilidade real do serviço. Se indisponível, identificar a dependência e desativar upload; não mostrar histórico vazio como se tivesse sido consultado.
2. Descarregar modelo XLSX compatível com o parser/mapping central selecionado, com folha de instruções distinguida da folha de dados. Recuperar a geração UBI como referência, não como formato automaticamente válido.
3. Carregar `.xlsx`, conservar o original em armazenamento central protegido e aguardar verificação. Ficheiros rejeitados nunca chegam ao processamento de negócio.
4. Escolher explicitamente a folha; validar cabeçalhos, linhas, datas, montantes e identificadores. Mostrar correspondências, campos ignorados e decisões necessárias para colunas desconhecidas.
5. Apresentar pré-visualização com números físicos das linhas, erros e classificação dos resultados. Não criar/publicar oportunidades nesta fase.
6. Confirmar exatamente o original, folha, versão de mapping e digest revistos. Mudança de qualquer elemento invalida a confirmação anterior.
7. Preparar/processar o lote com chave idempotente. A transição de staging para publicação depende da decisão D1 abaixo; não confundir lote preparado com catálogo atualizado.
8. Mostrar resultado e histórico: criadas/publicadas, atualizadas, sem alteração/duplicadas, em revisão e rejeitadas, conforme capacidades efetivamente implementadas. Retomar operações sem repetir efeitos; disponibilizar relatório por linha.

**Invariantes:**
- Nunca chamar a importação privada como alternativa à indisponibilidade central; não migrar lotes ou oportunidades históricas sem plano próprio.
- Fonte, identificador externo, documento original e revisões permanecem rastreáveis. Não sobrescrever correções editoriais silenciosamente.
- Preservar limites existentes dos componentes reutilizados; confirmar compatibilidade dos limites centrais antes de expor o formulário. O serviço central inspecionado limita o ficheiro a 10 MiB; não assumir que todos os limites do motor privado se aplicam ao central.
- Não interpretar datas previstas como datas oficiais, valores ausentes como zero ou orçamento como financiamento atribuído. Recuperar a matriz completa de colunas do formato central atual, sem regressar ao parser privado que ignorava parte dos campos.
- Cancelamento não desfaz publicações concluídas; comportamento após início do processamento deve ser explícito e compatível com o worker.
- Autoridade C4G atual verificada no servidor em upload, consulta, confirmação, processamento e download. Nenhum acesso implícito aos dados privados dos clientes.

**Aceitação e prova:**
| ID | Resultado exigido | Validação |
|---|---|---|
| I1 | Administrador C4G acede sem entidade; conta de cliente não carrega, confirma ou descarrega lotes centrais | Testes HTTP/autoridade e ensaio com os dois perfis |
| I2 | Modelo descarregado pode ser importado sem alteração de cabeçalhos | Teste de ida e volta com parser central e folha de exemplo |
| I3 | Pré-visualização não modifica o catálogo; original/folha/digest divergentes são recusados | Testes de contrato e integração com contagens/revisões |
| I4 | Repetição e retoma não duplicam oportunidades nem publicações | Testes de idempotência, concorrência, falha e recuperação do worker |
| I5 | Colisões, atualizações e rejeições seguem D2; relatório corresponde ao lote | Casos sintéticos de IDs repetidos, alterações, datas e montantes |
| I6 | Serviço indisponível, scan rejeitado e falha de histórico têm estados distintos e recuperáveis | Testes de interface; desktop/móvel |
| I7 | Publicação aprovada torna a oportunidade visível a duas organizações sem revelar dados privados | Percurso integrado central → catálogo em ambiente isolado autorizado |

**Componentes a avaliar no plano técnico:** `Import.jsx`, `Imports/ImportPresentation.jsx`, `api.js`, rota administrativa de disponibilidade, `portugal2030/centralImport.js`, parser/mapping central, arquivo/staging/publicação, armazenamento/scan, worker e auditoria. Só propor migrations depois de inventariar os contratos e esquemas efetivamente disponíveis.

### RF-02 — Filtro por fonte no Catálogo

- Adicionar seletor «Fonte», de seleção única e opção «Todas as fontes», à consulta comum de administração e entidades.
- Usar códigos estáveis do catálogo e labels existentes; não confundir fonte com programa nem inventar uma fonte a partir do título.
- Combinar por **E** com texto, programa, área de intervenção, estado temporal e datas. O estado inicial continua sem restrição de fonte.
- Aplicar no servidor antes da paginação; preservar filtro na URL, ida/volta à ficha e atualização da página. Alterar filtros reinicia o cursor; fonte inválida não é silenciosamente ignorada.
- Preservar a semântica atual de «Exportar página»: exportar os resultados visíveis filtrados, sem anunciar exportação do universo completo.
- Reutilizar infraestrutura de filtros C4G e labels UBI quando compatíveis. Não reabrir a classificação de áreas em curso.

**Aceitação F1–F4:** combinações corretas entre dimensões; paginação sem omissões/duplicação; retorno/URL/exportação coerentes; mesmos resultados públicos autorizados para C4G e cliente. Testar fontes distintas, fonte sem resultados e código inválido, incluindo backend e interface.

### RF-03 — Filtro por área temática nas pessoas

- Adicionar seletor «Área temática» com seleção única e «Todas as áreas» à lista de pessoas da organização.
- Utilizar IDs da taxonomia de perfis/matching já existente; não usar famílias de intervenção do Catálogo como equivalentes.
- Combinar por **E** com pesquisa, unidade e estado; filtrar no servidor antes da paginação. Pessoas com várias áreas surgem uma única vez.
- Apresentar competências na lista com leitura compacta e acesso à ficha completa; não fazer uma consulta por pessoa para obter áreas.
- Manter o âmbito autorizado da organização e não criar acesso a perfis por causa de uma correspondência temática. Não alterar o motor de matching.

**Aceitação P1–P4:** seleção encontra pessoas com a área mesmo em páginas posteriores; área inválida é recusada; pessoas sem áreas continuam acessíveis em «Todas»; pesquisa/unidade/estado e isolamento entre organizações mantêm-se. Validar perfis com várias áreas, inativos e sem competências, contratos e interface.

## 4. Incrementos seguintes, sem implementação nesta entrega

| Incremento | Resultado pretendido | Decisão/critério antes de implementar |
|---|---|---|
| RF-04 Interesse → candidatura e parceiros | Próxima ação clara; ficha organizada; melhorar formulário/cards existentes | Preservar criação explícita, histórico e parceiros apenas informativos; definir campos adicionais |
| RF-05 Diretório reutilizável de parceiros | Selecionar entidade existente sem repetir contactos | Evolução além da paridade UBI: identidade/deduplicação, propriedade privada e snapshot da associação a decidir; sem acesso externo |
| RF-06 Ficha de unidade | Pessoas, candidaturas, prazos e indicadores no mesmo percurso | Distinguir unidade principal do responsável de unidades explicitamente associadas à candidatura; não somar duas vezes |
| RF-07 Alertas de descoberta | Avisar sobre novas oportunidades relevantes e encaminhar para interesse | Definir destinatários, canais, frequência, preferências, reabertura/alteração e deduplicação; distinguir matching de elegibilidade |
| RF-08B Gestão de taxonomias | Gerir áreas/palavras-chave e rever classificações | Definir governação, versões e separação das duas taxonomias; edição de oportunidades já confirmada em RF-08A |
| RF-09 Pipeline | Ligar transições aos requisitos de tarefas/documentos/revisão | Definir primeiro etapas e bloqueios mínimos; configurador genérico não integra RF-01–03 |

## 5. Decisões materiais por fechar

**D1 — Confirmação e publicação central.** Verificar contrato vigente do arquivo/aceitação e decidir se a confirmação prepara um lote para aprovação separada ou também autoriza publicação. Proposta: reutilizar o percurso central de aceitação existente, mantendo pré-visualização, preparação e publicação distinguíveis. A presença de `stage()` não autoriza publicação automática.

**D2 — Reimportação e conflitos.** Formalizar para mesmo identificador/fonte: sem alteração, nova revisão ou revisão humana, incluindo colisão com registo manual. A preservação de correções editoriais e links oficiais fica obrigatória por RF-00/RF-08A; falta detalhar o mecanismo de reconciliação e a matriz de campos. Reutilizar regras centrais existentes onde já aprovadas; não copiar o upsert legado.

**D3 — Modelo e matriz de dados.** Confirmar versão do formato PT2030 suportado e correspondência completa de colunas com o modelo central atual antes de gerar o ficheiro-modelo. O modelo UBI serve como referência, não como fonte de verdade.

D1–D3 condicionam a implementação/publicação de RF-01, mas não impedem planear tecnicamente RF-02 e RF-03. Decisões dos incrementos posteriores só serão pedidas quando forem selecionados para execução.

## 6. Sequência de execução proposta

1. Preservar a entrega de áreas do Catálogo, entretanto registada como concluída em `current-work.md`. Atualizar o baseline e consultar a sua evidência antes de editar ficheiros partilhados.
2. Inventariar a composição central de importação e reconciliar D1–D3 com contratos já aprovados; produzir matriz de colunas/campos editáveis, proteção dos links oficiais e mapa de dependências, incluindo RF-08A. Não ativar serviços nesta preparação.
3. Implementar RF-01 por camadas: disponibilidade e documento central → modelo/preview → confirmação/staging → publicação autorizada → resultado/histórico/retoma. Declarar separadamente preparação de código e operação real.
4. Implementar RF-02 e RF-03 com contratos de consulta e testes antes da apresentação final, aproveitando os componentes existentes.
5. Implementar RF-08A conforme o contrato de revisões/reconciliação definido com RF-01; validar a edição e a preservação dos links oficiais antes de declarar completa esta entrega ampliada. Registar limitações e só então selecionar os incrementos posteriores. Não marcar a recuperação global concluída por entregar apenas os filtros.

## 7. Verificação e limites deste documento

Nas análises anteriores desta conversa passaram 72 testes focados de interesses/candidaturas/parceiros e 85 de Catálogo/matching/diretório/notificações/importação/integrações. São evidências da base inspecionada, não provas dos requisitos novos nem da operação dos serviços externos. Nenhum destes testes foi reexecutado para a edição documental.

Para implementação: testes de regressão/contrato focados, suites exigidas pelos standards, sintaxe backend e build frontend; ensaio desktop/móvel dos percursos. Integração com armazenamento, scan, worker e bases apenas em âmbito isolado autorizado; dados sintéticos identificados. Confirmar ausência de escrita cruzada entre central e tenants e preservação das oportunidades históricas.

Fora do âmbito: login, cópia integral do backend UBI, migração silenciosa, eliminação automática, submissão aos financiadores, convites de parceiros, novos conectores e ativação de fontes/recolhas. Esta especificação não altera código, dados, configurações ou o estado do trabalho ativo.

**Próximo passo:** preparar o plano técnico de RF-01, reconciliando D1–D3 e identificando os adaptadores centrais existentes antes de iniciar implementação.
