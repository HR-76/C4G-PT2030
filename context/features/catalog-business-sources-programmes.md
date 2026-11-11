# Catálogo — fontes de negócio e programas europeus
State: Complete

Correção pedida: uma única fonte Portugal 2030, sem opção Registo manual C4G, e programas europeus disponíveis no seletor mesmo sem oportunidades carregadas. Preservar namespaces e proveniência nos registos. Plano e aviso continuam distinguíveis pelo estado/tipificação, não por duas fontes no seletor.

Aceitação: Portugal 2030 agrega PLAN e NOTICE antes da paginação, sem duplicar; seleção persiste na URL; URLs anteriores PLAN/NOTICE migram para a opção agregada. Retirar manual do seletor sem excluir registos de Todas as fontes. Completar programas com a taxonomia oficial versionada já existente e conservar programas observados; não criar oportunidades ou ativar recolhas. Validar combinação e resultados vazios, links oficiais e regressões.

Clarificação confirmada pelo utilizador: criação manual deverá escolher programa + tipo de oportunidade + área de intervenção; criação manual é proveniência histórica e não classificação de negócio. A integração desses campos na criação/revisão exige preservar os contratos e pedidos pendentes existentes; não atribuir fonte oficial com base apenas no programa ou título.

## Resultado

Implementado no Catálogo comum: uma opção Portugal 2030 (agrega PLAN e NOTICE em SQL antes da paginação e na verificação canónica); manual removido das opções públicas; links antigos PLAN/NOTICE restaurados como Portugal 2030 e filtro antigo manual convertido em Todas as fontes. Nenhum registo foi eliminado ou reclassificado.

Programas: união sem duplicação dos programas observados e dos 27 programas da taxonomia europeia oficial já versionada na aplicação (inclui Horizon Europe, LIFE, Erasmus+, CEF, Digital Europe e outros). Esta lista não afirma existência de oportunidades para todos os programas nem inicia recolhas. Preservados programas nacionais e links oficiais. A apresentação da fonte também agrega o nome Portugal 2030 e não apresenta a criação manual como fonte oficial; namespaces/proveniência mantidos.

Classificação manual programa + tipo + área foi confirmada e especificada em `manual-opportunity-business-classification.md`. O formulário/persistência ainda não foram alterados; esse é o próximo incremento, antes do filtro de pessoas.

## Validação e fecho

- Suite backend: 2578 PASS / 7 SKIP / 0 FAIL (2585 testes); 13 testes focados finais PASS, incluindo um caso adicional com plano, aviso e registo misto sem duplicação.
- Suite frontend: 644 PASS; build e sintaxe PASS. Expectativas antigas de origem manual na apresentação pública e lista limitada a programas observados foram atualizadas para o requisito confirmado.
- Chrome desktop 1440px/móvel 390px com API simulada PASS: uma opção Portugal 2030, ausência de manual, Horizon/LIFE presentes, aplicação/reload/remoção e ausência de overflow. Não houve validação com PostgreSQL real nem alteração de dados/configuração/deploy.
- Logs: `output/catalog-business-backend-final.log`, `output/catalog-business-frontend-final.log`, `output/catalog-business-focused-final.log`, `output/catalog-business-build.log`. Evidência visual: `output/playwright/catalog-source/verification.json`.

Revisão focada concluída para fontes/programas. Próximo passo: classificação no formulário de criação manual, conforme a especificação Ready.
