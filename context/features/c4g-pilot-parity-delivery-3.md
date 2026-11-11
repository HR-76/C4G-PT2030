# Entrega 3 — candidaturas completas do piloto

Data: 2026-10-17. Estado: **In Progress — estados/campos e lista ativos; parceiros/contactos ativos e validados**. Pedido: preparar a entrega 3 a partir das páginas originais, preservando as tarefas existentes. Âmbito superior: [plano de recuperação](c4g-pilot-parity-action-plan.md). Entregas [1](../history/c4g-pilot-parity-delivery-1.md) e [2](../history/c4g-pilot-parity-delivery-2.md) concluídas.

A recuperação funcional está autorizada no plano geral. O utilizador confirmou criação em Identificada e liberdade de avanço/recuo entre etapas abertas; o incremento de estados e campos foi depois autorizado expressamente para implementação. Os resultados de validação são registados separadamente. A ligação documental é trabalho necessário desta entrega, não motivo para omitir anexos do critério de conclusão.

Parceiros/contactos implementados conforme [contrato HTTP](../references/application-partners-http.md), com [provas e comparação](../reviews/c4g-pilot-parity-delivery-3-partners.md). A migração 028 foi aplicada após autorização explícita, com backup e preservação dos dados; verificação OIDC habitual PASS. Anexos reais pendentes.

## Resultado pretendido e fronteiras

Criar uma candidatura a partir de oportunidade central ou privada acessível; acompanhar preparação, registo de submissão e resultado; gerir prazo interno, dois orçamentos, notas, responsável, equipa, tarefas, parceiros/contactos e anexos no detalhe original recuperado. Reabrir a página conserva os dados e o histórico. Outra organização não consulta nem altera candidatura, contactos ou ficheiros.

Reutilizar composição e densidade do piloto, com marca C4G e vocabulário da organização. Não exigir Matching, perfil completo, publicação, avaliação ou revisão interna prévia para criar candidatura. Registar submissão/resultado é uma operação interna auditada; não envia uma candidatura ao financiador nem prova aprovação externa. Aprovação documental interna e aprovação pelo financiador são resultados distintos.

Arquitetura pretendida: domínio operacional na base da organização, identidade/membership central e documentos privados pelo serviço F11/R2. Implementação observada: estes domínios já têm partes construídas, mas candidaturas completas e transporte documental não estão ligados na instalação habitual. Controllers UBI são evidência funcional; não serão reativados como backend multi-instituição.

Fora desta entrega: IA/scoring, construtor de pipelines/configurações, novas regras automáticas ou tarefas por etapa, novas aprovações, submissão automática externa, notificações/integrações da entrega 4 e fecho integral do reporting da entrega 5. Preservar a revisão interna construída; não a tornar condição automática de mudança de estado. Sem migração de dados UBI, publicação, Git mutável ou eliminação física por inferência.

## Inventário verificado e reaproveitamento

Referência: commit `3a79b25539040c2024051cf9ab6295680b760277`. A comparação Git não apresentou diferenças nos três componentes de candidaturas, em `Partners.jsx`, `applicationUi.js` e no controller de candidaturas em relação a essa referência. Isto demonstra preservação local, não prova da última instalação histórica utilizada.

