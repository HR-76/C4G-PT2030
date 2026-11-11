# Entrega 5 — Dashboard, indicadores e relatório de candidaturas

Estado: Review, 18/10/2026. Autorizado pelo utilizador iniciar a entrega 5 pelo Dashboard, indicadores e relatórios. As entregas 3 e 4 mantêm as pendências documentais e de email; não são encerradas por este incremento.

## Âmbito e evidência

Reutilizar Dashboard.jsx, barras, tabelas e composição do piloto. A adaptação atual agrega listas autorizadas, mas ainda fixa a fonte central em Funding & Tenders e apresenta orçamentos como indisponíveis. As candidaturas já expõem os dois orçamentos, estados e datas. O relatório original por faculdade/centro atribui candidaturas ao centro do coordenador; o utilizador confirmou a unidade principal atual do responsável, com grupo «Sem unidade atribuída» quando não existe associação.

Este incremento recupera indicadores globais autorizados, distribuição por estado, prazos internos, fontes reais e relatório detalhado com CSV. Não introduz novos indicadores preditivos, motor de reporting, configuração de storage/antivírus/email ou dados fictícios na organização real.

## Definições v1

- Período: situação atual, sem filtro temporal implícito; data/hora de consulta visível. Granularidade: candidatura acessível na organização ativa. Estados atuais, não contagem de eventos históricos.
- Ativas: IDENTIFIED, INTENTION, PREPARATION e SUBMITTED. Submetidas/decididas: SUBMITTED, APPROVED e REJECTED. Taxa de sucesso: APPROVED / (APPROVED + REJECTED); sem decisões é ausente, nunca 0%.
- Orçamentos em EUR, como os campos recuperados: soma decimal exata dos valores registados; valores ausentes não são convertidos para zero. Conjunto vazio soma zero; conjunto não vazio sem valores é indisponível; soma parcial identifica quantidade sem valor. Orçamento da organização em candidaturas aprovadas não equivale a financiamento efetivamente concedido (campo não disponível).
- Prazos internos: candidaturas ativas, vencidos e até 30 dias, distinguindo vencido de encerramento da oportunidade; dia civil de Lisboa. Fontes usam a proveniência existente, sem atribuir todas à mesma API. Prazo atual não confirma abertura/elegibilidade.
- Relatório detalhado e totais usam a mesma coleção autorizada. Exportação reautoriza no servidor, confirma a identidade do conteúdo apresentado e regista auditoria; uma alteração exige atualização do ecrã. Sem acesso ao legado, sem relaxar permissões, sem novas concessões.

## Aceitação

1. Indicadores correspondem a casos com todos os estados, dois orçamentos, valores ausentes, zeros, decimais, prazos vencidos/futuros e várias fontes.
2. Ecrã, tabela e CSV conciliam com as candidaturas autorizadas. CSV inclui organização, âmbito, definição/data e campos de origem, com proteção contra fórmulas.
3. Falhas, limites ou leituras incompletas não produzem totais parciais apresentados como completos. Mudança de organização ou perda de acesso descarta resultados antigos e exportação pendente.
4. Testes automatizados de cálculos, endpoint/autorização/exportação, falha de auditoria e isolamento; build frontend e sintaxe backend. Verificação no browser desktop/móvel com dados de ensaio identificados e leitura do ambiente habitual.
5. Comparação visual com o piloto e registo das diferenças/limites; entrega 5 integral permanece aberta para os restantes percursos.

## Fora deste incremento ou por confirmar

Regra por unidade confirmada: atribuição direta, uma vez por candidatura, sem somas automáticas de descendentes. Pessoas contam fichas ativas pela unidade principal; pertenças secundárias não duplicam totais. Sem permissão de diretório, os indicadores por unidade ficam indisponíveis, mantendo o relatório autorizado por estado e candidatura. Financiamento concedido não é inferido de orçamento. Relatórios futuros do MVP (PDF, construtor de filtros adicional) não são incluídos automaticamente na recuperação do CSV original. Armazenamento, antivírus e email ficam para o final.

## Composição recuperada

Cores, tipografia e espaçamento existentes C4G; StatStrip, Histogram, DoubleHistogram e tabelas do Dashboard original. Duas vistas: operacional e relatório; no relatório, unidades/estados/detalhe. Mantida densidade e alternativa tabular aos gráficos; sem nova linguagem visual. CSV detalhado inclui a unidade de cada candidatura, permitindo conferir os agregados.

Limites explícitos: situação atual e não série histórica; estados arquivados não contam como decisões atuais. Máximo de 10 000 linhas examinadas e 900 KB de resultado; exceder falha sem devolver totais incompletos. Fontes centrais refletem o catálogo recolhido, sem prometer cobertura integral dos fornecedores. Exportação usa APPLICATION_READ e autoriza cada recurso como a listagem, sem conceder acesso adicional, com EXPORT_ALLOWED crítico antes de disponibilizar o CSV.

## Verificação

Implementado e ativo no ambiente habitual. 50 testes backend, 12 frontend, build/sintaxe, PostgreSQL/HTTP com duas organizações, Chrome 1440/390 e OIDC habitual PASS. Dados de negócio preservados; nenhuma migration/grant. [Revisão e limites](../reviews/c4g-pilot-parity-delivery-5-dashboard.md). [Comparação](../../output/playwright/c4g-dashboard/comparison.html). Incremento em Review, entrega 5 global em curso.
