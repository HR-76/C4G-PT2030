# Lista e resumo lateral do catálogo

Estado: Review. Correção de âmbito do utilizador: aplicar também ao Catálogo.

## Critérios
- Alternar lista e tabela usando a mesma página, filtros e paginação autorizados.
- Painel mostra apenas campos da página autorizada, com acesso à ficha completa; não conservar resumo após alteração de contexto, página ou erro.
- Manter marcação de interesse e estados existentes; teclado, foco e responsividade. Testes focados e build.

## Validação
28 testes do catálogo, incluindo alternância e resumo, passaram; build frontend PASS. Validação visual no navegador pendente.

## Resumo junto aos resultados

Estado: Review. Melhoria pedida em 10/11/2026.

- No Catálogo unificado, na vista Lista, mostrar o resumo ao lado da lista em computador e imediatamente após a oportunidade selecionada em telemóvel.
- Dar prioridade a prazo, programa, dotação com o seu âmbito e fonte. Usar os dados autorizados da página e conservar o acesso à ficha completa.
- Permitir passar a outro resultado com os filtros e a paginação atuais. Fechar o resumo ao mudar de vista ou de página, aplicar filtros ou perder acesso aos resultados.
- Validar posição, abertura, fecho, foco, filtros e paginação em computador e telemóvel.

Validação de 11/11/2026. Build e 47 testes focados aprovados. Chromium com API simulada na rota do Catálogo unificado confirmou o resumo lateral a 1440 e 1024 px e abaixo do cartão selecionado a 390 e 320 px. Confirmados teclado, toque, regresso do foco, mudança de oportunidade, filtros mantidos no URL e na ficha, e paginação sem sair da vista Lista. A instância local habitual estava indisponível. Na suite completa, 880 de 881 passaram, com a falha já conhecida em ApplicationWork.