| Área | Piloto preservado | Runtime atual e trabalho necessário |
| --- | --- | --- |
| Lista | `ApplicationsList.jsx`: pesquisa, filtros, contagens/etapas, ordenação, oito colunas, mudança de estado e navegação | `App.jsx` escolhe `PrivateApplications` no runtime F12; lista reduzida a quatro colunas. Recuperar composição original, com paginação, filtros e totais autorizados no servidor. |
| Criação | `ApplicationForm.jsx`: oportunidade, título, prazo interno, notas e dois orçamentos | API atual exige responsável/membership e prazo, aceita origem central/revisão exata ou privada e avaliação opcional. Reutilizar seletor atual, acrescentar campos e adaptar formulário; preservar criação direta. |
| Detalhe | `ApplicationDetail.jsx`: ficha, próximo passo, estados, orçamento, notas, anexos, equipa, parceiros e histórico | Reaproveitar estas secções e incorporar `ApplicationWork` e `ApplicationDocumentsReview`; não substituir os fluxos atuais por chamadas legacy. |
| Estados | Sete valores no controller; criação efetiva em `INTERESSE`, não `IDENTIFICADO`. O stepper apresenta apenas parte dos estados. | `contracts.js` e migration 021 admitem `INTENTION`, `PREPARATION`, `CANCELLED`, `ARCHIVED`. Alargar sem recodificar registos/histórico. |
| Equipa/tarefas | Coordenador, membros, contactos e papel; centros UBI | Migração 022 e `work.js` já guardam participantes/memberships, tarefas e histórico. Reutilizar; unidades/pessoas da entrega 2 apenas como informação autorizada. |
| Parceiros | Ficha e pessoas/contactos por candidatura; página agregada com pesquisa, país e papel | Domínio tenant equivalente em falta. Criar persistência e consultas autorizadas; parceiro não vira cliente C4G nem conta. |
| Anexos/revisão | Selecionar ficheiro, nome/tamanho/autor/data, descarregar e remover | Migração 023 guarda vínculos exatos e revisão interna. UI atual seleciona versões pré-existentes, não oferece upload completo. `productionDocuments.js` devolve handlers vazios; transporte exige integração. |

Fontes: [rotas frontend](../../frontend/src/App.jsx), [lista original](../../frontend/src/pages/Applications/ApplicationsList.jsx), [formulário](../../frontend/src/pages/Applications/ApplicationForm.jsx), [detalhe](../../frontend/src/pages/Applications/ApplicationDetail.jsx), [parceiros](../../frontend/src/pages/Partners.jsx), [contratos atuais](../../backend/src/applications/contracts.js), [rotas atuais](../../backend/src/routes/applicationSliceRoutes.js), [cliente HTTP](../../frontend/src/api/api.js).

## Contrato funcional a recuperar

### Estados, datas e compatibilidade

Correspondência para implementação, mantendo os códigos existentes e acrescentando apenas os ausentes:

| Piloto | Código tenant | Apresentação / significado |
| --- | --- | --- |
| IDENTIFICADO | IDENTIFIED (novo) | Identificada; candidatura registada antes de manifestar intenção |
| INTERESSE | INTENTION (existente) | Intenção de candidatura; equivalente funcional de Interesse |
| PREPARACAO | PREPARATION (existente) | Em preparação |
| SUBMISSAO | SUBMITTED (novo) | Submetida; registo interno da submissão, não envio automático |
| APROVADO | APPROVED (novo) | Aprovada pelo financiador |
| REJEITADO | REJECTED (novo) | Rejeitada pelo financiador |
| CANCELADO | CANCELLED (existente) | Cancelada; sem reabertura |
| Sem equivalente direto | ARCHIVED (existente) | Arquivada; sem reabertura |

**Estado inicial confirmado pelo utilizador:** `IDENTIFIED` — Identificada — em todas as novas candidaturas, centrais ou privadas, incluindo criação iniciada pela ação Registar interesse. A intenção pode ser registada posteriormente por transição explícita para `INTENTION`. A decisão substitui a recomendação anterior de conservar o estado inicial atual. A premissa «como no piloto» da opção apresentada estava incorreta e foi esclarecida: `applicationController.js:323` cria em `INTERESSE`. Identificada é a escolha expressa para a entrega 3, não uma descrição retroativa do piloto.

**Transições confirmadas:** permitir avanço e recuo entre etapas abertas, sempre com motivo e histórico. Não exigir passagem sequencial por todas as etapas. Matriz do recorte preparado:

| Estado atual | Destinos permitidos |
| --- | --- |
| IDENTIFIED | INTENTION, PREPARATION, SUBMITTED, CANCELLED, ARCHIVED |
| INTENTION | IDENTIFIED, PREPARATION, SUBMITTED, CANCELLED, ARCHIVED |
| PREPARATION | IDENTIFIED, INTENTION, SUBMITTED, CANCELLED, ARCHIVED |
| SUBMITTED | IDENTIFIED, INTENTION, PREPARATION, APPROVED, REJECTED, CANCELLED, ARCHIVED |
| APPROVED | ARCHIVED |
| REJECTED | ARCHIVED |
| CANCELLED | Nenhum |
| ARCHIVED | Nenhum |

