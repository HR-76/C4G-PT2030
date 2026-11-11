# GCNI — apresentação e campos da oportunidade

Implementados estados coloridos do aviso e das candidaturas privadas da entidade, tipificação/áreas na tabela e ficha, Topic/candidatos elegíveis/duração/localização na ficha. As colunas de estado ficam junto ao título. As cores são acompanhadas por texto; a ausência de candidaturas só é afirmada para os registos visíveis ao utilizador.

## Dados e moeda

EU11145: tópico estruturado, elegibilidade e localização extraídas das secções explícitas de furtherInformation; duração do metadado duration; áreas temáticas enumeradas na descrição. Artefactos arquivados verificados por hash e digest da revisão, sem recolha externa. PT: natureza Concurso/Convite, objetivos específicos identificados como tal, beneficiários Pública/Privada e territórios com âmbito não especificado preservado. Duração ausente nunca inferida de datas previstas.

Cada novo campo possui origem, URL e localizador. O contrato recebe apenas propriedades opcionais estritamente validadas. Nenhuma alteração a modelo, projeções, geração, IDs, revisões ou moeda canónica. A listagem aproveita as projeções já verificadas; não acrescenta consultas à base para o enriquecimento.

EUR por regra geral na apresentação, conforme pedido: `120 000,00 €`. A moeda ausente é identificada; USD e outras moedas confirmadas não são convertidas. Precisão e montantes grandes preservados como strings; nunca arredondamento binário. Duas casas mínimas, precisão adicional preservada quando publicada.

## Validação e autorrevisão

- Backend completo: 2 548 passaram, sete ignorados existentes, zero falhas.
- Frontend completo: 614 passaram. Após o ajuste final da ordem das colunas e da expressão «Sem candidaturas visíveis», 43 testes focados passaram e o build final passou.
- 26 verificações ponta a ponta PASS com autenticação real local e contas sintéticas, tenant034/central048. Candidatura criada pela API autorizada, estado lido na tabela, campos e euros verificados, versão móvel sem excesso de largura, registo de interesse preservado, revogação e isolamento confirmados.
- Regressões de contrato preservam exatamente o G2 histórico exceto a lista explícita das adições opcionais; fixtures anteriores mantidas. Evidências adulteradas, revisão divergente e acesso revogado são recusados.
- Revisão independente e revisão visual concluídas. A revisão corrigiu a designação do estado vazio para não sugerir acesso a candidaturas ocultas e aproximou os estados do título. Nenhum problema impeditivo no âmbito alterado.
- Os auxiliares dev/experiments/.gitattributes em falta na cópia inicial foram repostos antes da suite final; nenhuma falha foi ignorada para obter aprovação.

Evidência: `../reviews/catalog-read-acceptance-load/fabdbf84619b4ac3b659025517354317/results.json`. Contentores próprios removidos. As capturas deste ensaio precedem apenas a reordenação final das colunas (coberta pelo teste de estrutura DOM).

Sem alterações a permissões, migrações habituais, fontes ou duração da exposição. Não foi criada qualquer candidatura/interesse na entidade real.

Aplicado ao GCNI habitual com backup e comparação dos 20 ficheiros. Reiniciado exclusivamente o serviço `source-free-controlled`. Verificação final em 2026-11-02 20:53 UTC: frontend e saúde da API 200, catálogo anónimo 401, esquema 048, 178 oportunidades e 178 revisões, mesma geração ativa, fontes QUIESCED, zero recolhas, política COHORT para uma entidade e papel ORG_ADMIN. Confirmação pelo utilizador com a conta habitual permanece como aceitação humana; o ensaio automatizado autenticado foi realizado apenas na cópia isolada.
