# Reconciliação das falhas de enriquecimento

29/10/2026. Pedido explícito de corrigir as falhas backend reportadas na uniformização de filtros.

Diagnóstico: as duas falhas originais já não se reproduzem (7 testes PASS). A suite atual revela seis regressões de persistência P3: fixture sem callccm2Id exigido pelo contrato de evidência e descoberta que ainda permite aplicar identidades novas antes da consulta individual.

Critérios: completar a fixture sem relaxar validação e permitir adulteração deliberada de uma cópia nos testes de segurança. Preservar dados e resoluções anteriores. Validar testes direcionados, sintaxe, suites completas e build; sem SQL real, ativação P3 ou deploy.

Resultado parcial: corrigidos callccm2Id ausente na fixture e tentativa de mutação de um objeto imutável. As duas falhas originalmente reportadas já estavam corrigidas no estado encontrado. Permanece a regressão de descoberta P3: a fila funding_refresh_target exige uma funding_identity existente pela FK da migração 034, enquanto o contrato P3 exige consulta individual antes da criação. A tentativa de inserir identidades novas nessa fila foi retirada após verificar o esquema. O resultado verde em output/backend-funding-followup-final.log corresponde a essa tentativa retirada e não valida o estado final. Não relaxar a expectativa nem remover a FK para ocultar a incompatibilidade.
