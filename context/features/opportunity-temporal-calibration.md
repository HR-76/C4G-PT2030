# P2 — estados temporais e atualização dos existentes

Estado: Complete — incremento P2 implementado, revisto e validado localmente. Migração034 e primeira recolha P2 autorizadas e concluídas em28/10/2026. Seis ambiguidades da fonte ficam explicitamente para revisão humana, conforme a política confirmada. O plano global P0–P5 continua ativo.

## Contrato

Separar estado publicado pela fonte, janela temporal calculada e lifecycle administrativo. Uma oportunidade com abertura futura não conta como aberta. Datas civis são inclusivas, sem inventar hora/fuso. Instantes explícitos preservam o valor original e são comparados como instantes; todas as rondas são conservadas. Uma correção manual de prazo prevalece sobre o calendário importado. Ausência de informação não equivale a abertura.

A atualização dos identificadores conhecidos deve continuar depois de saírem da descoberta. Nunca arquivar por ausência, eliminar histórico ou reescrever a revisão guardada na candidatura. Prorrogações e mudanças de estado criam revisões; ambiguidades exigem revisão, sem escolher pela ordem dos resultados.

Dashboard e catálogo distinguem abertas, previstas, encerradas, canceladas e desconhecidas; o estado administrativo permanece visível separadamente. Não definir um limiar de desatualização sem cadência/SLO confirmado. Mostrar a última observação e inconsistências verificadas.

## Aceitação e validação

- Regressões para abertura futura, prazo civil hoje, instante exato, offsets/mudança de hora, múltiplas rondas, prorrogação, cancelamento e datas desconhecidas.
- POCTEP 9 preservado e encerrado; 10 permanece na janela vigente em 28/10.
- Identidade estável, revisões imutáveis, correções manuais preservadas, repetição idempotente e isolamento de organizações.
- Cobertura de atualização dos conhecidos fora da descoberta, incluindo ausência e versões contraditórias, com retoma durável e contagens explicáveis.
- Testes focados, suites completas, build, sintaxe e prova visual. Qualquer novo gate PostgreSQL é preparado antes de solicitar autorização específica; não aplicar SQL em Dev por inferência.

## Evidência inicial

`output/funding-temporal-20261028/known-query.json`: consulta pública por cinco identificadores antigos devolveu dez resultados, incluindo versões com estados 31094502/31094503 e horários diferentes. A seleção da versão encerrada por prioridade não está demonstrada como correta. Política conservadora confirmada pelo utilizador: preservar dados e sinalizar revisão. Antes de P2, o dashboard ignorava a abertura e o conector excluía expirados antes da atualização.

P3 enriquecimento, Portugal 2030 e distribuição de alertas não fazem parte deste incremento.

## Implementação

- Metadados opcionais `sourceTemporal` nas revisões: estado publicado, código original, todas as aberturas e prazos. Validação limitada a 64 valores por calendário. Datas civis e instantes com offset mantêm a precisão da fonte. Códigos desconhecidos não são convertidos em cancelamentos; a consulta dos conhecidos exige revisão nesses casos.
- Classificação dinâmica em JavaScript e SQL: abertura futura, prazo civil inclusivo, instante-limite exclusivo, próxima ronda, cancelamento e incerteza. O dia UTC de referência é comum à descoberta, catálogo e resumo de oportunidades; não representa um fuso atribuído à fonte. O calendário de negócio das candidaturas mantém-se independente. Correções manuais de datas prevalecem sobre calendários importados. Estado administrativo mantém-se independente.
- Migração aditiva 034: alvos de atualização congelados por ciclo e indicação de revisão da fonte na identidade; sem alteração das revisões existentes ou dados tenant. Owner estável, runtime limitado e tabela de manutenção inacessível ao leitor do catálogo. Fingerprints de schema/autoridade/ACL fixados e testados.
- Os conhecidos são verificados por identificador antes de qualquer alteração, mesmo quando aparecem na descoberta. Esta pesquisa inclui estados e períodos fora do filtro de descoberta. Uma resposta truncada, inválida ou contraditória não escolhe uma versão. Dados anteriores e UUID mantêm-se; ausência nunca arquiva automaticamente.
- Cada consulta conhecida é um lote persistido, retomável e sujeito a lease/fence/autorização. Sucessor e outbox permanecem atómicos. Contagens de descoberta e manutenção são separadas; os conhecidos aguardando verificação não aparecem como registos perdidos. Falha/expiração não inflaciona as contagens de descoberta.
- POCTEP/Interreg conservam e atualizam conhecidos fora do período de descoberta. Calendário completo permite sinalizar conhecidos ausentes; um lote limitado não prova ausência. Horas apenas descritas em prosa permanecem no texto original, sem conversão de fuso por inferência.
- Catálogo: estado temporal, filtro e calendário completo; revisão da fonte explícita. Dashboard distingue abertas, previstas, encerradas, canceladas e desconhecidas. Aviso contextual na candidatura compara a revisão atual sem alterar a revisão nem o prazo interno guardados. Distribuição persistente de alertas continua fora deste recorte.
- Leitor admite explicitamente schemas 033/034. Worker antigo não pode admitir novos pedidos P2. Os scripts/gates P1 ficaram limitados a 033, para não aplicar 034 por efeito da extensão do manifest.

