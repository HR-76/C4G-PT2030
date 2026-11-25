# Dados fictícios para exploração do staging

Estado: carga concluída e verificada na BD e nas vistas principais da app, 14/11/2026. Pedido explícito do utilizador: acrescentar 30 candidaturas e dados relacionados no staging `app-teste.c4g.ai`, sem apagar o que existe.

## Âmbito autorizado

- Apenas staging; confirmar organização, bases e versão instalada antes de escrever.
- Acrescentar um lote identificado como `DEMO-20261114`, com identificadores estáveis para evitar duplicação ao retomar.
- Preservar todos os registos anteriores. Não alterar esquemas, permissões, contas, configurações de segurança ou fontes de financiamento.
- Fazer uma cópia das bases antes da inserção e guardar um manifesto dos identificadores criados e das contagens anteriores/posteriores.
- Não enviar emails, emitir documentos fiscais, criar acessos externos nem publicar dados fictícios em fontes externas.

## Conjunto pretendido

- 30 candidaturas: 5 identificadas, 10 em preparação, 7 submetidas, 4 aprovadas, 2 rejeitadas, 1 cancelada e 1 arquivada; estados e histórico coerentes.
- Cerca de 90 tarefas, com responsáveis existentes, estados variados e prazos passados/futuros.
- Interesses associados a oportunidades existentes, sem duplicar interesses já registados.
- Equipas com membros existentes e autorizados da organização; nenhum acesso novo implícito.
- Parceiros informativos fictícios, com contactos em `example.invalid`.
- Mensagens claramente identificadas como demonstração nas candidaturas do lote.
- Distribuição por unidades e áreas, quando os registos e as capacidades do ambiente o permitirem.
- Valores financeiros fictícios nas candidaturas para explorar indicadores; qualquer exemplo de faturação interna deve ser identificado como demonstração e não usar fornecedores fiscais.

## Verificação

- Confirmar que existem exatamente 30 novas candidaturas do lote e que o total anterior foi preservado.
- Confirmar relações, revisões, históricos, tarefas, participantes, parceiros e mensagens.
- Consultar dashboards, paginação, filtros, calendário, interesses, parceiros e matching com os dados inseridos.
- Distinguir inserção de dados de prova funcional: dados criados diretamente na base não provam o percurso de criação da API.
- Documentos, email e outras capacidades desligadas são assinalados como não testados; não inventar objetos, entregas ou aprovações para apresentar sucesso.

## Execução

Inventário de leitura confirmado em 14/11/2026: organização `b2bfd1d8-2a65-4f93-9405-2666ce38e7b7`
(`C4G Staging`), 6 candidaturas anteriores, 5 interesses, 1 unidade e 2 memberships ativas.
SSH funcional; a execução Docker exige uma execução pontual como root no terminal Hostinger.

O pacote de carga acrescenta também 6 unidades, 12 pessoas sem contas nem memberships,
perfis descritivos para essas pessoas, 10 interesses novos em oportunidades reais do catálogo,
60 alertas internos de inclusão em equipa e 6 avisos internos para os 2 membros existentes.
Nenhuma entrega externa, evento de email, documento ou fatura é inventado. Matching e calendários
podem consumir estes dados, mas a carga SQL não constitui prova dos seus percursos HTTP.

`demonstrationLoad.py` valida o alvo e as memberships; guarda backups Central/tenant e SQL,
insere apenas novas linhas numa transação, compara todas as linhas anteriores das tabelas afetadas
e valida as contagens antes de COMMIT. Um segundo arranque com os mesmos IDs não acrescenta dados.
O relatório é externo à BD e identifica a carga direta de demonstração; os históricos funcionais
incluem razões explícitas de simulação e não são apresentados como auditoria de ações HTTP reais.

A carga foi executada pelo utilizador como root no terminal Hostinger e devolveu
`DEMO_COMMITTED_AND_VERIFIED`. Relatório recolhido por SSH e conferido: todos os 21
deltas coincidem com as contagens planeadas; os 30 IDs de candidatura coincidem com o plano local.
Os checks de preservação de todas as linhas anteriores nas 21 tabelas passaram dentro da transação.

| Dados | Antes | Acrescentados | Depois |
| --- | ---: | ---: | ---: |
| Candidaturas | 6 | 30 | 36 |
| Tarefas | 0 | 90 | 90 |
| Parceiros | 0 | 30 | 30 |
| Mensagens de equipa | 0 | 60 | 60 |
| Interesses | 5 | 10 | 15 |
| Unidades | 1 | 6 | 7 |
| Pessoas | 2 | 12 | 14 |
| Alertas | 3 | 60 | 63 |
| Avisos internos | 0 | 6 | 6 |

Backups Central e tenant: `/srv/c4g-staging/backups/demo-20261114T203826867009Z`.
O diretório protegido inclui dumps validados com `pg_restore --list`, SQL e manifesto anterior.
Relatório final: `/home/c4gadmin/demo-20261114/demonstration-result.json`.
SHA-256 do SQL aplicado: `8989d877a272ab7bb95507d9e1d663034b38a90eba0e05b5922dd6bfc201df06`.

Validação local: 8 testes offline do gerador/carga aprovados, sintaxe JavaScript/Python
validada, lint aprovado; ficheiros transferidos conferidos por SHA-256.
Após autenticação do utilizador como Gestor Staging, verificação de leitura no browser:

- Candidaturas: 36; contagens por estado 6 identificadas, 11 em preparação, 8 submetidas,
  5 aprovadas, 3 reprovadas, 2 canceladas e 1 arquivada, em concordância com o lote e os dados anteriores.
- Parceiros: 30 registos, contactos `example.invalid` e ligações às candidaturas.
- Ficha de `[DEMO] Academia de Competências Digitais`: orçamento 200 000 euros / 70 000 euros,
  unidade, interesse de origem, 2 participantes, 3 tarefas (2 abertas e 1 concluída) e 2 mensagens carregadas no chat.
- Dashboard: 36 candidaturas / 25 ativas, estados, orçamentos, prazos internos e 4 candidaturas em atraso.
- O meu trabalho: 21 tarefas por concluir do Gestor Staging, agrupadas em 2 atrasadas, 1 hoje e 18 próximas.
- Calendário da entidade: prazos carregados no mês de novembro de 2026, incluindo dias com várias entradas.
- Matching: 56 oportunidades para o perfil preexistente do Gestor Staging. As 12 novas pessoas têm perfis
  descritivos sem áreas temáticas atribuídas; não afirmar que o matching dessas pessoas foi validado.
- Alinhamento estratégico: a app pede associação de áreas temáticas aos objetivos; não foi alterada
  a estratégia anterior da organização.

A inspeção confirma leitura/renderização das vistas acima. Não testa todas as mutações, filtros,
paginação completa, envio de emails, faturação, documentos ou revisão documental.
