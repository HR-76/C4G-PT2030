# Apresentação das fontes de oportunidades

Estado: Review — 29/10/2026. Pedido: reduzir texto e organizar as fontes em três colunas.

## Âmbito e aceitação

- Alteração visual da implementação C4G atual, sem alterar arquitetura, contratos HTTP, recolha ou permissões.
- Três fontes por linha em desktop amplo, duas em largura intermédia e uma em mobile; sem overflow da página.
- Nome, estado, última execução e última recolha completa identificáveis; ações alinhadas no fundo.
- Contagens secundárias disponíveis em detalhes expansíveis. Histórico preservado. Erros, cobertura parcial, limitações e pedidos por confirmar continuam visíveis.
- Saúde do serviço numa faixa compacta; datas técnicas em detalhes acessíveis por teclado.
- Preservar os bloqueios e a confirmação idempotente existentes.

## Direção visual e revisão prévia

Paleta existente: superfície #FFFFFF, fundo #F6F8F8, texto #20262B, dados #123247, ação #39751F, limites #E3E8EB. Estados usam cores semânticas acompanhadas de texto.
Tipografia: stack existente Segoe UI/sistema; título de fonte 15px/600, dados 13px, metadados 12px. Alinhamento à esquerda.

```
Título                            Consultar estado
Saúde do serviço                         Detalhes
[Fonte / estado] [Fonte / estado] [Fonte / estado]
[Datas         ] [Datas         ] [Datas         ]
[Aviso eventual] [Aviso eventual] [Aviso eventual]
[Detalhes      ] [Detalhes      ] [Detalhes      ]
[Atualizar     ] [Atualizar     ] [Atualizar     ]
Histórico de sincronizações
```

Revisão: cartões justificam-se por serem fontes com ações independentes. Evitar sombras, gradientes e números decorativos; preservar cores dos ícones das fontes. Uma consulta global evita repetir cinco vezes a mesma ação. Avisos não ficam escondidos nos detalhes.

Referência: https://atlassian.design/components/lozenge — estados compactos e cor semântica; https://support.atlassian.com/statuspage/docs/what-is-a-component — separar saúde do serviço do estado de cada fonte.

## Validação

Frontend: 378 testes PASS; build PASS. Mensagens jsdom de navegação não implementada e falha sintética de chunk nos cenários existentes, sem falhas da suite. Primeiro arranque bloqueado por spawn EPERM no sandbox; execução autorizada concluída.

Chrome isolado com respostas sintéticas: 1680/1440 px com três colunas, 1024 com duas e 390 com uma, sem overflow horizontal. Detalhes operáveis por teclado e consulta global única confirmados. Capturas desktop/mobile inspecionadas em `output/playwright/funding-presentation-*.png`; verificador em `output/playwright/funding-presentation-check.cjs`. Não foram iniciadas recolhas reais. Sem alteração backend, deploy ou commit.


## Revisão pedida em 29/10/2026 — cartões compactos

Substitui a apresentação anterior dos cartões: apenas nome/ícone, última execução, última recolha completa e botão de atualização. Eliminar estados, descrições, tooltips, avisos e detalhes dos cartões. Manter histórico paginado e bloqueios/confirmar pedido no botão; erros de pedidos e identificação de dados de teste permanecem fora dos cartões.

Direção: conservar paleta e tipografia acima; padding 14px, intervalos 10px, datas em duas colunas flexíveis e ação sem separador. Nome alinhado à esquerda. A grelha mantém três/duas/uma colunas. Revisão do plano: a redução vem de retirar conteúdo e espaço, sem encolher a legibilidade das datas.

Aceitação: dois campos de data em todas as fontes, sem detalhes/descrições/estados nos cartões; controlos de atualização funcionais; sem overflow em mobile.

Suite backend: 1632 PASS/7 SKIP, sem falhas (`output/compact-sources-backend.log`).

Validação do incremento: regressão RED → GREEN; 10 testes focados PASS, build PASS. Suite frontend: 369 PASS/10 FAIL em ApplicationBrowse e CentralOpportunities, fora dos ficheiros alterados neste incremento (log: `output/compact-sources-frontend.log`). Chrome isolado em 1680/1440/1024/390 PASS: cartões de 153,5px, grelha 3/3/2/1, sem overflow; capturas desktop/mobile inspecionadas em `output/playwright/funding-compact-*.png`. Sem recolhas reais ou deploy.