## Validação concluída

- Regressões executadas antes das implementações correspondentes. Backend: **1614 PASS, 0 FAIL, 7 SKIP** preexistentes. Frontend: **363 PASS**, build PASS. Sintaxe dos 24 ficheiros JavaScript principais PASS.
- Gate P2 expressamente autorizado: `test/integration/funding-tenders/temporal.ps1`, PostgreSQL descartável 5562, migrações até 034 e dados sintéticos. Evidência final: `output/funding-temporal-20261028/gate-d9b64d9443dc4742ac7bc88980154c04/verification.json`. Manifest fixado e preflights PASS; continuação/retoma, repetição, preservação de versões contraditórias/ausentes, UUID/revisões, filtros SQL, paridade temporal, expiração, ACL e revogação a meio do processamento PASS. Nenhum contentor com a etiqueta do gate permaneceu.
- A primeira tentativa falhou na ligação durante o arranque transitório do PostgreSQL; a espera pela ligação TCP foi corrigida. Tentativas e fingerprints intermédios preservados, sem substituir a prova final.
- Chrome com API sintética: estados, filtro e detalhe em 1440/390 px, sem overflow. Imagens e script em `output/playwright/funding-temporal-*`. A prova visual foi corrigida para aguardar a resposta assíncrona do filtro.
- Consulta **READ ONLY** local: 533 identidades, 549 revisões, 1 membership, zero recolhas ativas. Classificação dos dados já armazenados em 28/10: **262 abertas por datas, 265 previstas, 6 encerradas, 0 canceladas, 0 desconhecidas**. Evidência: `output/funding-temporal-20261028/local-read-only-classification.json`. Não é uma nova validação dos dados publicados.

## Ativação preparada, não executada

`backend/scripts/localPlatform/activateFundingTemporal.js --check` passou em Dev schema 033. `--apply` aceita apenas o destino local confirmado, exige ausência de recolhas ativas e aplica no máximo 034, preservando contagens. Antes da migração: parar os processos locais de API/worker identificados para impedir novos pedidos; depois: reiniciar worker/API com o código P2, verificar capabilities/readiness e iniciar a recolha autorizada. Não houve aplicação de 034 em Dev, reinício do worker ou recolha P2 real nesta implementação.

Na coleção EU atual, a verificação conservadora acrescentará até **531 consultas por identificador** às páginas de descoberta. Cada consulta mantém limites/retries e checkpoint; uma resposta com mais de 25 versões exige revisão. A duração real e quotas só podem ser calibradas na primeira execução local. Não existe agendamento ou SLO novo. Os novos identificadores continuam no pipeline P1 de descoberta/deteção de duplicados; esta fase protege a atualização dos já conhecidos.

## Ativação local autorizada

O utilizador autorizou explicitamente aplicar 034, parar/reiniciar apenas API/worker C4G e executar a primeira recolha P2. Migração aplicada preservando533 identidades,549 revisões e1 membership. API/worker reiniciados; capabilities de cobertura e atualização dos conhecidos confirmadas, HTTP5000/3000 saudáveis e endpoint administrativo anónimo401.

