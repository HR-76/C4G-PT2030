# Abertura do detalhe da candidatura — desempenho

Estado: Review. Sem medição em ambiente real.

Terceiro bloco da revisão de desempenho página a página (14/11/2026), depois do [Dashboard](dashboard-opening-performance.md) e da [tabela de Oportunidades e lista de Candidaturas](opportunities-table-opening-performance.md).

## Antes

A página pedia a candidatura e, só depois de a receber, disparava em simultâneo até seis pedidos: equipa e tarefas, documentos, histórico, responsáveis, unidades e a versão atual da oportunidade no catálogo. Vários não eram precisos para o que estava no ecrã.

## Alterações (só frontend)

1. **Equipa e documentos com a candidatura.** Só precisam do identificador: são pedidos ao mesmo tempo que o registo e entregues aos painéis, que não voltam a pedir. Contrapartida: abrir uma candidatura a que não se tem acesso faz três pedidos recusados em vez de um.
2. **Responsáveis e unidades só quando são precisos.** Responsáveis: ao abrir a edição, o separador Equipa ou o separador Histórico. Unidades: ao abrir a edição. A criação de candidatura pede ambos de imediato, como antes.
3. **Histórico ao abrir o separador** (ou «Ver histórico»). `ApplicationSections` passa a indicar cada secção aberta (`onVisit`).
4. **Versão da oportunidade no catálogo** pedida depois de os pedidos da página terminarem (`afterPageRequests`).
5. **Reabertura imediata.** Registo, equipa e documentos usam os [dados confirmados](confirmed-reads-page-reuse.md): aparecem de imediato e são lidos de novo; uma leitura recusada retira-os. As ações de equipa e documentos continuam a esperar pela nova resposta. Se a nova leitura confirmar a revisão que já está no ecrã, um formulário de edição em curso não é substituído.

Substitui o contrato anterior «a candidatura antes dos dados secundários»: histórico e responsáveis deixam de ser pedidos na abertura.

## Resultado na abertura

De um pedido seguido de até seis em simultâneo, para três em simultâneo (registo, equipa, documentos), com a verificação do catálogo a seguir.

## Validação

- `PrivateApplications.test.jsx`: um teste reescrito para o novo contrato e quatro novos (pedidos em paralelo sem repetição, edição pede responsáveis e unidades uma vez, reabertura com dados confirmados e isolamento entre utilizadores, leitura recusada, edição em curso preservada).
- Frontend 1042 aprovados e 1 falha por tempo limite em `ApplicationPartners.test.jsx` na corrida completa, que passa isolado (comportamento já conhecido); build e lint aprovados. Sem browser nem sessão real.

## Não feito

6. Um pedido único no servidor para registo, equipa e documentos: só depois de medições.
