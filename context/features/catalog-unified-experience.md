# GCNI — catálogo unificado, filtros e ficha de oportunidade

Versão: 1.0 · Data: 01/11/2026 · Identificador: GCNI-CAT-01.
Estado: especificação documentada; implementação e validação no GCNI pendentes.
Autorização desta entrega: documentação do contexto, sem código, SQL, importações, reativação de fontes ou publicação.

## 1. Objetivo e fontes de decisão

Melhorar a componente de oportunidades do GCNI existente, integrando Portugal 2030 e EU Funding & Tenders num catálogo comum. A unidade é a oportunidade candidatável: tópico quando aplicável, aviso ou convite; call e programa conservam relações próprias. Um aviso previsto continua identificável como previsão, não como concurso já publicado.

O utilizador confirmou a barra de filtros, a abordagem e a organização interna da ficha do laboratório como referência de experiência. O plano original mantém seis fases: diagnóstico, modelo, integrações, interface, validação e publicação. Os resultados do laboratório são materiais de referência e regressão; não certificam funcionamento no GCNI.

Fontes locais: plano original reanexado em 01/11/2026; pedido atual; análise estática do GCNI; protótipo `outputs/app_oportunidades` no espaço de trabalho desta conversa. Fontes permanentes do GCNI: [primeira análise](opportunity-first-analysis.md), [descoberta](catalog-discovery-improvement-plan.md), [reset local](catalog-reset-local-2026-11-01.md) e [arquitetura](../architecture.md).

## 2. Compatibilidade com decisões anteriores

- A primeira análise permanece concisa: título/código, abertura/fecho, dotação da call/aviso, descrição e programa, com fonte oficial e ações existentes.
- O pedido mais recente acrescenta detalhe progressivo acessível por secções. Evolui a decisão anterior de retirar condições e blocos secundários da primeira análise; não volta a colocar diagnósticos técnicos no resumo.
- A tabela do laboratório de cinco colunas é referência de organização, não autorização para suprimir abertura, descrição ou ações já aprovadas. Proposta visual: cinco grupos principais e ações existentes, com abertura e descrição em conteúdo secundário legível. A disposição final exige revisão visual antes de substituir a tabela atual.
- Dotação resumida significa dotação da call/aviso. Dotação do tópico, apoio individual e taxas são informação distinta na ficha, nunca substitutos silenciosos.
- O filtro por áreas continua prioritário no plano de descoberta. Seed, mapping, seleção múltipla e restantes propostas desse plano não são aprovados implicitamente por esta especificação.
- OIDC, autoridade central, isolamento organizacional, interesses e candidaturas são reutilizados. Não se transportam login de demonstração, servidor Python ou migrações M01–M08 do laboratório.
- O reset e EU QUIESCED são o último estado documentado, não uma consulta ao estado vivo. Não reutilizar pacotes antigos nem reativar fontes por efeito desta melhoria.
- Usar GCNI-CAT-01 e incrementos G1–G5 para evitar confusão com fases F do laboratório ou do GCNI.

## 3. Correspondência de campos

Os caminhos abaixo identificam conceitos existentes, não uma promessa de equivalência estrutural dos JSON. O DTO detalhado será versionado antes da implementação do serviço.