Mantém-se o limite do plano para resultados: aprovação/rejeição são registadas após submissão, sem nova capacidade de reabertura nesta entrega. Edição dos campos gerais conserva a guarda existente, recusando canceladas/arquivadas; editar dados de uma candidatura com resultado não muda esse resultado nem o respetivo evento histórico. Tarefas e revisão documental conservam contratos próprios e não recebem automatismos ou bloqueios adicionais.

**Compatibilidade:** candidaturas existentes mantêm estado, revisão, datas, tarefas e histórico, incluindo `INTENTION`; não executar atualização em massa para `IDENTIFIED`. Repetir um pedido de criação antigo conserva o resultado do recibo original e não cria nem reclassifica a candidatura. O novo estado inicial aplica-se a novas intenções de criação após a ativação da entrega 3.

Cada transição exige permissão, revisão esperada, motivo e histórico. O seletor da lista apresenta apenas destinos autorizados e pede motivo. A data do estado vem do evento de transição, nunca de qualquer edição do título. Guardar o instante do registo de submissão; não inferir a data real de envio nem apagar submissões anteriores quando houver correção/recuo. Eventos continuam a permitir reconstruir o percurso.

`deadline` atual permanece o prazo interno obrigatório da candidatura; o prazo da oportunidade é informação distinta e pode ser desconhecido. Não preencher um a partir do outro sem ação do utilizador. A lista recupera a coluna original de prazo da oportunidade e identifica o seu significado; detalhe/formulário mostram também o prazo interno.

### Orçamentos, notas, pesquisa e apresentação

- Recuperar orçamento total e orçamento da organização, opcionais e independentes da dotação da oportunidade; substituir a designação UBI pelo nome da organização. Reutilizar EUR do piloto, sem câmbio ou moedas novas nesta entrega.
- Persistência decimal exata e valores HTTP decimais canónicos, com até duas casas; rejeitar negativos, valores inválidos e arredondamento silencioso. Ausente é `null`, distinto de zero. Não impor proporções/financiamento ou preencher orçamento automaticamente. Fixar precisão/limites técnicos no contrato HTTP e migração antes de codificar.
- Notas editáveis e historizadas; campo limpo permite retirar o texto mantendo revisões passadas. O motivo de transição não substitui silenciosamente as notas gerais.
- Lista com título, oportunidade, estado, data do estado, responsável/coordenação, orçamento total, orçamento da organização e prazo; pesquisa/filtros/ordenação/paginação coerentes. As contagens incluem apenas candidaturas acessíveis e o âmbito dos filtros deve estar explícito.
- Nomes e ações conforme permissões reais. Falha de leitura não equivale a lista vazia ou total zero; mudança de entidade descarta resultados antigos. Manter intenção pendente e repetição do mesmo envio para resultado incerto.

### Equipa e tarefas — preservação obrigatória

Reutilizar [contrato de equipa/tarefas](application-team-tasks.md), `ApplicationWork`, `work.js` e tabelas 022. Responsável continua membership ativa; participantes não recebem grants. A ficha ligada da entrega 2 pode enriquecer nomes/unidades, sem tornar perfil pessoal obrigatório. Não criar ou inferir ligação pessoa–conta.

Preservar IDs, responsáveis, prazos, estados `OPEN → COMPLETED|CANCELLED`, participantes removidos/reativados, revisões, receipts e histórico. Sem reabertura automática, eliminação, duplicação ou conversão para outro sistema de tarefas. Atribuição de tarefa não exige participação na equipa. Suspensão da membership impede novas atribuições, conserva a referência histórica e permite reatribuir tarefa aberta por editor autorizado. Concluir uma tarefa não muda a candidatura. Novos estados de candidatura não introduzem bloqueios ou automatismos nas tarefas.

Responsável e membro são os papéis mínimos já representáveis. Preservar papéis documentados do piloto na apresentação quando existirem; não introduzir cadastro configurável nem converter contactos de parceiros em membros internos. A informação de unidades substitui Centros/Faculdades fixos da UBI.

