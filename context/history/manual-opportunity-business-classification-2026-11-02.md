# Classificação das oportunidades manuais
State: Complete

Decisão confirmada em 02/11/2026: escolher programa, tipo e área de intervenção; criação manual apenas na proveniência/histórico. Ligações oficiais preservadas.

## Entrega

- Formulário com seletores de programa, tipo e área, reutilizando os metadados da rota central autenticada existente. Programas nacionais observados no catálogo e os 27 programas europeus da taxonomia existente, incluindo HORIZON e LIFE.
- Tipos iniciais reutilizam os rótulos da apresentação: Concurso, Convite, Financiamento em cascata e Aviso planeado. Áreas reutilizam as 22 famílias C4G existentes.
- Campos desconhecidos continuam opcionais, em linha com a necessidade de criar registos incompletos. Não se atribuem valores automáticos para preencher lacunas. Erro de carregamento das opções permite repetir.
- Contrato central aceita opportunityType/interventionArea, valida os valores no servidor e guarda-os na revisão imutável. Programa mantém o contrato textual limitado existente e passa a seleção no formulário; pedidos antigos com nomes históricos continuam válidos.
- Área editorial prevalece sobre inferência pelo título; evidência identifica seleção da Administração C4G, sem a atribuir à fonte oficial. Tipificação disponível no catálogo, ficha e classificação exportada; área disponível também no filtro e exportação existentes.
- Proveniência C4G_MANUAL e auditoria permanecem internas/históricas; não se criou uma fonte de negócio manual. Nenhuma fonte oficial é inferida a partir do programa.
- Links oficiais conservam validação, persistência e apresentação anteriores. Permissões C4G_ADMIN, confirmação independente por GET e repetição idempotente preservadas.
- Extensão opcional do snapshot V1 e projeção de leitura; snapshots antigos e respetivos digests não recebem campos novos. Escolhas novas participam no digest e na identidade da intenção. Sem migração SQL nem alterações ao contrato HTTP de criação privada.

## Validação

- Regressão adicionada antes da implementação: classificação rejeitada pelo contrato antigo; passa após integração.
- Backend completo: 2580 testes aprovados, 7 ignorados, zero falhas. Revalidação focada final: 9 aprovados, incluindo persistência/releitura, área explícita contra título divergente, replay, URL oficial e rejeição de área inválida.
- Frontend: 645 testes aprovados; build e verificações node --check aprovados. Teste novo confirma seleção, persistência no navegador e repetição exata após resposta incerta. Pedidos antigos continuam cobertos.
- Chrome local, API simulada: seletores e layout a 1440 e 390 px, sem overflow horizontal. Screenshot móvel inspecionada. Evidência em output/playwright/manual-classification; não representa integração com base real.
- Revisão focada: cliente e rota reutilizados, autorizações mantidas; não há alterações a infraestrutura, deploy ou R2/ClamAV.

Próximo passo: recuperar o filtro por área temática na lista de pessoas da organização.
