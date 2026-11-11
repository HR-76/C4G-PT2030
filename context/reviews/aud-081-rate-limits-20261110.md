# AUD-081 — Limitação de pedidos

Estado: parcial; inspeção estática, sem teste de carga ou consulta de configuração efetiva do proxy, identidade ou produção.

O perfil de identidade local declara proteção contra força bruta (`backend/scripts/localPlatform/optionalIdentity.js`). O código dos conectores trata respostas 429 de fornecedores externos, o que não demonstra limitação dos pedidos recebidos pela API. Nas pesquisas dirigidas ao backend não foi identificada uma implementação geral que prove limites por identidade, IP, organização e operação; isso não prova ausência de limites no proxy ou no fornecedor de identidade.

Risco: pedidos abusivos ou acidentais podem esgotar recursos ou afetar outras organizações se não houver proteção efetiva nas camadas em execução. Severidade potencial alta; configuração, alcance e probabilidade não verificados.

Correção proposta: inventariar e verificar os limites efetivos no proxy, Keycloak e API; preencher lacunas com limites adequados às operações e partilhados entre instâncias, sem confiar em IP encaminhado por origem não autorizada. Excluir bloqueio acidental de callbacks de autenticação ou operações essenciais.

Teste necessário: em ambiente isolado, exceder limites por IP, identidade, tenant e operação, verificar 429 e retoma, isolamento entre organizações e consistência entre instâncias. Sem acesso de teste não classificar como conforme ou afirmar ausência de proteção em produção.
