# Qualidade CSS e movimento C4G

Pedido autorizado em 29/10/2026: auditar CSS, movimento e qualidade visual e aplicar melhorias dentro da expressão profissional da APP. Estado: Review — implementado e validado localmente.

## Direção e revisão do brief

Preservar a identidade descrita em `../references/ui-foundations.md` e os ecrãs recentemente revistos. Paleta base: navegação petróleo `#075B59`, ação legível `#39751F`, assinatura verde `#5FAD2F`, dados `#123247`, superfície `#FFFFFF` e fundo `#F6F8F8`. A tipografia continua a família de sistema existente (Segoe UI em Windows), com títulos e conteúdo alinhados à esquerda. Não introduzir fontes, bibliotecas ou decoração de campanha.

Composição preservada:

```text
Navegação petróleo | Cabeçalho / organização
                   | Título                 Ação
                   | Filtros / quadro de trabalho
                   | Dados / detalhe / paginação
```

A melhoria concentra-se nos controlos partilhados e na legibilidade da navegação. Rever o plano contra o brief levou a excluir elevações de cartões, entradas animadas por secção e gradientes decorativos. O loader orbital existente é a assinatura de movimento; diálogos e menus recebem apenas movimento breve em resposta a ações.

## Âmbito e critérios de aceitação

- Auditar os estilos importados, cascata, especificidade, duplicação, tokens, estados, foco, responsividade e movimento; registar evidência e dívida remanescente sem declarar conformidade integral.
- Definir tokens partilhados para foco, controlos, superfícies de interação e durações; manter cores e densidade dos ecrãs existentes.
- Dar uma apresentação global consistente a `btn-secondary`; botões desativados não adquirem estados de hover ativos. Substituir `transition: all` nos estilos base por propriedades explícitas.
- Garantir foco de teclado visível nos controlos partilhados, incluindo `status-select`; manter foco inverso legível na sidebar.
- Respeitar `prefers-reduced-motion` em animações e transições da APP, incluindo confirmação e spinners, preservando texto/estado. Não animar layout nem introduzir entradas de páginas.
- Tooltips fecham com Escape, permanecem disponíveis ao mover o ponteiro para a ajuda e continuam acessíveis por teclado, sem alterar conteúdo.
- Clarificar rótulos da navegação, manter alvos de toque adequados e impedir que diálogos excedam a altura útil do viewport.
- Indicar apenas a secção atual na navegação de perfil/unidades/pessoas, evitando dois destaques ativos simultâneos.
- Registar regressões antes das correções, validar testes focados, suites locais e build; verificar desktop/mobile, teclado, movimento normal/reduzido e ausência de overflow com dados sintéticos no navegador.
- Sem alterações de produto, HTTP, autorização, dados, infraestrutura, commit ou deploy. Trabalho anterior preservado.

## Validação

[Auditoria e resultados](../reviews/css-motion-quality-2026-10-29.md). Regressão CSS Chrome 6/16 → 16/16; APP sintética 16/16 em 1440/768/390; testes focados 26 PASS; build PASS. Suite frontend 400 PASS/1 FAIL preexistente em DirectLogin. Backend 1653 PASS/6 FAIL/7 SKIP, falhas de enrichment fora do âmbito e nenhum backend modificado. Capturas finais inspecionadas. Evidência em `output/css-motion-audit/` e `output/playwright/css-motion-*`. Sem deploy.
