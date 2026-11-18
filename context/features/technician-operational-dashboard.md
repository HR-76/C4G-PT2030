# Dashboard operacional do Técnico

## Objetivo
Apresentar primeiro o trabalho atribuído ao Técnico, usando os dados autorizados de O meu trabalho e os padrões visuais existentes inspirados no Metronic.

## Critérios de aceitação
- O perfil Técnico vê tarefas por concluir com indicação de prazo e ligações à equipa da candidatura, além de atalhos para candidaturas, alertas, documentos e catálogo.
- A lista é explicitamente limitada aos resultados carregados; carregamento, erro e ausência de tarefas são distintos.
- Os restantes perfis mantêm o dashboard existente; nenhuma permissão ou contrato de API é alterado.
- A apresentação adapta-se a ecrãs estreitos, com foco visível e testes direcionados e build.

## Continuação: alertas, revisões e perfil
- A sessão expõe o código reconhecido do perfil como dado de apresentação; a autorização continua no servidor.
- Alertas recentes usam a lista autorizada existente, sem marcar como lidos. Revisões são resumidas por candidatura a partir da primeira página autorizada; não representam atribuição individual nem uma lista completa.
- Cada secção distingue carregamento, erro e ausência; contexto trocado cancela pedidos anteriores.

## Gráficos do Técnico (18/11/2026, em Review)

Pedido do utilizador em 18/11/2026: o Dashboard do Técnico passa a ter gráficos. Aprovados três.

- **As minhas candidaturas por estado.** Anel e legenda com as candidaturas a que o Técnico tem acesso, as mesmas da lista de Candidaturas. Cada estado abre a lista filtrada.
- **Tarefas por prazo.** Tarefas por concluir atribuídas ao Técnico, divididas em Em atraso, Hoje e Próximas.
- **Carga por candidatura.** As oito candidaturas com mais tarefas por concluir do Técnico, com o número em atraso; indica quando há mais candidaturas com tarefas.

Contrato:

- `GET /api/applications/technician-dashboard` acrescenta a parte `applications`, com `{total,countsByStatus}`, obtida pela leitura protegida `browse` já existente, sem filtros; a rota entrega só a contagem. A parte corre depois das três anteriores e segue a mesma regra: recusa ou indisponibilidade vêm como `{error:{code}}` sem afetar as restantes.
- A leitura `workMine` acrescenta `byApplication:{items:[{applicationId,title,total,overdue}],total}`, calculado sobre as mesmas tarefas filtradas e autorizadas da resposta. `/my-work` recebe o mesmo campo e não o usa.
- Nenhuma permissão, migração ou tabela é alterada. Custo conhecido: a leitura `browse` também prepara a primeira página da lista, que o dashboard não usa.

Critérios de aceitação:

1. O Técnico vê os três gráficos com os mesmos números da lista de Candidaturas e de O meu trabalho.
2. Sem candidaturas ou sem tarefas, cada gráfico diz que não há dados, sem mostrar zeros enganadores.
3. Uma parte recusada ou indisponível afeta só o seu gráfico; as listas existentes continuam a aparecer.
4. Os gráficos adaptam-se a ecrãs estreitos e os valores estão disponíveis como texto.
5. Os restantes perfis mantêm o dashboard existente.

Validação de 18/11/2026: backend focado (`httpTechnicianDashboard`, `myWork`) 10 aprovados; suite backend 3540 aprovados, 9 ignorados e 1 falha alheia (SEC-AC-01, `sessionStorage` em `DirectLogin.jsx`). Frontend 1161 testes: 1159 aprovados e 2 falhas por tempo limite em `ApplicationDocumentsReview` e `ApplicationPartners`, com a suite backend a correr em simultâneo; ambos os ficheiros passam isolados (50). Lint e build aprovados. Sem PostgreSQL real, sem browser e sem alteração no staging: a agregação SQL nova de `workMine` não foi executada numa base.