| Campo/conceito do laboratório | GCNI atual | Regra da melhoria |
| --- | --- | --- |
| id, external_code, title | identidade central, identity, sourceRecords, projeção de leitura | UUID interno estável; código e título da fonte sem confundir call/tópico; preservar aliases. |
| kind | identity.kind CALL/CASCADE_CALL; publication e namespaces | Mapping explícito para aviso previsto/publicado/tópico/convite; não converter enums por semelhança. |
| programmes | programmes/funds | Todos os programas publicados; labels legíveis com códigos estáveis; não confundir publicador ou concedente. |
| description | description; apresentação comum | Conteúdo oficial normalizado e seguro; preservar original e evidência. Corrigir descrição EU no adaptador, sem inventar resumo. |
| official_links | links/sourceRecords | Ligação oficial validada; atribuição e condições de reutilização existentes preservadas. |
| application_status | status + temporal + qualidade | Estado da oportunidade e âmbito, separado do estado de uma candidatura da organização; não representa elegibilidade. |
| deadline_summary, windows, scopes | schedule; Temporal/Deadline; temporal derivado | Data civil, instante e período mantêm precisão; acrescentar condição, ronda, fase e âmbito estruturados onde necessário. |
| hora local sem fuso | INSTANT exige representação UTC; DATE não conserva hora | Extensão explícita; nunca converter hora desconhecida em UTC nem truncar para data silenciosamente. |
| funding_summary, funding_lines | financing; Allocation | Moeda, natureza prevista/confirmada, âmbito e grupo partilhado; decimais exatos; zero não é ausência. |
| funding_rules | Support/Rate e condições | Taxa base, bónus e teto só quando sustentados; não extrapolar apoio individual. |
| documents | referências Document, links e proveniência | Modelar versão imutável, hash, publicação, vigência, substituição e âmbito; separar documentos públicos dos privados da candidatura. |
| conflicts/assertions | Fact CONFLICT, qualidade e fluxo de revisão | Alternativas com evidência, severidade, decisão auditada e âmbito; nenhuma publicação automática de conflito material. |
| relationships | identidade, fontes e relações existentes a inventariar | Plano→aviso com confiança e evidência explícitas; correspondência provável não funde identidades automaticamente. |
| history/evidence | revisões, observações e evidências v2 | Histórico imutável paginado e proveniência autorizada; não expor payloads privados ou credenciais. |
| quality_flags/completeness | PRESENT/NOT_FOUND/NOT_COLLECTED/NOT_APPLICABLE/CONFLICT/UNSUPPORTED; freshness | Preservar semântica; lista vazia não prova inexistência; qualidade e atualidade são dimensões diferentes. |
| observed_at/reviewed_at | observação, revisão e asOf | Distinguir recolha, revisão humana e instante da projeção; ausência de revisão não inventa data. |
| snapshot_id/cursor | revisão individual, cursor UUID, asOf por pedido | Snapshot de catálogo é extensão necessária; vincular filtros/ordenação/versão/autoridade aplicável e expiração. |

## 4. Filtros e consulta

Barra principal: pesquisa por código/título, estado e qualidade, botão Pesquisar e Limpar. Área expansível: programa, fonte, tipo, intervalo de prazo, dotação mínima/moeda, ordenação e tamanho de página. Áreas integram a mesma experiência após resolução do contrato temático próprio. Labels de programa/fonte devem ser legíveis; códigos ficam internos ou secundários.

| Filtro | Base atual | Contrato requerido |
| --- | --- | --- |
| Texto | q | Pesquisa no universo autorizado antes da paginação; validar comprimento; preservar comportamento de pesquisa já suportado. |
| Programa | programme | Código estável; opções autorizadas não limitadas à página recebida. |
| Estado | temporalState | Mapping documentado; previsto, a abrir, aberto, encerrado, suspenso, cancelado, condicionado e por confirmar só onde representáveis. Não comprimir condicionado em aberto. |
| Qualidade | fact/quality/freshness sem filtro HTTP equivalente | Incompleto, conflito e atualização pendente são predicados explícitos no servidor; podem coexistir num registo. |
| Fonte e tipo | sourceRecords/identity; sem filtro equivalente atual | Identidades e enums versionados; evitar duplicação de linhas por múltiplas fontes. |
| Prazo desde/até | closingFrom/closingTo | Intervalo inclusivo de datas civis com regra temporal versionada; só prazos sustentados no intervalo. Condicionais/conflituosos não usados como datas certas; exclusão explicada na UI. |
| Dotação mínima e moeda | financiamento; sem filtro equivalente atual | Moeda obrigatória, sem conversão cambial; comparar apenas dotação call/aviso sustentada e comparável. Não somar linhas, grupos partilhados ou moedas. Valores ambíguos ficam fora com explicação. |
| Ordenação | ordem por UUID | Título, prazo crescente/decrescente e observação recente; desempate por ID; nulos e incerteza em posição explícita e estável. |
| Tamanho de página | limite atual 25 e orçamento de bytes | Manter 25 inicialmente; opções adicionais apenas após limites/contrato testados. O valor 2 do laboratório é caso de teste, não requisito de produto. |
| Áreas | plano de descoberta; contrato ainda Draft | Classificação antes da paginação; preservar IDs/taxonomia/perfis. Sem filtragem apenas no browser. |

