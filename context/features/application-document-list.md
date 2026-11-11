# Lista documental da candidatura
Adaptar o padrão de ficheiros do Demo 3 v8.3.3. Mostrar nome e versão, disponibilidade técnica, revisão interna do conjunto e ações autorizadas. Distinguir versões, conjuntos desatualizados, revisões ainda não carregadas e ausência de documentos. Validar em computador e telemóvel sem criar nem alterar documentos.

## Pedidos e histórico junto ao documento

Estado: Review. Melhoria pedida em 11/11/2026, inspirada na lista de ficheiros de projeto do Demo 20.

- Em cada linha mostrar nome, versão, disponibilidade técnica e estado da revisão da versão exata.
- Disponibilizar junto à linha os pedidos que incluem o documento e o histórico que lhe pode ser associado pelos dados autorizados. Distinguir outras versões, conjuntos desatualizados e dados ainda por carregar.
- Manter um único pedido editável para cada conjunto e o histórico geral para eventos sem associação inequívoca. Preservar permissões, paginação e destinos dos atalhos.
- Validar posição, leitura e navegação por teclado e toque em computador e telemóvel.

Validação de 11/11/2026. Build e 43 testes focados aprovados. Chromium com API simulada a 1440, 390 e 320 px confirmou a associação por documento, distinção de outra versão, comentários, paginação do histórico e foco no pedido com teclado e toque. A instância local habitual estava indisponível. A suite completa teve 881 testes aprovados e a falha conhecida no diálogo «Adicionar membro».
