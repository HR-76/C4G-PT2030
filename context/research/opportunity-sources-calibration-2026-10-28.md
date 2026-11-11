# Fontes de oportunidades — diagnóstico de cobertura e operação

28/10/2026. Análise pedida pelo utilizador perante 119 oportunidades. Sem implementação, reinício de serviços, importações, alterações SQL ou configuração. Plano proposto: [calibração das fontes](../features/opportunity-sources-calibration.md).

## Conclusão

Os 119 são reais na Central local, mas representam um catálogo parcial e desatualizado. Há dois problemas independentes: worker ausente e recolha limitada às primeiras quatro páginas. O número não resulta de um limite da listagem nem de uma falha comprovada da API europeia nesta consulta.

### Evidência atual, não apenas histórica

Consulta SELECT em transação READ ONLY, com timeout de 5 segundos, sem consultar dados de candidaturas ou identidades pessoais:

| Medida | Resultado |
| --- | --- |
| Registos centrais / identidades | 119 / 119 |
| Origem canónica | 117 EU Funding & Tenders; 2 POCTEP |
| Dentro das datas de abertura/fecho em 28/10 | 14; não certifica elegibilidade nem abertura à hora da consulta |
| Abertura futura | 99 |
| Prazo passado | 6 |
| Sem prazo | 0 |
| Estado interno | 119 ACTIVE e PENDING_REVIEW; ACTIVE não significa concurso aberto |
| Programa dominante | 101 HORIZON, dos 119 |
| Montante máximo/moeda estruturados | 0 / 0; não significa financiamento zero |
| Com resumo | 113 |
| Últimas observações concluídas | 18/10/2026 |

Às 21:37 UTC/Lisboa de 28/10, o heartbeat do worker datava de 26/10 às 01:18:58 UTC, aproximadamente 68,3 horas antes. O PID guardado já não existia. Uma execução EU estava QUEUED desde 21:31:02, com 367 segundos de espera. Não foi criada pela auditoria. Não foi determinada a causa da saída do processo; não se confunde heartbeat antigo com prova de falha do fornecedor.

Evidências sanitizadas: `output/funding-audit-20261028/read-only-results.json`, `runtime-read-only.json`. Script reproduzível da consulta inicial: `read-only-probe.cjs` nessa pasta; carrega credenciais locais internamente, nunca as imprime. Não executar scripts de upgrade/reconciliação como diagnóstico.

O histórico explica o valor: 117 após as recolhas/reconciliação europeias de 18/10, mais chamadas POCTEP 9 e 10. Ver [revisão europeia](../reviews/c4g-pilot-parity-delivery-4-programmes.md) e [revisão POCTEP](../reviews/c4g-pilot-parity-delivery-4-interreg-poctep.md). Estas contagens foram agora confirmadas diretamente.

## Inventário das fontes e interfaces externas

| Secção | Interface usada hoje | Consulta desta auditoria | Diagnóstico |
| --- | --- | --- | --- |
| EU Funding & Tenders | POST `https://api.tech.ec.europa.eu/search-api/prod/rest/search`; tipos 1/8, estados 31094501/31094502, período 2021–2027, inglês | HTTP 200; `totalResults=1119`, pedido de apenas um resultado | Fonte disponível. Conector lê no máximo 100 resultados brutos por execução. Total remoto não equivale a oportunidades únicas, atuais e elegíveis. |
| CORDIS | A mesma SEARCH, filtrada por HORIZON/EURATOM | HTTP 200; `totalResults=861`, um resultado solicitado | Subconjunto da fonte europeia, não API CORDIS; não somar 861 aos 1119. |
| Erasmus+ | A mesma SEARCH, programa ERASMUS/43353764 | HTTP 200; `totalResults=3`, um resultado solicitado | Só o recorte publicado no portal europeu. Três resultados não demonstram erro nem cobertura de todo Erasmus+. |
| Interreg Europe | GET do XLSX oficial `https://www.interregeurope.eu/sites/default/files/2024-08/Calls_planning_web.xlsx` | Adaptador atual: 3 recebidos, 3 excluídos por datas, 0 atuais, 0 falhas | Zero atual é legítimo neste recorte. Só três chamadas gerais; não representa todos os programas Interreg. |
| POCTEP | GET `https://www.poctep.eu/wp-json/wp/v2/pages/2831` e `/9396`, extraindo tabelas HTML | Adaptador atual: 10 recebidos, 9 excluídos, 1 atual, 0 falhas | Convocatória 10 até 17/11/2026. A 9 terminou em 21/10 e permanece corretamente como histórico local. |
| Portugal 2030 | Na APP: percurso administrativo XLSX indisponível. Não há conector automático central | `platformDirectory/service.js:43` devolve sempre `available:false`, `CENTRAL_IMPORT_NOT_CONFIGURED` | Lacuna de implementação explícita; não é falha transitória nem fonte automática ativa. |