### Parceiros e contactos

Ficha privada associada à candidatura: entidade, país, área/interesse, pessoa responsável, contacto/email e lista de pessoas com nome, papel, área e contactos. Recuperar criar, editar, consultar e retirar associação, com revisões e histórico. Conservar vocabulário de papéis existente sem tornar Investigador obrigatório ou presumir essa função para novas pessoas.

Página Parceiros agrega apenas vínculos de candidaturas autorizadas da organização atual, com ligação ao detalhe, pesquisa por entidade/pessoa/contacto/área e filtros originais. Países, contagens e opções de filtros usam o mesmo âmbito de acesso: a consulta global de países do controller antigo não pode ser reutilizada. Sem deduplicação global, partilha automática entre organizações ou cadastro central de contactos. Retirar parceiro/pessoa é operação lógica auditada, não o `DELETE`/recriação usado pelo piloto.

### Anexos e revisão interna

Recuperar interação simples: escolher ficheiro → acompanhar processamento → consultar/descarregar → retirar associação. Mostrar nome, tamanho, autor, data e versão. Nunca pedir ao utilizador IDs, capabilities ou chaves de armazenamento. Reutilizar F11 para intent, limites de conteúdo, transporte privado, confirmação, quarentena/scan, versões e acesso; não usar filesystem UBI nem aceitar ficheiro como limpo sem verificação.

Preservar [revisão interna existente](application-documents-internal-review.md): vínculo a versão exata, conjunto fixado, decisor distinto, grant próprio, comentário, obsolescência e histórico. Não marcar essa fatia histórica como já fechada. A [decisão posterior de MFA opcional](../decisions/2026-10-17-user-optional-mfa.md) prevalece sobre o texto antigo de MFA obrigatório: manter autenticação recente e separação de funções, usando a política atual, sem representar password como MFA.

Downloads e novas leituras revalidam candidatura, permissão documental, organização, versão e disponibilidade. Só versão disponível/limpa pode ser descarregada ou usada numa revisão. Nova versão não herda aprovação; retirar associação não apaga objeto/histórico. Sem grant documental não divulgar conteúdo, nomes ou metadados restritos através de candidatos, histórico ou agregações.

Dependência concreta: [bootstrap documental](../../backend/src/documents/productionDocuments.js) não fornece handlers operacionais; [composição](../../backend/src/productionComposition.js) injeta a porta de download de candidatura apenas em desenvolvimento e o [arranque nativo](../../backend/scripts/localPlatform/runtime.js) não a fornece. Implementar a ligação efetiva a storage/scanner/worker e confirmar recurso APPLICATION no fluxo F11. Inventariar configuração por presença/estado, sem ler segredos para logs. Doubles servem para testes isolados; não satisfazem o percurso final de upload/download. Credenciais ou serviço externo em falta devem ser identificados concretamente, mantendo o gate fechado e a entrega em revisão.

## Plano de implementação ordenado