Combinar dimensões com E. Valores inválidos devem produzir erro explícito, nunca alargar silenciosamente a pesquisa. Alterar filtros ou ordenação reinicia cursor e snapshot. URL preserva filtros ao abrir/voltar à ficha e ao atualizar, sem dados privados ou tokens de sessão. Reabrir URL obtém autorização atual e um snapshot válido.

Decisão ainda aberta: estado inicial. O GCNI aplica fecho a partir de hoje; o laboratório permite exploração ampla. Até confirmação, preservar o comportamento atual com filtro visível e removível. Não ocultar oportunidades desconhecidas por uma regra nova não aprovada.

## 5. Estrutura da ficha

| Secção | Conteúdo | Apresentação e autoridade |
| --- | --- | --- |
| Resumo | Identificação, descrição, programas, abertura, prazo, dotação, estado, fonte oficial | Leitura concisa; alertas materiais visíveis; ações de interesse/candidatura autorizadas preservadas. |
| Prazos e condições | Janelas, fases, rondas, prorrogações e âmbito | Mostrar condição junto do prazo; conservar anteriores e indicar alteração; sem inventar fuso ou elegibilidade. |
| Dotação e taxas | Call/aviso, tópico, apoio por projeto, taxas e limites | Rótulos inequívocos e moeda; não somar grupos partilhados. |
| Documentos e versões | Versões, publicação/vigência, substituição, fonte | Versão histórica distinguida do URL atual; metadados técnicos em detalhe secundário. |
| Conflitos | Valores concorrentes, fontes e estado da revisão | Consulta não decide; ações administrativas continuam no fluxo autorizado existente. |
| Relações plano/aviso | Relação confirmada/provável e diferenças | Navegação autorizada; preservar cada identidade e histórico. |
| Histórico | Eventos e revisões com data de registo/efeito | Carregamento progressivo consistente com a ficha. |
| Fontes e evidências | Origem e localização úteis para confirmar informação | Informação técnica apenas quando necessária; acesso subordinado à autorização atual. |

Navegação por secções, teclado e telemóvel; regressar à lista conserva filtros e posição quando o snapshot ainda é válido. Se expirar, informar e oferecer atualização sem misturar páginas antigas e novas. Não repetir listas de campos ausentes: usar estado conciso por coleção. Estado da oportunidade não deve ser rotulado como estado da candidatura privada.

## 6. Componentes a adaptar

| Componente | Responsabilidade prevista |
| --- | --- |
| frontend/src/pages/Opportunities/CentralOpportunities.jsx | Orquestração lista/ficha, filtros, navegação, cancelamento e snapshot. |
| frontend/src/pages/Opportunities/catalogFilters.js | Serialização/validação de filtros e URL; compatibilidade com URLs existentes. |
| OpportunityPresentation.jsx / OpportunityListTable.jsx | Grupos visuais, ações e contexto autorizado; manter informação essencial aprovada. |
| OpportunityReadModelView.jsx | Detalhe progressivo e estados de coleção; apresentação sem regras específicas de fonte. |
| opportunityFirstAnalysis.js / opportunityReadModel.js | Apresentação comum v1/v2, valores exatos, estados e ligações seguras; localizar e preservar consumidores existentes. |
| frontend/src/api/api.js | Contrato de leitura, parâmetros, erros e cancelamento; reutilizar sessão/CSRF. |
| backend/src/fundingTenders/http.js / catalogQuery.js | Validação de filtros, autorização, versão de contrato e erros de snapshot. |
| backend/src/fundingTenders/repository.js / catalogReader.js / readModel.js | Filtragem e ordenação anteriores à paginação, projeção consistente, leitor restrito e limites de resposta. |
| backend/src/opportunities/v2/ | Schema, normalização, temporalidade, SQL e aceitação: extensões versionadas para lacunas comprovadas. |
| Conectores EU/PT2030 e migrações centrais | Mapping, evidência e projeções; inventário fino antes de alterar. Não aplicar SQL do laboratório. |
| Interesses, candidaturas, Matching e segurança | Consumidores a proteger por regressões; não reescrever autoridade ou scoring nesta melhoria. |

