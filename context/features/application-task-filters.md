# Filtros de tarefas da candidatura
Estado: Review — 11/11/2026.

## Contrato
Filtros exclusivos Todas, Minhas tarefas, Por concluir (OPEN), Sem responsável (atribuição ausente). Aplicados à lista e calendário, preservando mês selecionado. Usar currentMembershipId devolvido pelo servidor após autorização, nunca comparar membershipId com userId. Sem identidade confirmada, Minhas tarefas indisponível com explicação.
A API pagina por 25: filtros e contagem aplicam-se às tarefas carregadas, aviso permanente e Mais tarefas disponível mesmo com zero resultados. Não carregar páginas ilimitadas automaticamente. Estado vazio distingue ausência de correspondências de ausência de tarefas. Limpar filtro recupera lista. Reset ao mudar candidatura/utilizador/organização. Filtros não alteram resumo, participantes, permissões ou tarefas.
Sem responsável não significa nome indisponível ou acesso inativo. O contrato atual exige responsável na criação; este filtro pode legitimamente não ter resultados. Não tornar atribuição opcional.
## Critérios
Testar membership diferente de userId, estados concluído/cancelado, nome indisponível, paginação com correspondência tardia, calendário, consulta sem edição, reset de contexto. Build e navegador desktop/mobile sem overflow; preservar calendário.

## Resultado e validação
- Filtros exclusivos aplicados à lista e ao calendário; mês preservado e aviso de âmbito carregado. Mais tarefas permanece disponível sem correspondências. Sem responsável usa apenas atribuição ausente, não nomes desconhecidos.
- API GET /applications/:id/work acrescenta currentMembershipId do actor autenticado depois da autorização. Não há input de identidade do cliente nem alteração de permissões/SQL/paginação.
- 73 testes frontend focados e 8 backend aprovados. Suite frontend completa: 895/895 (102 ficheiros). Build e node --check aprovados. git diff --check sem erros.
- Chrome a 1440/390/320 px com API simulada: seleção, calendário, paginação, teclado e ausência de overflow/erros JS. Capturas inspecionadas. Script output/playwright/task-filters-check.cjs. Cenário browser de consulta; edição coberta pelos testes existentes. Não testado contra dados reais nem feita instalação/reinício do backend.
- Capturas tarefas-filtros-1440.png e tarefas-filtros-390.png na pasta de visualizações da sessão.

## Evolução: filtros completos — 11/11/2026
Estado: Review. Pedido confirmado: pesquisar todas as páginas. Backend aplica taskFilter (all/mine/open/unassigned) antes de LIMIT; mine usa actor.membershipId, sem input de utilizador. Cursor vinculado ao filtro além de organização/utilizador/candidatura. Frontend separa resultados pesquisados dos dados usados pelo Resumo e participantes. Calendário/modal preservados; calendário cobre resultados apresentados, mais resultados mantém filtro. Cancelar respostas antigas e distinguir vazio/erro/carregamento. Testar resultados depois da página 1, isolamento de cursor, filtro inválido, mudança rápida e paginação. Não alterar permissões nem dados.

### Validação dos filtros completos
77 testes frontend focados, suite completa 911/911 e 15 testes backend (tarefas/equipa) aprovados; build e node --check aprovados. Backend filtra antes do LIMIT e vincula cursor ao filtro e membership em Minhas tarefas; sem alteração de schema. Respostas tardias descartadas, falhas distinguem-se de vazio e permitem repetir. Resumos identificam a lista Todas carregada como âmbito, sem assumir total global.
Chrome com API simulada a 1440/390/320 px: 33 tarefas, das quais as três pessoais ficam depois das primeiras 25; filtro encontra-as diretamente; paginação de Por concluir mantém filtro; calendário compacto, modal, teclado e limpeza preservados, sem overflow/erros JS. Script output/playwright/task-server-filters-check.cjs. Capturas tarefas-pesquisa-completa-1440.png e tarefas-pesquisa-completa-390.png inspecionadas. Sem prova com PostgreSQL/dados reais, nem reinício/publicação do backend.
