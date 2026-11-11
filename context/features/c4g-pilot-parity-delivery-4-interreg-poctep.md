# Entrega 4 — Interreg Europe e POCTEP

Estado: Complete, 18/10/2026. Processamento ativado por autorização explícita; quatro recolhas reais concluídas e conferidas, incluindo repetição das duas fontes. POCTEP: duas oportunidades criadas, sem duplicados ou revisões artificiais na repetição. Interreg: três chamadas encerradas reconhecidas, zero atuais. Dados anteriores e histórico preservados; percurso real desktop/móvel validado. [Verificação e limites](../reviews/c4g-pilot-parity-delivery-4-interreg-poctep.md). A entrega 4 global permanece em curso. Evidência inicial: [verificação das fontes](../research/interreg-poctep-source-verification-2026-10-18.md).

## Contrato da preparação

As restrições de não importar nesta preparação foram substituídas pela autorização de validação real abaixo; conservam-se aqui como histórico do âmbito inicial.

- Reutilizar fila central, worker, controlo C4G_ADMIN atual, exclusão de recolhas concorrentes, recibos idempotentes, revisão/proveniência e composição com correções manuais. Não reativar writes/notificações legados nem criar novo sistema de configuração.
- Interreg Europe: XLSX oficial das três chamadas gerais 2021–2027, datas civis sem conversão de fuso; notas não são oportunidades. Cobertura não inclui chamadas restritas/ações-piloto. POCTEP: calendário geral via API pública WordPress e confirmação/detalhes das abertas na página oficial; extrair tabelas por cabeçalhos/células, nunca notícias ou títulos exteriores.
- Manter seleção de chamadas atuais (abertas ou previstas), conforme recolha existente: encerradas excluídas, sem arquivar ou apagar registos já persistidos. Hoje espera-se Interreg zero atuais, POCTEP duas. Datas civis desconhecidas, ordem inválida, cabeçalhos alterados e duplicados contraditórios impedem o lote; zero só é sucesso após reconhecer estrutura válida.
- Identidade estável por fonte/período/número de chamada; independente de datas, títulos e ordem. Namespaces INTERREG_EUROPE e POCTEP, tipo de proveniência OFFICIAL_PROGRAMME. Não atribuir dados destas fontes a Funding & Tenders. Reservar prefixos sem renomear chaves/UUIDs existentes; colisão preexistente impede migração/recolha e exige reconciliação explícita.
- Guardar texto relevante (prioridades, elegibilidade, dotação da chamada, links oficiais e horário quando publicado) no resumo; não apresentar dotação global como orçamento por candidatura. Campos desconhecidos não são inventados. Horas oficiais são informação da fonte; campos de prazo do catálogo continuam datas civis.
- Transportes fixos sem URLs arbitrários do cliente, redirects recusados, tempo/tamanho/retries limitados; não seguir links extraídos automaticamente. Sem agendamento nem importações reais neste incremento.
- Migração central incremental 018: aceitar as duas seleções e proveniência própria, preservando todas as linhas existentes. Reversão bloqueada se houver histórico que dependa dela. Novo perfil local explícito ativa as cinco fontes após preflight; perfis anteriores conservam limites/seleções.

## Aceitação

1. Fixtures das respostas oficiais: Interreg três chamadas históricas com datas exatas e zero atuais em 18/10/2026; POCTEP dez chamadas, duas atuais sem duplicados. Troca de título/posição/prazo não altera identidade. Invalidade não produz sucesso vazio.
2. Testes de transporte (tamanho, timeout/cancelamento, redirecionamento/erro, JSON/Excel inválido), parsing, repetição e namespace; regressão Funding & Tenders/CORDIS/Erasmus.
3. PostgreSQL descartável: migração ida/volta, checksum/fingerprints, preservação de linhas/UUIDs/relações/histórico; repetição sem duplicados/revisões artificiais, atualização com correção manual, revogação e ausência de autoridade de membros comuns. Nenhuma escrita em tenants.
4. HTTP mantém contrato `{requestId, source}` fechado; interface apresenta fonte/cobertura/estado reais, sem chamar XLSX «API Funding & Tenders». Build, testes direcionados e percurso browser. Sem ação real de recolha no ambiente habitual.
5. Preparar/aplicar upgrade local reversível apenas depois das provas e backup, sem recolher. Conferir catálogo e histórico anteriores e declarar explicitamente que importações reais continuam pendentes.

## Sequência técnica

Adaptadores puros e transporte limitado → seleções/proveniência e migração → worker/API/UI → testes direcionados e PostgreSQL → upgrade local com backup e verificação UI somente de leitura → documentação de limites e próximo passo de importações reais.

## Validação real autorizada — 18/10/2026

O utilizador autorizou ativar o processamento e conferir as importações reais antes do fecho desta fatia. A restrição anterior de não importar aplicava-se à preparação e é substituída, neste passo, por recolhas manuais Interreg Europe/POCTEP e uma repetição de cada fonte para verificar idempotência. Sem agendamento automático, alterações de fontes adicionais ou notificações legadas.

Aceitação do fecho: respostas públicas válidas antes das recolhas; worker em PROCESSING; quatro execuções reais terminadas sem erros; primeira recolha cria apenas as identidades elegíveis e a repetição não duplica nem cria revisões artificiais; campos e proveniência conferidos com nova leitura pública; registos/histórico anteriores e dados das organizações preservados; percurso real de lista/detalhe e histórico no browser, desktop/móvel. Fechar apenas esta fatia, mantendo as restantes pendências da entrega 4.
