# Apresentação das fichas de oportunidades

Pedido autorizado em 29/10/2026, após análise visual com frontend-design.

## Direção e critérios de aceitação

- Aplicar ao componente partilhado pelas fichas centrais e privadas; preservar dados, estados, ações e permissões.
- Paleta: fundo #f5f7f7, branco #ffffff, cabeçalhos #edf5f2, petróleo #075b59, texto #123247, bordas #cbdad6. Tipografia de sistema existente, títulos 17px, corpo 14px, rótulos 12px.
- Informação num quadro branco com cabeçalho verde suave, grelha de campos delimitada; prazos num painel lateral petróleo com datas brancas. Descrição num quadro separado, alinhada à esquerda e limitada a 78ch.
- Resolução documental com quadro próprio, conservando avisos; candidaturas associadas com cabeçalho e tabela delimitados.
- Evitar cartões por campo: agrupar a informação em quadros funcionais e concentrar o contraste forte no calendário. Âmbar apenas para avisos existentes.
- Manter leitura mobile, links, tooltips por teclado e expansão da descrição. Sem overflow a 390px.
- Validar suite frontend, build e capturas Chrome sintéticas de ambas as fichas.

Estado: Review — implementado em 29/10/2026.

## Validação

- Testes específicos: 65 PASS em quatro ficheiros. Build Vite PASS.
- Suite global: 373 PASS e 5 FAIL, em FundingIntegrations (quatro expectativas de texto) e OrganizationDashboard (uma expectativa de texto), fora dos ficheiros alterados neste incremento. Não foram corrigidos ou ocultados.
- Chrome com API sintética: fichas central e privada a 1440px e 390px, sem overflow nem erros de página; expansão da descrição e tooltip por teclado verificados. Capturas inspecionadas para desktop central e mobile privada.
- Evidências: `output/opportunity-detail-visual-{tests,focused,build}.log` e `output/playwright/opportunity-detail-*`.
- Alterados apenas estilos partilhados e classe visual de OpportunityApplications. Sem contratos HTTP, dados, permissões ou deploy alterados.
