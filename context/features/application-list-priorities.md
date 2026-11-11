# Prioridades na lista de candidaturas
Estado: Review. Pedido aprovado em 11/11/2026.
Objetivo: manter filtros, estado/fase e tabela/cartões existentes, acrescentando pendências reais e próxima ação junto ao título.
Aceitação: tarefas abertas e prazo da tarefa mais próxima; documentos atuais em revisão ou com alterações pedidas; ligações às secções relevantes; autorização de trabalho/documentos/documento individual, isolamento tenant; distinguir indisponível/restrito de zero; sem progresso percentual inventado. Prioridade de ação: alterações pedidas, tarefas abertas, revisão pendente, consultar candidatura.
Revisões contam apenas o último pedido que inclui a versão atualmente associada. Datas civis Lisboa. Validar testes, build e layouts desktop/mobile. Não alterar dados, permissões ou publicar.

Implementação: resumo anexado apenas aos 25 resultados autorizados de browsePage; contagem completa de tarefas abertas e próximo prazo, revisões da versão documental atual, verificações de autorização por aplicação e documento. Próxima ação abre a secção relevante conservando o retorno/filtros; não implica poderes de edição. Mantidas as oito colunas e filtros existentes.
Validação: 9 testes backend (incluindo integração da página combinada), 15 frontend, node --check e build aprovados. Chrome com API simulada a 1440/390/320 px; imagens revistas, teclado e ausência de overflow verificados. Cabeçalho móvel da lista corrigido. Evidências em output/playwright/list-priorities-check.cjs e capturas candidaturas-pendencias-{1440,390,320}.png na pasta de visualizações desta sessão.
Limites: não executada integração PostgreSQL nem validação autenticada com dados reais. Sem deploy. Erro 500 de alertas mantém-se pendente e não foi alterado nesta melhoria.
Próximo passo: validar contagens com candidaturas reais de uma sessão autorizada.