Recolha iniciada às23:19:35Z pelo mesmo repositório central e administrador da primeira recolha P1, com autorização atual, idempotência, auditoria/outbox e worker. Não foi simulado um clique na interface. Ciclo `0be7b4aa-5a37-4de6-9221-b380147341f4`,531 alvos conhecidos congelados. Evidência em `output/funding-p2-live-20261028/`; baseline inclui hashes das revisões anteriores e correspondências de identidade para verificação final.

## Resultado da primeira recolha P2

Ciclo `0be7b4aa-5a37-4de6-9221-b380147341f4`: início23:19:36Z, fim23:34:49Z em28/10/2026, **15min13s**. Descoberta:45 páginas,1119 resultados=526 aceites+593 excluídos; zero duplicados, inválidos ou falhas. Foram verificados **todos os531 conhecidos**, sem pendências: **525 atualizados e6 CONFLICT**. As consultas por identificador devolveram537 versões, pois cada um dos seis conflitos apresentou duas versões. Total576 lotes persistidos:45 de descoberta+531 de verificação.

O estado final `PARTIAL / SOURCE_KNOWN_REVIEW_REQUIRED` resulta exclusivamente dos seis casos de revisão; não representa páginas em falta ou interrupção do worker. Os contadores principais da descoberta e `knownRefresh` são distintos; a interface soma as atualizações de conhecidos na coluna Atualizados e explicita os casos por rever.

Preservação confirmada por hashes: **533 identidades estáveis e549 revisões anteriores intactas**. Total de revisões549→1074, exatamente525 novas revisões; nenhuma alteração destrutiva. Os seis conflitos mantêm também o `current_revision_id` anterior. Memberships1→1; zero jobs ativos ao concluir. Não houve escrita em bases tenant ou alteração de snapshots de candidaturas pelo fluxo de recolha.

Catálogo final: **261 abertas,265 previstas,1 encerrada,6 por confirmar**, sem cancelamentos confirmados. A diferença face à classificação inicial por datas decorre dos seis avisos agora sinalizados para revisão. **525 fichas têm metadados temporais estruturados e61 preservam mais de um prazo/ronda.** POCTEP não foi recolhido novamente nesta execução EU; os seus dois registos foram preservados.

Casos preservados para revisão:

- `CEF-T-2021-AFIFCOEN-WORKS-LNG`
- `CEF-T-2021-AFIFCOEN-WORKS-ZE`
- `CEF-T-2021-AFIFGEN-UNITS`
- `CEF-T-2021-AFIFGEN-WORKS-LNG`
- `ERASMUS-EDU-2022-ECHE-CERT-FP`
- `ESC-HUMAID-2021-QUAL-LABEL-FP`

Evidências finais: `output/funding-p2-live-20261028/verification.json`, `final-details.json`, `reader-verification.json` e hashes em `baseline.json`. API5000/frontend3000 saudáveis, endpoint administrativo anónimo401, leitor restrito real com schema034/filtro temporal/resumo verificados e worker com capabilities P2. Sem commit, push ou produção. Revisão final: pronta a fechar esta fase; os seis casos de dados permanecem visíveis e não foram resolvidos por inferência.

## Revisão documental dos seis avisos — concluída

A [revisão de 28/10/2026](../research/opportunity-source-conflicts-2026-10-28.md) confrontou os 12 resultados públicos com as fichas oficiais. Quatro CEF encerraram em 07/11/2023; ECHE retirou o corte 2027 e termina em 24/03/2026, embora a fonte mantenha OPEN; a sessão ESC está explicitamente fechada, com corte 22/09/2026 e certificação prevista em regime contínuo. A coexistência SEDIA/CENTRICITY está observada, sem contrato público de precedência global. Datas civis em `actions` aparecem como meia-noite UTC no índice; as horas oficiais diferem.

Esta pesquisa não alterou a APP nem os seis conflitos. O incremento implementado P2 mantém a validação anterior; os novos achados exigem correção complementar de resolução/proveniência e precisão temporal. O relatório especifica conclusões por campo e os limites da evidência.

A [correção complementar P2](opportunity-source-resolution.md) foi concluída e ativada localmente em 29/10, após autorização específica: seis decisões documentadas, 035 aplicada e 1074 revisões anteriores preservadas. Os seis conflitos estão resolvidos; referências anteriores à pendência descrevem o estado histórico da primeira recolha. Gate final, suites, browser e leitor restrito real PASS.

Próximo passo: P3 — enriquecimento das oportunidades.
