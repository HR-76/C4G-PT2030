# O meu trabalho e Calendário — abertura e continuidade

Estado: Review. Sem medição em ambiente real.

Quinto bloco da revisão de desempenho página a página (14/11/2026). Blocos anteriores: [Dashboard](dashboard-opening-performance.md), [Oportunidades e Candidaturas](opportunities-table-opening-performance.md), [detalhe da candidatura](application-detail-opening-performance.md) e [Interesses](interests-opening-performance.md).

## Alterações (só frontend)

1. **O meu trabalho: voltar à janela.** Recuperar o foco da janela deixou de apagar a lista e de fechar a tarefa aberta. A primeira página é lida de novo em segundo plano; a tarefa aberta acompanha a nova resposta e só fecha se já não constar dela. Uma leitura recusada continua a retirar a lista e a fechar a tarefa. Com mais páginas carregadas não há leitura automática: «Atualizar» recomeça da primeira.
2. **O meu trabalho: filtrar ou atualizar.** As tarefas anteriores ficam no ecrã, esbatidas e inativas, até chegar a resposta.
3. **Calendário: reabertura.** O mês e a agenda da mesma vista (mês, candidatura, estado, pesquisa, dia e página) usam os [dados confirmados](confirmed-reads-page-reuse.md): aparecem de imediato e são lidos de novo; uma leitura recusada retira-os.
4. **Calendário: escolher um dia ou página.** O título muda de imediato para a nova seleção e os prazos anteriores ficam por baixo, esbatidos e inativos, até chegar a resposta. A mensagem de «sem prazos» e a paginação só aparecem com a resposta nova.

## Validação

- `MyWork.test.jsx` (+3) e `OrganizationCalendar.test.jsx` (+3). Frontend 1056 aprovados, build e lint aprovados. Sem browser nem sessão real.

## Não feito

5. Pedir só a agenda ao escolher um dia (o pedido atual devolve também o mês e a lista de candidaturas): exige alterar a rota no servidor e o ganho é pequeno.
