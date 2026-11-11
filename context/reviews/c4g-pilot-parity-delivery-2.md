# Entrega 2 — recuperação de pessoas, perfil e Matching

Data: 2026-10-17. Estado: Complete — implementação validada em ambiente isolado, visual aprovado pelo utilizador e ativação local autorizada, aplicada e verificada. Revisão final autorizada e concluída com perfil preenchido pelo titular, correspondências reais e correção móvel verificada. [Contrato](../features/c4g-pilot-parity-delivery-2.md) · [Fecho](../history/c4g-pilot-parity-delivery-2.md). Os estados intermédios abaixo preservam a sequência de provas.

## Resultado implementado

- Organização → Departamentos/Unidades → Pessoas reutiliza o diretório existente, incluindo hierarquia, várias afetações, unidade principal, pesquisa e inativação.
- Ficha individual e perfil pessoal persistem biografia, palavras-chave e as 30 áreas do piloto. A associação à membership é explícita e escolhida pelo gestor; não há associação por email, criação de contas nem competências reais inventadas.
- Matching por perfil próprio, pessoa escolhida e oportunidade; catálogo central e oportunidades privadas autorizadas; áreas coincidentes e palavras da classificação original. Mantém o algoritmo determinístico do piloto, sem IA ou scoring adicional. O Matching não condiciona a candidatura nem certifica elegibilidade.
- Acessos permitem suspender/reativar a membership da organização com permissão explícita, controlo de revisão, idempotência e auditoria. Não alteram o utilizador global.

## Comparação visual

[Abrir comparação lado a lado](../../output/playwright/c4g-pilot-people/comparacao.html) · [Perfil](../../output/playwright/c4g-pilot-people/comparacao-profile.png) · [Matching](../../output/playwright/c4g-pilot-people/comparacao-matching.png).

Esquerda: componentes Profile/Matching do snapshot original `3a79b25539040c2024051cf9ab6295680b760277`, com respostas de serviço simuladas. Direita: frontend atual, API atual e PostgreSQL descartável, com dados sintéticos. A sessão de ensaio não executa o fluxo OIDC. As imagens não são uma reprodução de dados históricos nem prova de ativação local.

Preservados: estrutura do perfil, biografia/palavras-chave, seleção das áreas e tabela de sete colunas do Matching. Adaptações intencionais: marca C4G, navegação por organização, unidades em vez de Faculdade/Centro UBI, segurança da conta no serviço atual e explicação expansível das correspondências. Corrigidos contorno indevido do formulário e corte da explicação; larguras e espaçamento ajustados em 1008 px para separar cabeçalhos e apresentar prazos. Fonte privada identificada por «Privada», com descrição completa ao passar o rato; nomes longos mantêm o detalhe acessível por ligação.

Capturas em 1440, 1008 e 390 px; verificação de ausência de overflow da página e de erros JavaScript. A comparação inclui unidades, pessoas, acessos e pessoas correspondentes à oportunidade. O utilizador aprovou a apresentação («Gostei estamos no caminho»). Acrescentadas capturas do ambiente habitual, distinguindo os dados existentes dos ensaios sintéticos.

## Provas executadas

