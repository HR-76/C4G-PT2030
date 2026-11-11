# Correção — seleção de oportunidades atuais

Review, 2026-10-17. Pedido explícito do utilizador; recorte da integração Funding existente, sem novas funcionalidades. [Evidência e limites](../reviews/c4g-catalog-demo/current-selection.md).

Evidência direta: uma consulta limitada devolveu avisos com estado `31094502` mas todos os prazos passados. O campo `deadlineDate` contém várias datas; a implementação escolhia a primeira. Um filtro range enviado à fonte não eliminou esses resultados. Ordenação descendente devolveu prazos futuros numa página de cinco resultados.

Critérios: recolher a amostra por prazo descendente, escolher o menor prazo civil >= data UTC do início da recolha entre todas as datas fornecidas, excluir registos sem prazo verificável ou com todos os prazos passados. Estado explicitamente fechado não entra. Isto não certifica elegibilidade nem disponibilidade horária no próprio dia. Não ampliar volume/páginas, não procurar ilimitadamente até preencher a amostra. Duplicados da mesma identidade continuam colapsados.

Na interface, preencher por defeito o filtro existente de fecho a partir de hoje (UTC); limpar filtros permite ver todo o histórico. Histórico, snapshots, candidaturas e correções não são apagados. A API de listagem sem filtros continua disponível para consulta integral.

Testes de múltiplos prazos, ausência/invalidez, passado/hoje/futuro, duplicados e limites; depois uma atualização manual de até cinco resultados no ambiente 5189/5561 e confirmação no browser de prazos atuais e preservação dos registos anteriores.
