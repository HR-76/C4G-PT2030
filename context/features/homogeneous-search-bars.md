# Campos de pesquisa homogéneos

Pedido de 31/10/2026: verificar o CSS de todas as barras de pesquisa e calibrar a apresentação com `frontend-design`.

## Contrato e direção visual

Uniformizar os 10 campos de pesquisa existentes e os filtros textuais Programa/Financiador das oportunidades privadas. Cobertura: catálogo, candidaturas, parceiros, entidades/utilizadores, logs, faturação e respetivo modal, pessoas, interesses e destinatários de avisos. Matching e alertas sem pesquisa textual mantêm os seus filtros existentes.

Paleta herdada do C4G: superfície #FFFFFF, fundo #F6F8F8, borda de controlo #84968F, valor #123247, texto secundário #4B5560 e foco petróleo #075B59. Usar os tokens existentes. Tipografia do sistema já adotada pela aplicação, valor 14px/400/1.4 e rótulo 12px/600. Altura 40px em desktop e 44px até 700px; raio 5px; lupa 16px; espaço entre lupa e texto 8px.

Composição alinhada à esquerda, mantendo a largura disponível em cada barra e formulário:

```text
Rótulo                    Filtro
[ lupa  texto de pesquisa ][ seletor ] [ Aplicar filtros ]

Mobile:
Rótulo
[ lupa  texto de pesquisa            ]
Filtro
[ seletor                           ]
```

Revisão do plano: a tarefa pede calibração da identidade existente. Consolidar apenas o controlo de pesquisa, reutilizar a paleta atual e conservar os layouts normal, integrado e compacto. A largura depende do contexto; altura, contorno, ícone, texto e foco são comuns. Retirar regras concorrentes e resets com `!important` em vez de acrescentar outra camada de exceções.

## Critérios de aceitação

- Um componente visual `SearchInput` partilhado pelos 12 campos, sem estado de pesquisa ou pedidos próprios.
- Mesmos estilos computados para altura, raio, borda, padding, fonte, texto, placeholder e foco; lupa alinhada, decorativa e sem interceção de cliques.
- Labels acessíveis e visíveis, sem sobreposição de texto, ícones ou contorno de foco.
- Preservar valores, limites, handlers, debounce, submissão, limpeza, URL e contratos HTTP de cada consumidor.
- Sem overflow do controlo em desktop, tablet e mobile; conservar a altura dos filtros adjacentes.
- Registar regressão visual antes da correção, repetir em Chrome isolado com respostas sintéticas, executar testes focados, suites locais completas e build. Registar falhas anteriores separadamente.
- Preservar dados, permissões e trabalho existente; sem alterações de backend, infraestrutura, commit ou deploy.

Estado: Review — implementação e validação concluídas em 31/10/2026.

## Resultado

`SearchInput` aplicado aos 12 campos, com CSS próprio e sem estado funcional. O input recebe o contorno/foco; a lupa decorativa tem 16px e deixa 8px até ao texto. Removidas as regras concorrentes de `index.css`, `FilterBar.css`, candidaturas, catálogo, diretório e faturação. Os filtros adjacentes usam também o token de borda de controlo atual.

Chrome isolado: 48 combinações de contexto/largura, 52 controlos, zero falhas e zero erros de página a 1440/768/390/320px. Testes focados 107 PASS; suite frontend 493 PASS; build PASS. Suite backend anterior às alterações: 2170 PASS, 34 FAIL preexistentes, 7 SKIP, documentadas separadamente. [Evidência e limites](../reviews/homogeneous-search-bars.md).