| Prova | Resultado e alcance |
| --- | --- |
| Build frontend e sintaxe backend | PASS; compilação final e `node --check` nos módulos alterados |
| Regressão frontend | 88 testes PASS em 12 ficheiros; 2 testes Matching repetidos após ajuste de rótulos |
| Regressão backend | 73 testes PASS: Matching/contratos, manifests, composição, lease e commit guard |
| Compatibilidade de autorização | 40 testes PASS em preflight, commit guard e validade de aprovação editorial; sobreposição com os 73 anteriores, não somar |
| PostgreSQL descartável, diretório e perfil | PASS: hierarquia, pessoas, várias unidades, principal, CAS, idempotência, A/B, RLS, auditoria com rollback, resposta de commit perdida e regressão de catálogo/candidaturas |
| Migrações isoladas | PASS: 026 aditiva e rollback transacional; 016 forward/down com fingerprints exatos; admissão/coordenador em 015 e 016, divergência rejeitada |
| Acessos isolados | PASS: recusa sem permissão/entre entidades, suspensão/reativação, repetição idempotente; pedido HTTP recusado após suspensão, a mesma identidade continua a ler na segunda organização e a ficha da pessoa é preservada |
| Chrome + API + PostgreSQL descartável | PASS: criar unidade/pessoa, guardar/reler perfil, associação explícita, perfil próprio, Matching central/privado e oportunidade→pessoas, isolamento e acessos; [registo](../../output/playwright/c4g-pilot-people/browser-verification.json) |
| Instalação habitual, antes da atualização | PASS: login OIDC existente, Dashboard, catálogo, unidades/pessoas e leituras HTTP do diretório, oportunidades e candidaturas; zero escritas de negócio; [registo](../../output/playwright/c4g-pilot-people/native-compatibility.json) |

Os ensaios Docker usam uma instância descartável própria em 5594. Não usam as bases nativas 5432. A verificação nativa anterior preservou os esquemas 015/025; a prova posterior à autorização, descrita abaixo, usa 016/026. A compatibilidade de autorização compara o fingerprint da versão efetivamente verificada, tanto na admissão como dentro da transação; não elimina o preflight nem aceita divergências.

Limite operacional deste recorte: o Matching recusa listas superiores a 1000 registos por origem ou lista de pessoas; falhas de consulta não produzem resultados parciais. Não foi efetuado ensaio de carga nem declarada prontidão para produção.

## Ativação local autorizada e aplicada

Na tentativa anterior, a revisão automática recusou executar `node backend/scripts/localPlatform/pilotPeople.js --apply`: a autorização para desenvolver a entrega 2 não foi considerada autorização explícita para aplicar migrações e permissões à instalação persistente, incluindo uma migração marcada irreversível. A operação não executou nessa tentativa nem se tentou contornar a recusa. O utilizador autorizou depois expressamente a atualização («Autorizo»), resolvendo o bloqueio.

[Atualização preparada](../../backend/scripts/localPlatform/pilotPeople.js): destino restrito a `c4g_central_dev`/`c4g_tenant_dev` em 5432; cópias de segurança privadas e verificadas; migrações 016/026 pelos runners existentes; três permissões explícitas para a membership do gestor atual; atualização do snapshot verificado; comparação dos dados antes/depois. Elevação temporária do owner de migração, retirando-a no `finally`. Não associa automaticamente pessoas a contas nem preenche competências. O script não corre no arranque da aplicação.

016 amplia o protocolo fechado para alteração auditada de membership. 026 acrescenta persistência pessoal com RLS e revisão, sem remover registos existentes; não tem migração `down` automática para eliminar esses perfis. O backup é necessário para recuperação; a legibilidade do dump não equivale a um ensaio de restauro completo.

Execução autorizada concluída: `LOCAL_PILOT_PEOPLE_UPGRADE_PASS`. [Registo da atualização](../../output/playwright/c4g-pilot-people/local-upgrade.json): migrações 016/026, três grants acrescentados e hashes de dados de negócio/identidades/memberships iguais antes/depois. Backups privados em `.tmp/local-platform/pilot-people-backup-1792266390768`. API habitual reiniciada pelo nodemon para ler o novo snapshot.

## Validação após ativação

`NATIVE_DELIVERY_2_OIDC_READ_PASS`: [prova](../../output/playwright/c4g-pilot-people/native-delivery-2.json), usando o login OIDC existente e localhost:3000/5000. Dashboard, catálogo, unidades/pessoas, leituras de oportunidades/candidaturas, ficha individual, perfil próprio, Matching e acessos PASS. Ficha apresenta as 30 áreas e permite edição; contas da organização consultadas e controlo de gestão de acessos disponível. Capturas em 1440/1008/390 px para ficha/Matching, sem overflow nem erros JavaScript.

