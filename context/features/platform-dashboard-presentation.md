# Apresentação do Dashboard C4G

Pedido de 28/10/2026. Âmbito: dashboard da administração mostrado pelo utilizador; preservar dados, permissões, atualização e destinos de navegação.

## Direção visual

Paleta: petróleo #075b59, fundo #f5f7f7, branco #ffffff, texto #123247, verde #b7ee62 e âmbar #a76712. Tipografia Segoe UI/sistema existente, títulos 20–30px e números tabulares. Conteúdo alinhado à esquerda.

```text
Título                                      Atualizar
Entidades           Utilizadores            Oportunidades
Catálogo: distribuição e contagens | Atividade e erros
Entidades recentes                | Atividade (continuação)
Gestão: entidades / faturação / fontes / logs
```

Revisão da proposta: evitar mais cartões iguais e barras vazias repetidas. Concentrar o destaque cromático no catálogo, com uma barra segmentada proporcional aos estados; atividade em superfície clara e erros positivos com contraste âmbar. Atalhos num grupo próprio. Sem tendências, percentagens de crescimento ou indicadores de saúde inventados.

## Critérios de aceitação

- Preservar métricas, mensagens de indisponibilidade, zero, erros de recolha e acesso revogado.
- Mostrar os quatro estados do catálogo com contagens e distinção textual, sem depender da cor; gráfico decorativo.
- Separar indicadores e secções com espaçamento consistente; manter os links e tooltips existentes.
- Adaptar a composição a 390px, sem overflow, e preservar foco visível.
- Validar testes existentes, build e inspeção visual desktop/mobile com dados sintéticos.

Estado: Review — implementado e validado em 29/10/2026.

## Resultado e validação

Indicadores compactos, catálogo em painel petróleo com distribuição proporcional e legenda numérica, atividade em superfície clara com destaque âmbar apenas quando existem erros, entidades recentes abaixo do catálogo e quatro atalhos com ícones numa faixa própria. CSS limitado às classes do dashboard.

- Suite frontend: 376 PASS em 57 ficheiros; build Vite PASS. Logs `output/dashboard-presentation-tests.log` e `output/dashboard-presentation-build.log`.
- Chrome isolado com API sintética: 1440px e 390px, sem overflow horizontal nem erros de página. Tooltip acessível por foco; distribuição 50/20/10/20 verificada; mensagens de recolha incompleta, catálogo vazio e atividade indisponível verificadas.
- Capturas desktop/mobile e estados alternativos inspecionadas em `output/playwright/dashboard-presentation-*.png`; script e resultado JSON na mesma pasta.
- Sem alterações de backend, contratos, dados reais ou deploy. Aguarda apreciação visual do utilizador.

## Ajuste de conteúdo — 29/10/2026

Pedido: tooltips apenas com informação necessária ao utilizador. No título do dashboard, manter apenas a data de atualização para avaliar a atualidade dos indicadores.

Critérios: texto «Atualizado em …» sem regras internas de contagem ou explicação do fuso; controlo ausente durante carregamento e erro sem dados; preservar acessibilidade e atualização manual. Este ajuste substitui a preservação integral do texto deste tooltip prevista acima.

Validação do ajuste: regressão 2 FAIL antes → 5 PASS após; frontend 376 PASS; backend 1631 PASS/7 SKIP; build PASS. Logs `output/dashboard-tooltip-*.log`. Sem deploy.