1. **Fixar baseline e contratos.** Aplicar ao desenho a matriz confirmada acima; inventariar dados/schema, revisão documental e tarefas existentes; obter provas antes/depois para preservação. Fixar exemplos de lista/formulário/detalhe/parceiros com dados equivalentes à referência. Resolver desde início disponibilidade de F11/storage/scanner para evitar descobrir a dependência apenas no fecho.
2. **Completar domínio e contratos HTTP.** Alargar `applications/contracts.js`, `repository.js`, `composition.js` e `applicationSliceRoutes.js`, mantendo as operações existentes. Acrescentar estados/campos, consultas da lista e parceiros; sincronizar `privateApplicationsApi`. Criar documento de payloads, validações, transições, respostas/permissões e paginação antes de cada alteração. Preservar clientes e receipts antigos; campos novos ausentes não podem apagar valores existentes.
3. **Migrações aditivas e prova de compatibilidade.** Acrescentar migration após 026 (número reservado apenas na execução), incluindo constraints de estados em candidatura e histórico, dados financeiros/notas e domínio de parceiros. Não alterar migrations aplicadas 021–026. Preservar `INTENTION` e histórico anterior. Testar schema vazio/upgrade com dados, RLS, grants, fingerprints, rollback transacional e recusa de downgrade destrutivo. Atualizar manifests/pins/capabilities apenas com evidência; não prever migração central sem necessidade demonstrada.
4. **Recuperar a interface original.** Adaptar os três componentes originais aos DTOs/permissões atuais, sem regressar a `user.role === ADMIN` como autoridade. Repor lista, filtros, formulário e detalhe; inserir equipa/tarefas existentes e parceiros recuperados. Remover a escolha da interface reduzida apenas quando o percurso equivalente estiver funcional. Adaptar `OppPicker` às origens autorizadas/revisão central exata, sem consultas legacy.
5. **Ligar documentos e preservar revisão.** Completar upload/download F11 com rotas, composição, worker/scan e binding da candidatura; adaptar o painel ao gesto de anexar ficheiro. Manter pedidos/decisões/conjuntos e recuperação. Validar ficheiro real no ambiente de prova e depois habitual; distinguir claramente o que usa serviço real e doubles.
6. **Regressões de integração.** Atualizar rótulos/resumos do catálogo e classificação mínima de novos estados em `pilotDashboard.js` para não perder candidaturas ativas nem mostrar códigos. Conferir contagens com a lista; não declarar reporting financeiro integral pronto, pois pertence à entrega 5. Preservar Matching, diretório, autenticação, contextos e criação manual.
7. **Demonstração e comparação.** Executar cenários abaixo em PostgreSQL isolado com duas organizações e Chrome; preparar atualização habitual com backup/rollback e resumo concreto das alterações. Validar na instalação habitual com sessão real, sem criar dados fictícios na organização real. Comparar piloto/C4G lado a lado antes do fecho; anexos indisponíveis impedem fechar a entrega completa.

## Aceitação e validação exigida

| ID | Percurso / garantia | Prova necessária |
| --- | --- | --- |
| E3-01 | Criar em Identificada sem Matching/perfil completo, origem privada ou central com revisão exata; responsável elegível | API + PostgreSQL A/B + browser, incluindo Registar interesse; repetir envio e recarregar sem duplicar; recibos antigos e estados existentes preservados; criação com avaliação opcional preservada |
| E3-02 | Lista original, pesquisa/filtros/paginação, oito colunas, contagens e navegação | Testes de consulta autorizada e componente; dados de várias páginas, erros distintos de vazio e mudança de organização; comparação visual |
| E3-03 | Estados acordados até submissão e resultado, motivos, datas e histórico | Matriz completa válida/inválida; concorrência CAS, transições antigas preservadas, resultado incerto e histórico imutável; ausência de envio externo |
| E3-04 | Prazo interno, notas e dois orçamentos guardados e relidos | Nulo/zero, cêntimos exatos, limites/inválidos, limpeza de campo, conflito e histórico; nenhuma dotação inferida |
| E3-05 | Equipa e tarefas existentes continuam utilizáveis | Upgrade com tarefas abertas/concluídas/canceladas e participantes removidos; comparar IDs/revisões/receipts/histórico; criar/editar/reatribuir/concluir/cancelar no detalhe; revogação e A/B |
| E3-06 | Parceiros/contactos por candidatura e página agregada | Criar/editar/retirar logicamente; recarregar, pesquisar/filtrar; isolamento inclusive metadados, países e contagens; histórico e conflitos |
| E3-07 | Anexar ficheiro, scan, descarregar e retirar vínculo | Conteúdo real e hash igual, tipos/tamanho inválidos, quarentena/indisponibilidade; grants assimétricos, revogação, IDOR, versão exata e A/B; prova de storage/scanner reais no fecho |
| E3-08 | Revisão interna construída preservada | Pedido/decisão por pessoas distintas, grant próprio, política de autenticação atual, obsolescência e nova versão; não muda estado da candidatura; recuperação de envio pendente noutra candidatura |
| E3-09 | Migração e segurança | PostgreSQL real, RLS/grants/fingerprint, autorização atual na transação, falha F7/rollback, CAS/idempotência/commit incerto; nenhuma mudança global de acesso ou perda de dados |
| E3-10 | Paridade utilizável na instalação habitual | Chrome/OIDC, desktop 1008/1280/1440 e móvel 390, teclado/ações/erros, ficheiros e persistência; capturas lado a lado com origem dos dados explícita e revisão com o utilizador |