Zero escritas de negócio; hashes de dados antes/depois iguais. Confirmados `NOSUPERUSER`, `NOLOGIN`, `NOCREATEDB` e `NOCREATEROLE` no owner temporariamente elevado. `/api/local-health` respondeu 200 com API e heartbeat do worker disponíveis; isto não declara todas as integrações da entrega 4 operacionais.

A pessoa existente ainda não tem conta associada nem áreas pessoais preenchidas. `/me` e Matching próprio apresentam a ausência de associação; Matching da pessoa apresenta ausência de áreas. O percurso com gravação e correspondências positivas foi comprovado no ensaio isolado; não foi preenchida biografia, afetação, associação ou competência fictícia na organização real. O passo seguinte de utilização é o gestor fazer a associação explícita e o titular indicar as competências reais.

Veredicto: validação técnica da ativação concluída; pronta para revisão conjunta do percurso habitual. Entrega 3 não iniciada.

## Associação real após pedido do utilizador

Após o pedido explícito para abrir Pessoas e associar a conta, a conta Hugo foi ligada pela interface à ficha existente de Hugo Romão. `/me` confirmou a pessoa e a membership esperadas; biografia, palavras-chave e áreas mantiveram os valores anteriores. [Prova](../../output/playwright/c4g-pilot-people/real-profile-association.json). O perfil pessoal foi aberto num browser visível. O utilizador preencheu depois as competências na página e comunicou «Já coloquei na página». Os estados sem associação descritos na validação anterior são evidência histórica anterior a esta escrita autorizada.

## Revisão das oportunidades reais — 2026-10-17

O utilizador autorizou rever o perfil e as correspondências («ok avança»). A leitura anterior do serviço devolveu duas oportunidades centrais e estado READY. A correspondência é explicável pela regra original, mas não demonstra adequação institucional nem elegibilidade. Não alterar silenciosamente a classificação para fazer desaparecer resultados pouco pertinentes.

| Oportunidade | Motivo da correspondência original | Avaliação de pertinência |
| --- | --- | --- |
| EFCSN Permanent Call for Protection Grants | Cibersegurança: cybersecurity, cyber, threat, encryption. FinTech e Economia Digital: payment, digital. | A componente de cibersegurança existe, mas o apoio destina-se a organizações de verificação de factos ameaçadas. Não há nesta revisão prova de que a C4G satisfaça esse requisito. Não recomendar candidatura direta apenas pelo Matching. |
| R&I Policy Support for Enlargement Countries / POLICY ENLARGE | FinTech e Economia Digital: financial, digital. | Coincidência ampla de vocabulário. Para uma entidade portuguesa, a possibilidade a explorar é acolhimento no instrumento 3, com parceiro e participante elegíveis de país do alargamento; isso não confirma a elegibilidade da C4G ou do titular. |

