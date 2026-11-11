# Detalhes e filtros — 2026-10-17

## Confirmação na fonte

Consulta pública direta da API europeia (uma página, cinco resultados, sem escrita) e das quatro fichas no Chrome. Os caminhos originais das três chamadas em cascata usavam `ccm2Id`; abriram apenas o esqueleto do portal. Os caminhos com `callccm2Id` carregaram os títulos, prazos e condições correspondentes. Não confundir a referência do tópico financiador com a identidade da chamada em cascata.

| Oportunidade / ficha oficial | Próximo prazo confirmado | Condições principais observadas |
| --- | --- | --- |
| [Gnomon](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/11145) | 03/01/2027, 04:59, hora de Bruxelas | Estágios para estudantes de medicina, engenharia e biomedicina/bioinformática; quatro meses, até €1 500/mês. Seleção pelo promotor Gnomon, não candidatura institucional genérica à Comissão. Existem várias rondas. |
| [EFCSN](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/15569) | 31/05/2028; pode terminar antes por esgotamento de fundos | Entidades individuais de fact-checking da UE/países associados ao DIGITAL, certificadas ou demonstrando cumprimento dos padrões. Apoio a necessidades de proteção; taxa de financiamento de 50%, normalmente até €20 000, excecionalmente €40 000. Confirmado também na [página do promotor](https://efcsn.com/funding-opportunities/efcsn-protection-grants/). |
| [SEAP](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/EDF-EDIP-P-2026-2027-FNLC-SA-SEAP) | 12/11/2026, 17:00, hora de Bruxelas | Funcionamento inicial de SEAPs já constituídas durante pelo menos um ano; máximo de €2 milhões por projeto. As condições detalhadas de países/elegibilidade remetem para a secção 6 do call document: não foi realizada auditoria jurídica integral desse documento. EDF é a configuração técnica sob a qual o portal apresenta EDIP. |
| [POLICY ENLARGE](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/15261) | 12/11/2026, 17:00, hora de Bruxelas | Instrumentos 1/2 exigem pelo menos duas entidades independentes em países de alargamento diferentes. Instrumento 3 permite mobilidade com entidade de acolhimento da UE/país associado, com requisitos próprios do participante. Candidatura em inglês; uma subvenção por terceiro durante toda a chamada. |

Estes resultados confirmam datas e condições principais publicadas, não elegibilidade de uma entidade concreta. O catálogo guarda datas civis; não acrescentámos uma conversão de horas do índice, que diverge da apresentação do portal em alguns registos. A interface remete explicitamente para a hora-limite e condições completas oficiais. A confirmação desta revisão não altera automaticamente `validationState` nem substitui aprovação editorial.

## Correção

- `backend/src/fundingTenders/source.js`: campos `description`/`furtherInformation` e fallback `beneficiaryAdministration`, além de `descriptionByte`; ligação de cascata construída com o identificador de chamada oficial.
- `sourceDescription.js`: extração para texto, parágrafos, entidades, limite de 4 000 caracteres e marcador explícito de excerto. O React continua a renderizar como texto; nenhum HTML externo é executado.
- `repository.js`: programas distintos de todo o catálogo, independentes da página/filtros. HTTP continua protegido pelas mesmas memberships; resposta de listagem ganha `programmes`, sem novo endpoint ou migration.
- `CentralOpportunities.jsx`: seleção de programa; prazos atuais, 7/14/30 dias, passados, todos e intervalo manual. Atalhos incluem hoje e o último dia, em UTC, usando os filtros de servidor existentes. Descrição separada dos metadados, aviso de excerto/idioma/hora e ausência explícita quando indisponível. Títulos com quebra de linha.

Atualização pela operação ADMIN existente: **SUCCESS, zero criadas, quatro atualizadas, zero falhas**. Identidades e cinco registos históricos preservados; não foi criada candidatura.

## Limitações encontradas

1. **Deduplicação das chamadas em cascata:** os cinco resultados contêm Gnomon (`11145`) e METU (`11143`), ambos sob `DIGITAL-2023-SKILLS-05-SPECIALEDU`. Não são duplicados. A implementação atual mantém apenas Gnomon. A descrição anterior «uma identidade duplicada» em current-selection.md não prova duplicidade funcional. Corrigir esta identidade com reconciliação explícita dos registos existentes e preservação de revisões/candidaturas antes de aumentar a recolha. Não alterámos chaves silenciosamente nesta correção dos quatro detalhes.
2. Duas tentativas de login ADMIN foram recusadas por `MFA_EVIDENCE_INSUFFICIENT`; uma tentativa posterior normal apresentou `acr=c4g-loa2` e `amr=[pwd,otp]` e foi aceite. O realm local usa fluxo F2 com LoA2 de dois segundos; associação à intermitência é hipótese, não causa provada. Nenhuma política, credencial ou autorização foi relaxada. Diagnóstico temporário retirado do arranque; ambiente no arranque normal. A fiabilidade do login de demonstração continua a exigir atenção.
3. Amostra limitada; código de programa numérico ainda existe no histórico. Não se declara catálogo completo, validação editorial global, condições jurídicas integrais ou produção.

## Validação

Backend focado: 18/18; frontend focado: 6/6; sintaxe dos três JS alterados e build PASS. Prova real OIDC/worker/PostgreSQL: quatro descrições não vazias sem tags, três ligações corrigidas, candidatura anterior e histórico preservados. Capturas e prova de filtros/móvel são registadas no fecho deste incremento.