Usar as rotas existentes /catalogo e /catalogo/:id. A extensão de /api/central-opportunities e da variante administrativa deve ser compatível ou explicitamente versionada. /api/opportunities não é substituído. O contrato atual items/programmes/nextCursor/asOf não equivale ao data/page/meta do laboratório: não fazer substituição silenciosa. Envelope, TTL, limites e códigos exatos serão fechados no contrato técnico G1; prever estados distintos para cursor inválido, snapshot expirado, sessão terminada, acesso revogado e indisponibilidade.

## 7. Critérios de aceitação e prova exigida

Todos os critérios abaixo estão PENDENTES de execução no GCNI; esta entrega valida apenas a documentação.

| ID | Resultado verificável | Prova futura |
| --- | --- | --- |
| AC01 | PT2030 previsto/publicado e EU tópico usam uma apresentação comum sem perder identidade ou fonte. | Fixtures das fontes e testes de mapping/contrato. |
| AC02 | Pesquisa e filtros encontram também registos que estavam em páginas posteriores; combinações não duplicam linhas. | Integração do leitor com conjunto multipágina. |
| AC03 | Input inválido é rejeitado; limpar e mudar filtros reinicia consulta; URL/voltar preservam contexto. | Testes HTTP e navegação. |
| AC04 | Alteração concorrente não mistura revisões entre páginas, ficha, histórico e evidências do snapshot. | Teste transacional com revisão entre pedidos. |
| AC05 | Cursor alterado/incompatível e snapshot expirado têm erro e recuperação explícitos; nunca devolvem resultados alargados silenciosamente. | Testes de contrato e browser. |
| AC06 | Data civil, hora sem fuso, várias rondas e prazo condicionado conservam significado; estado não garante elegibilidade. | Casos temporais de fronteira, incluindo mudança de dia. |
| AC07 | Prorrogação preserva prazo anterior, âmbito, condições e evidência; conflito material não escolhe vencedor automaticamente. | Testes de domínio e persistência isolada. |
| AC08 | Moeda desconhecida, zero, decimais, dotações previstas e grupos partilhados não são confundidos ou somados. | Regressões financeiras e de filtragem. |
| AC09 | Mesmo URL com novo conteúdo cria versão documental distinta; substituição parcial não invalida todo o documento anterior. | Testes de versões, hashes, vigência e referências históricas. |
| AC10 | Relação provável plano/aviso é distinta de confirmada e não funde identidades por título. | Casos positivos, negativos e ambíguos. |
| AC11 | Estados ausente/não recolhido/não aplicável/conflito/não suportado e desatualização mantêm significado. | Testes de DTO e apresentação. |
| AC12 | Repetir recolha não duplica oportunidade/evidência/evento; falha parcial permite recuperação sem apagar histórico. | Ensaios de idempotência, rollback e retry isolados. |
| AC13 | Sessão revogada e mudança de organização descartam dados privados; snapshot nunca contorna autorização atual. | Testes entre organizações, perfis e revogação. |
| AC14 | Interesses, candidaturas por equipa e Matching continuam corretos; filtros não alteram perfil nem scoring. | Regressões dos consumidores existentes. |
| AC15 | HTML externo é inerte, ligações inseguras rejeitadas, exportações respeitam permissões e proteção de fórmulas. | Testes de segurança de apresentação/exportação. |
| AC16 | Barra e ficha são utilizáveis por teclado e em telemóvel; foco, erros, vazio, carregamento e recuperação são claros. | Browser com dados sintéticos e revisão visual. |
| AC17 | Descrição oficial útil não é substituída pelo título; ausência continua explícita sem texto inventado. | Fixture EU com metadata.description e regressões v1/v2. |
| AC18 | Filtro por áreas encontra universo completo autorizado, não altera perfil e não oculta não mapeados sem filtro explícito. | Testes após aprovação do contrato temático; bloqueado por esse mapping. |
| AC19 | Leitura é limitada, não escreve na consulta e não degrada o serviço além do orçamento acordado. | Baseline e medição p50/p95/custo SQL; definir orçamento antes da implementação. |
| AC20 | Migrações próprias preservam dados/permissões e admissão do leitor; rollback operacional não apaga histórico. | Gate PostgreSQL isolado com recuperação e validação de papéis. |