Reutilizar `backend/test/applicationFirstSlice.test.js`, `applicationWork.test.js`, `applicationOpportunitySummaries.test.js`, `f11PrivateDocumentStorage.test.js`, testes frontend de `PrivateApplications`, `ApplicationWork`, `ApplicationDocumentsReview` e gates em `test/integration/applications/`. Acrescentar apenas casos das extensões/riscos reais. Executar `npm run build` no frontend, `node --check` nos JS backend alterados e testes dirigidos. Não substituir prova de browser/armazenamento real por mocks ou build.

## Estado de preparação

Inventário e plano documental concluídos, com as duas escolhas de produto respondidas pelo utilizador; nenhuma alteração de aplicação, base, grants, serviços ou ficheiros de configuração nesta preparação. Não foram executados testes funcionais nem criada comparação visual da entrega 3. A preparação não demonstra implementação nem operação dos anexos. Sem escolha de estado inicial/transições pendente. Dependência técnica a resolver na execução: composição documental efetiva. Riscos principais: reclassificação silenciosa, perda de tarefas/recibos, exposição de contactos nos filtros e declaração de anexos operacionais sem storage/scan reais.

Próximo passo: iniciar a implementação pelo baseline e pelos contratos de estados/campos, com criação em Identificada e preservação das candidaturas e tarefas existentes.

## Incremento autorizado — estados e campos (2026-10-17)

Implementar a matriz acima e os campos nas vistas originais adaptadas ao contrato atual, preservando tarefas e revisão documental. Notas: texto opcional até 10 000 caracteres. Orçamentos HTTP: strings decimais EUR entre 0 e 99999999999999.99, até duas casas, ou null; sem arredondamento implícito. Omissão em edição conserva o valor; omissão na criação representa null. Não acrescentar chaves ausentes à intenção normalizada dos clientes anteriores, preservando digest e replay. Datas de estado e última submissão derivadas de eventos CREATE/TRANSITION; o recuo conserva a última submissão no histórico. Prazo interno permanece independente do prazo da oportunidade. Migração 027 aditiva, sem reescrita de linhas, histórico ou recibos; sem downgrade destrutivo. Schemas anteriores conservam o contrato anterior durante a transição e recusam campos novos explicitamente.

Aceitação do incremento: novas origens central/privada começam Identificada no schema 027; transições válidas/ inválidas e estados terminais verificados; editar/reabrir conserva notas, zeros e cêntimos; edit antigo conserva novos campos; replay antigo conserva resposta; histórico imutável, tarefas e isolamento A/B preservados; frontend build e percurso browser. Não declarar parceiros, upload real, filtros completos ou entrega 3 global concluídos neste incremento.

Contrato HTTP do incremento: [payloads, limites, respostas e compatibilidade](../references/application-lifecycle-http.md).

Resultado do incremento: implementação e provas isoladas concluídas; migração 027 aplicada no ambiente habitual após autorização explícita, com backup verificado e dados preservados. Chrome/OIDC confirmou consultas, lista e formulário sem escritas de negócio. Comparação revista pelo utilizador, que autorizou continuar. [Revisão, comparação e limites](../reviews/c4g-pilot-parity-delivery-3-states-fields.md). Entrega completa permanece In Progress.


## Continuação autorizada — lista completa (2026-10-17)

Após rever a comparação, o utilizador confirmou «Já vi vamos avançar». Critério E3-02 implementado e validado: [contrato HTTP](../references/application-list-http.md), reutilização da tabela original, oito colunas, pesquisa, filtros, contagens autorizadas, ordenação e paginação global, estados com motivo e recuperação. Sem migração ou novos grants. [Provas e limites](../reviews/c4g-pilot-parity-delivery-3-list.md). Parceiros e anexos reais mantêm-se como trabalho restante da entrega 3.
