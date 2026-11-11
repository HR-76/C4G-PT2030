# Criar oportunidade — geografia, grupos e requisitos

Estado: Complete — implementação, testes, autorrevisão e arranque verificados

Pedido confirmado: acrescentar Geografia/Local e Grupos elegíveis à criação manual; analisar a zona de requisitos aplicáveis à call. A análise admite uma secção opcional de texto livre, sem classificar automaticamente elegibilidade nem verificar cumprimento.

## Âmbito e plano

1. Manter o percurso ativo de criação central, exclusivo da Administração C4G, com autenticação recente, autoridade atual, auditoria e repetição segura de pedidos.
2. Acrescentar `geographySummary` (até 2 000 caracteres) e `eligibleGroups` (até 4 000) como textos opcionais ao snapshot existente. Reutilizar `eligibilitySummary` (até 4 000) para os requisitos aplicáveis. Preservar os limites globais e a rejeição de campos desconhecidos. Não tratar texto livre como códigos geográficos ou taxonomias verificadas.
3. Mostrar os três campos no formulário e na ficha após a leitura autorizada. Usar rótulos Geografia/Local, Grupos elegíveis e Requisitos aplicáveis à call. Preservar parágrafos, tratar o conteúdo como texto e indicar ausência quando necessário. Exemplos no preenchimento orientam âmbito geográfico/local de realização, destinatários e condições/documentos.
4. Os requisitos são informativos. Não criar checklist de cumprimento, anexos, regras de exclusão ou decisões automáticas; esses comportamentos exigem contrato próprio.
5. Guardar os campos no mesmo pedido recuperável e revisão imutável, sem migração nem reescrita histórica. O recibo continua sem conteúdo; a ficha usa GET autorizado. Nenhuma recolha, fonte, permissão ou janela de exposição é alterada.

## Aceitação

- Criar com os três textos e reler exatamente os valores normalizados, inclusive parágrafos.
- Omissão continua compatível com oportunidades e pedidos anteriores.
- Repetição idêntica não duplica; alteração de qualquer novo texto com a mesma chave é conflito.
- Recuperação após falha/reabertura preserva os textos e chave por administrador.
- Rejeitar tipos, limites e campos não autorizados; não interpretar HTML.
- Preservar recusa a clientes, sessão ausente/expirada e autoridade revogada.
- Testes direcionados e completos, build e persistência em PostgreSQL descartável; nenhum registo sintético na base habitual.
- Autorrevisão, integração limitada aos ficheiros validados com backup e verificação do arranque sem fontes.