**EFCSN:** exige entidade jurídica de verificação de factos certificada EFCSN ou capaz de demonstrar cumprimento prático do respetivo código; candidatura individual, sem consórcio. Apoio relacionado com uma ameaça/incidente, não modernização informática geral. A chamada permanente indica 02/09/2026 a 31/05/2028, sujeita a disponibilidade de fundos. [Chamada oficial EFCSN](https://efcsn.com/funding-opportunities/efcsn-protection-grants/), consultada nesta revisão.

**POLICY ENLARGE:** instrumentos 1 e 2 exigem pelo menos duas entidades independentes de diferentes países do alargamento. Instrumento 3 admite entidade de acolhimento na UE; o participante em mobilidade deve ter cidadania ou residência permanente num país elegível do alargamento. Primeiro cut-off: 12/11/2026, 17:00 de Bruxelas; a chamada prevê outras rondas até 03/05/2028. Portanto, a data na tabela é a próxima ronda, não o encerramento definitivo. [Termos oficiais, pp. 4–6](https://ats-public-files-production.s3.eu-central-1.amazonaws.com/opportunity/6a5e11aa7bcf247c176cda00/f6538a8e-ee79-4a09-9ce6-766eeefe4d2a-Policy_Enlarge_Open_Call_terms_and_conditions_v.Final.pdf), consultados nesta revisão. A [FAQ v4, §§1.6, 2.8 e 3.8](https://ats-public-files-production.s3.eu-central-1.amazonaws.com/opportunity/6a5e11aa7bcf247c176cda00/4bd984f1-a15c-40fc-9bd7-73d955c47018-Policy_Enlarge_FAQ_v.4.pdf) esclarece a afiliação institucional, a mobilidade física e que o acolhimento europeu não implica uma visita de retorno financiada. [Página atual de candidatura e documentos](https://opportunities.getonepass.eu/open-opportunities/policy-enlarge).

Limitação conhecida, coerente com a recuperação autorizada: palavras genéricas como `financial`, `payment` e `digital` podem sugerir FinTech em concursos cujo objetivo não é FinTech. Biografia e palavras-chave pessoais são informação do perfil; o cruzamento atual usa as áreas selecionadas e a classificação textual original das oportunidades. Não foi introduzido novo score, filtro de elegibilidade ou motor. Nenhuma oportunidade foi removida, reclassificada ou marcada como elegível.

## Percurso real preenchido e correção móvel

A releitura autenticada confirmou revisão 2 do perfil, associação à membership atual, biografia/palavras-chave preenchidas e duas áreas: Cibersegurança e FinTech e Economia Digital. Os valores apresentados no formulário coincidiram com o serviço; não se inferiu que todas as competências profissionais cabem nesta taxonomia do piloto. Biografia sobre RH/RGPD e palavras-chave RGPD/compliance/Quality assurance foram preenchidas pelo titular e preservadas.

O ensaio `realProfileReview.cjs` passou o percurso Organização → Unidades → Pessoas → ficha, perfil próprio → Matching, duas ligações para detalhes centrais e consulta inversa de pessoas para cada oportunidade. Matching próprio e por pessoa produzem os mesmos resultados. Zero erros JavaScript e zero escritas de negócio; hashes dos dados antes/depois iguais. A primeira tentativa encontrou um localizador exato incompatível com o texto inicial de uma textarea preenchida; a correção ficou no script de verificação, sem alterar o formulário.

A inspeção das capturas encontrou uma diferença móvel: o segundo `details` da célula de correspondências ocupava a coluna dos rótulos. Corrigida apenas a regra CSS local em até 768 px, dispondo rótulo e explicações em linhas completas. Desktop e algoritmo preservados. Build frontend após correção PASS; ensaio Chrome/OIDC repetido após a alteração PASS, com capturas 1440/1008/390 px sem overflow e inspeção visual aprovada. [Prova final](../../output/playwright/c4g-pilot-people/real-profile/review.json), às 20:19 UTC; [captura móvel corrigida](../../output/playwright/c4g-pilot-people/real-profile/matching-390.png). As suites extensas anteriores não foram repetidas, pois não houve alteração de backend, permissões, persistência ou classificação.

A comparação foi regenerada e validada em Chrome (`PILOT_PEOPLE_COMPARISON_PASS`), separando imagens sintéticas de paridade, capturas históricas da ativação e capturas atuais do perfil real. Sintaxe dos scripts e verificação de whitespace PASS. Nenhuma escrita de negócio nesta revisão; nenhuma alteração ao catálogo, às competências ou aos acessos. Veredicto final: **ready to close**; critérios da entrega 2 satisfeitos, sem bloqueadores no âmbito. Fecho documental registado; entrega 3 não iniciada. A pertinência de uma futura candidatura continua uma decisão sobre o projeto e os requisitos do concurso, não condição para demonstrar a recuperação do Matching.