A consulta europeia reproduziu `formData()` da aplicação com `pageSize=1`, sem recolher/persistir o universo completo. Os totais são da resposta do fornecedor nessa observação, antes da validação local. Os adaptadores Interreg/POCTEP foram executados só em memória com a data de referência 28/10, sem jobs ou escrita em catálogo.

### Verificação em fontes primárias

- O [portal de APIs F&T](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis) é a referência oficial; a página dinâmica não expôs nesta leitura um contrato completo de quotas/SLA. Confirmar esses limites antes de automatizar.
- [CORDIS apresenta projetos e resultados de investigação](https://cordis.europa.eu/projects). Recomendação: chamar à seleção atual «Horizon Europe / Euratom»; uma integração CORDIS real serviria enriquecimento de projetos/parceiros, não multiplicação de concursos.
- Erasmus distingue oportunidades [geridas pelas agências nacionais](https://webgate.ec.europa.eu/app-forms/af-ui-opportunities/) das geridas pela EACEA. A [página oficial de oportunidades](https://erasmus-plus.ec.europa.eu/opportunities) deve orientar a cobertura; o subconjunto F&T não representa as duas vias.
- A Comissão indica que [Interreg Europe já comprometeu os fundos e não prevê mais chamadas abertas gerais em 2021–2027](https://circular-cities-and-regions.ec.europa.eu/support-materials/funding-and-financing/interreg-europe). O XLSX atual foi lido com sucesso, embora a página `call-for-projects` tenha dado 403 ao leitor web.
- O [calendário oficial POCTEP](https://www.poctep.eu/convocatorias/) distingue a 9.ª encerrada e a 10.ª aberta. A [página das chamadas abertas](https://www.poctep.eu/convocatorias-abiertas-poctep-2021-2027/) confirma a 10.ª.
- O HTML atual da [página oficial Portugal 2030](https://portugal2030.pt/avisos/) usa `POST /wp-json/avisos/query` e referencia `/wp-json/avisos/feed` e `/wp-json/avisos/download`. OPTIONS no endpoint query respondeu 200, namespace `avisos`, GET/POST, argumentos declarados `pesquisaLivre`, `order_by_field`, `order_by_direction`, `wpml_language`. O frontend também envia filtros de programa e tipo de entidade. **Interface pública identificada, ainda sem contrato integral de paginação, contagem, licenciamento ou estabilidade validado.** Não foi executada uma ingestão nem afirmado um total Portugal 2030. O widget Digital Fundos encontrado na página é chat, não a API dos avisos.

## Achados acionáveis

| Prioridade | Evidência | Impacto e direção |
| --- | --- | --- |
| P0 — operação | Heartbeat/processo ausente; pedido QUEUED. `fundingTenders/worker.js:57–70`, `repository.js:41` | Sem consumidor não há processamento nem reconciliação dos pedidos expirados. Uma execução ativa bloqueia todas as fontes. Diagnosticar saída, recuperar o serviço e tornar saúde/idade da fila visíveis. Não limpar filas à força. |
| P1 — cobertura | `source.js:10,87,91,135`; política em `programmes.js` | Máximo rígido 100/25/4; cada collect começa em 1, sem cursor persistido. Repetir atualização não avança. Precisa de varrimento durável por lotes com conclusão comprovável. |
| P1 — enviesamento | `source.js:63`; 99 aberturas futuras na base | Ordenação DESC de deadlines e corte precoce privilegiam prazos longínquos. Não basta trocar para ASC: a correção anterior documentou resultados expirados e filtros range ineficazes. Cobertura completa e prioridade a oportunidades próximas precisam de desenho/testes próprios. |
| P1 — frescura e estados | `source.js:23–36,47–48`; `officialSources.js:181`; `applications/opportunitySummary.js:9` | Só se recebe próximo prazo civil; informação horária, múltiplas rondas e estados de fonte não são persistidos estruturadamente. Registos encerrados/cancelados são excluídos antes de refrescar identidades existentes. O contador open usa fecho/lifecycle e ignora abertura futura. Separar abertura, fecho, cancelamento, desconhecido e desatualização; preservar histórico. |
| P1 — observabilidade | `repository.js:18,74–78`; `FundingTenders.jsx:68–95` | `excluded`, páginas e total remoto não ficam no run; não há contagem explícita de duplicados. SUCCESS pode ser limitado. Não se consegue explicar a diferença entre recebidos e aplicados. Persistir funil de contagens e estado PARTIAL. |
| P1 — saúde superficial | `localPlatform/runtime.js:126–127`; `worker.js:13,19` | Health local verifica idade/instalação, mas não distingue STANDBY de PROCESSING. UI de fontes mostra configuração, não saúde do consumidor. Expor ambos e alertar por ausência de progresso; não reduzir salvaguardas. |
| P2 — campos úteis às candidaturas | `source.js:37–50`, `merge.js:5`, `sourceDescription.js` | Apenas oito campos comuns; resumo até 4000 caracteres. Sem montantes/moeda estruturados nos 119. Não basta aumentar volume para qualificar candidaturas. Enriquecer com proveniência por campo e distinguir dotação do aviso de apoio por projeto. |
| P2 — cobertura nacional | `platformDirectory/service.js:43`; contrato `portugal2030-platform-ownership.md` | Página Portugal 2030 preparada mas motor central não implementado. Implementar composição central própria, sem ligar disfarçadamente o motor privado legado. |
| P2 — fragilidade de parsers | `officialSources.js:8–9,79–86,109–139` | URL XLSX fixa, três nomes de chamada aceites, IDs/tabelas POCTEP rígidos. Falhar explicitamente é correto; faltam monitorização de alterações e processo de atualização do contrato. Em POCTEP pages=2 é declarado mesmo quando só se pede calendário. |
| P2 — modelo de catálogo | `repository.js:129,136,141`; `sourceIdentity.js` | Lista/detalhe dependem de INNER JOIN funding_identity. Adicionar avisos centrais de outra origem exige integração deliberada no leitor/proveniência, não só escrever opportunity. |
| P2 — operação fora do local | `config/fundingTendersWorker.js:14` | Worker atual só admite development/loopback e destinos de ensaio/local aprovados. Não está pronto para ativação produtiva por simples mudança de URL/env. |

Nenhum destes achados demonstra perda ou corrupção das candidaturas existentes. `applications/contracts.js` e `applications/repository.js` vinculam a candidatura CENTRAL à revisão identificada; manter esse vínculo e as correções manuais é requisito da evolução.

## Contratos HTTP internos revistos

- `GET /api/admin/integrations/funding-tenders`: devolve execuções/configuração, sem saúde, progresso ou cobertura remota.
- `POST` na mesma rota: requestId+source, autoridade C4G e garantia de repetição; apenas agenda. Resposta 202 não comprova execução. Bloqueio global de nova execução enquanto houver QUEUED/RUNNING.
- `GET /api/central-opportunities[/:id]`: sessão e organização resolvida; leitor restrito. Lista 25+1 por cursor — isto é paginação de consulta, não causa dos 119.
- `GET /api/admin/central-opportunities[/:id]`: leitura explícita por administrador da plataforma, sem assumir membership tenant.
- Disponibilidade de imports administrativos: serviço devolve indisponibilidade central. Cliente `platformImportsApi` separado do percurso privado anterior.
- Dashboard da plataforma conta todos os registos e lifecycle; resumo de organização trata fecho futuro como open. Estes indicadores devem separar total histórico, futuros e abertos por data/estado.

## Verificação e limites

55 testes locais de fontes, histórico, catálogo, autoridade, seleção temporal e worker PASS (`output/funding-audit-20261028/tests.log`). Provam o contrato limitado atual; não provam completude nem operação produtiva. Testes existentes chegam a exigir o corte aos 100.

Sem gates PostgreSQL de preparação, migrações, reinício ou novos pedidos de atualização. Leitura de PostgreSQL local foi READ ONLY; chamadas públicas foram consultas limitadas. Browser autenticado não estava disponível: não se contornou autenticação. A origem da paragem do worker, quotas/SLA, taxonomia completa oficial e API integral Portugal 2030 permanecem por verificar. Não criar meta arbitrária de milhares de oportunidades nem tratar futuros/duplicados como novos concursos.

Próximo passo: validar o plano e começar pela recuperação observável do worker, seguida da paginação durável.
