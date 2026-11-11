# Entrega 3 — recuperação da lista de candidaturas

2026-10-17. Incremento E3-02 implementado e validado; pronto para revisão visual do utilizador. A entrega 3 completa permanece In Progress.

## Resultado

- Tabela partilhada com `ApplicationsList.jsx`, composição do piloto, oito colunas e etapas com contagens; pesquisa, ordenação global e paginação de 25 no servidor. Responsável da organização, cêntimos exatos e prazo da oportunidade explícito.
- Seletor de estado com destinos permitidos, confirmação com motivo, revisão esperada e histórico existentes. Repetição da mesma intenção após resposta incerta/reload; nenhum envio externo ao financiador.
- Nova rota `/api/applications/browse`; lista anterior preservada para Dashboard e restantes consumidores. Nome do responsável apenas após autorização da candidatura, ligado à membership da mesma organização; sem contactos/emails.
- Contagens incluem pesquisa/oportunidade antes de selecionar estado. Cursor assinado vinculado ao ator, organização, filtros, ordenação e conjunto autorizado; alterações invalidam a paginação em vez de repetir/saltar linhas.
- Erros não aparecem como lista vazia. Mudança de contexto desmonta os dados antigos; cabeçalho de contexto nos pedidos da nova vista impede executar um envio atrasado na organização entretanto selecionada.
- Sem migrações, alterações de grants ou escritas de negócio na instalação habitual. Tarefas, revisão documental, estado inicial e campos anteriores preservados.

## Validação

| Prova | Resultado |
| --- | --- |
| Build frontend | PASS |
| Componentes: lista, formulário/detalhe, tarefas e revisão | 17 testes PASS |
| Backend: lista/capacidades, contratos, campos, resumos e tarefas | 19 testes PASS |
| Sintaxe JS e diff check focados | PASS |
| PostgreSQL/HTTP e Chrome finais | PASS: 32 candidaturas, várias páginas, pesquisa/contagens, ordenação exata, nomes/prazo central, contexto divergente, cursores inválidos, acesso parcial/revogação e A/B; mudança com motivo, resposta perdida/reload/replay e móvel |
| Chrome/OIDC no ambiente habitual | PASS: lista/formulário, Pessoas, perfil, Matching, catálogo e responsáveis; zero escritas de negócio e fingerprints preservados |

O primeiro ensaio com várias páginas excedeu o lease de 10 segundos porque repetia F5/F7 para a mesma oportunidade e para cada opção de apresentação. Corrigido mantendo auditoria individual das candidaturas, reutilizando apenas a decisão da mesma oportunidade durante o guard válido e calculando opções de transição com a política existente. O comando continua a ser autorizado/auditado integralmente. Não se aumentou o lease nem se alterou o motor de autorização. Testes verificam vínculo exato do grant, versões e expiração do guard/membership. A leitura tem limite de segurança de 10 000 linhas e falha fechada; não foi efetuado ensaio de carga até esse limite.

O percurso Chrome anterior passou paginação, pesquisa, ordenação, mudança de estado e resposta perdida; parou no seletor móvel por nome acessível ambíguo. Foram acrescentados nomes acessíveis explícitos aos controlos Ordenar por/Ordem. A execução final passou integralmente, incluindo ambos os controlos móveis. Capturas revistas a 1440/1280/1008/390 px; sem extravasamento horizontal da página. Comparação HTML aberta e inspecionada no Chrome.

[Comparação lado a lado](../../output/playwright/c4g-application-list/comparison.html). Veredicto: incremento pronto para revisão visual, sem correções obrigatórias conhecidas no âmbito; entrega 3 global permanece em curso.

Scripts: `test/integration/application-list/`. Evidência: `output/playwright/c4g-application-list/`. Referência visual preservada do commit `3a79b25539040c2024051cf9ab6295680b760277`; dados simulados no piloto e PostgreSQL descartável na lista C4G, sem confundir com a organização habitual vazia.

## Limites e sequência

Parceiros/contactos e transporte real de anexos permanecem por recuperar. A implementação da lista não declara estes percursos operacionais nem fecha a entrega 3. Sem commit, merge, push ou deploy. Próximo bloco: parceiros e contactos privados por candidatura, com histórico e página agregada autorizada.
