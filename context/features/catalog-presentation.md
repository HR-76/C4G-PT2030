# GCNI — estados e informação da oportunidade
Estado: Complete — implementação, testes, autorrevisão e verificação de arranque concluídos
Pedido confirmado: estados com cores na tabela, tipificação/áreas, Topic/Eligible candidates/Duration/Location na ficha, dotação no formato português com euros por regra geral.

Âmbito: tabela e ficha do catálogo unificado. Estado do aviso e estado privado das candidaturas são distintos; reutilizar API e permissões da organização para candidaturas. Tipificação/áreas e campos da ficha provêm dos dados canónicos ou evidências arquivadas, com origem e indicação explícita de ausências. Nenhuma nova recolha. Não confundir território de abrangência PT com localização física obrigatória, nem datas previstas com duração. Não alterar projeções imutáveis: enriquecer respostas após verificação com extensão aditiva opcional do contrato.

Moeda: por instrução do utilizador, na ausência de moeda declarada apresentar EUR como regra geral e identificar essa assunção discretamente. Não alterar moeda canónica nem converter moedas explicitamente diferentes. Agrupamento com espaço fino inseparável, duas casas decimais mínimas; preservar precisão adicional sem arredondar silenciosamente dados financeiros.

Aceitação: badges com texto e cor; estado de candidatura por entidade sem fuga durante mudança de contexto; colunas Tipificação e Áreas; quatro campos visíveis na ficha com fallback; 120000 apresentado como 120 000,00 €; fontes e acessos mantidos; testes de contrato/lista-ficha, regressões UI, suites e build, autorrevisão e confirmação visual antes da aplicação habitual.