Fixtures mínimas: EU com múltiplas rondas; call com vários tópicos e verba partilhada; PT2030 previsto associado a aviso publicado; prorrogação condicional; hora sem fuso; documento substituído parcialmente; conflito material; moeda desconhecida; ausência de descrição; fonte desatualizada; registo manual/histórico; utilizadores de duas organizações com permissões distintas. Dados sintéticos para isolamento; amostras oficiais preservam origem e data de observação.

## 8. Sequência e limites

G1: fechar DTO, mapping e decisões abertas; desenhar barra/ficha sobre fixtures no contexto React do GCNI. G2: adaptar domínio/projeções e ensaiar persistência isolada. G3: serviço de leitura e testes de consistência/autorização. G4: integrar interface e regressões dos consumidores. G5: validação integrada, operação e eventual publicação em âmbito próprio.

Filtros sem suporte real não devem surgir como funcionais. Pode entregar-se um subconjunto explicitamente identificado, sem declarar a melhoria completa. Não há calendário fechado nem aprovação de migração ou produção nesta especificação.

Decisões abertas: disposição final das colunas; filtro temporal inicial; contrato temático já pendente; TTL/envelope/limites de snapshots; orçamento de desempenho. As duas primeiras são decisões de experiência a apresentar numa proposta concreta. As restantes serão tratadas nos respetivos contratos antes do código dependente. Não bloqueiam a documentação nem preparação de fixtures.

## 9. Autorrevisão desta especificação

Reconciliados: plano original versus funcionalidades já existentes; simplificação da primeira análise versus detalhe progressivo solicitado agora; dotação da call versus apoio individual; fases com nomes repetidos; contrato do laboratório versus API GCNI; áreas ainda Draft versus preferência visual confirmada. Nenhum resultado histórico de testes é apresentado como validação desta melhoria. Estado operacional vivo e fornecedores não foram consultados. Não foi alterado código, configuração ou base de dados nesta entrega documental.

Próximo passo: fechar G1 com uma proposta concreta da barra/ficha e do contrato de leitura no GCNI, resolvendo as decisões de apresentação antes da implementação dependente.


## G1 — proposta visual e contrato detalhado entregues (01/11/2026)

G1 concluído como entrega documental para revisão: [galeria estática](../references/catalog-unified-g1/proposta-g1.html), [proposta visual](../references/catalog-unified-g1/proposta-visual-g1.md), [contrato de leitura](../references/catalog-unified-g1/contrato-leitura-g1.md), [exemplos sintéticos](../references/catalog-unified-g1/exemplos-leitura.json) e [autorrevisão](../references/catalog-unified-g1/autorrevisao-g1.md).

Esta adenda atualiza o ponto de situação das secções 8–9: há agora uma proposta concreta de cinco grupos mais ações, abertura/descrição secundárias, filtro inicial por data UTC visível/removível, ficha progressiva, rotas de leitura versionadas, snapshot absoluto de 15 minutos e páginas de 25. São propostas para revisão, não aprovação humana presumida. A dependência temática de Áreas continua separada. Nenhuma alteração executável foi feita; os critérios AC01–AC20 continuam por validar na implementação.

Próximo passo: validar a proposta G1 e preparar G2 com schemas e fixtures de regressão em ambiente isolado.


## Aprovação G1 e incremento G2 de schemas (01/11/2026)

O utilizador aprovou explicitamente G1; as menções anteriores a proposta ainda não aprovada são históricas. O [incremento G2 de schemas e testes](catalog-unified-g2-schemas.md) está Complete no âmbito pedido, com 133 testes locais passados. A melhoria global permanece In Progress e os critérios de integração continuam pendentes. Nenhuma fonte foi reativada nem foi aplicada migração.
