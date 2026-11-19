# Gráficos do Dashboard operacional

Adicionar o separador Gráficos ao Dashboard da organização. Apresentar distribuição por estado, comparação dos orçamentos e distribuição pelas unidades principais dos responsáveis. Usar os agregados autorizados do relatório completo. Identificar valores em falta, lista vazia e ausência de acesso ao diretório. Validar o separador na sessão C4G em computador e telemóvel, a leitura sem depender da cor e a navegação para candidaturas por estado.

## Ordem dos gráficos (19/11/2026)

Pedido do utilizador: na vista Gráficos do Dashboard da organização (Administrador e Gestor), **Candidaturas em curso** e **Candidaturas por estado** passam a ser os dois primeiros gráficos, lado a lado. Seguem-se o histórico de aprovações, o alinhamento estratégico, os orçamentos e os gráficos por unidade. Os indicadores e os prazos continuam acima dos gráficos. Só frontend.

Correção no mesmo dia, a pedido do utilizador: os dois gráficos sobem para o topo da vista, logo abaixo dos separadores e acima dos indicadores e dos prazos.

No mesmo dia, a pedido do utilizador: **Prazos internos** sai da vista Gráficos, por já estar em Indicadores operacionais.

## Taxa de aprovação e prazos em risco (19/11/2026, em Review)

Pedido do utilizador, depois de analisar a vista Gráficos na ótica do gestor da entidade.

- **Taxa de aprovação.** Novo gráfico: aprovadas sobre decididas (aprovadas mais reprovadas), em percentagem e contagem, e a mesma taxa por unidade principal do responsável, só para unidades com pelo menos uma decisão. Sem decisões, o gráfico diz que ainda não há candidaturas com decisão. Usa os valores que o resumo do dashboard já entrega.
- **Prazos internos em risco.** Novo indicador no lugar de «Oportunidades abertas» (que continua em Indicadores operacionais): total de candidaturas ativas com prazo interno em atraso ou nos próximos 30 dias, com o número em atraso, e ligação a Indicadores operacionais, onde está a lista. Quando o servidor entrega só parte dos prazos e todos os recebidos estão em atraso, o número em atraso é apresentado como mínimo.

Critérios de aceitação:

1. Com 5 aprovadas e 3 reprovadas, a taxa é 63 % e o texto diz «5 aprovadas em 8 decididas».
2. Uma unidade sem decisões não aparece na lista por unidade; sem acesso ao diretório, a taxa global aparece sozinha.
3. O indicador de prazos mostra o total do servidor e abre Indicadores operacionais.
4. Só frontend: nenhum contrato do servidor muda.
