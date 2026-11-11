# GCNI-CAT-01 / G1 — proposta visual

01/11/2026 · Proposta para revisão, sem componentes implementados.

## Direção

Manter a linguagem do laboratório: fundo azul muito claro #EDF3F7, superfície branca #FFFFFF, texto azul escuro #172E40, ação azul #165FCC, linhas #CEDBE5 e alerta âmbar #785000. Segoe UI para controlos/dados; Georgia apenas no título da área e títulos das secções, como no laboratório. Na implementação, harmonizar com os tokens do GCNI sem substituir a navegação global. Alinhamento à esquerda, texto até 78 caracteres por linha, sem métricas decorativas.

Revisão do plano visual antes do desenho: a tabela precisa de densidade e comparação, não de cartões repetidos no desktop. A área de filtros é o elemento central; o resumo da ficha mantém poucos campos e os detalhes aparecem por secção. Não copiar o ecrã de login nem a marca do laboratório para o GCNI.

## Barra e tabela

1. Pesquisa por código/título, Estado, Qualidade e Pesquisar na primeira linha.
2. Mais filtros abre programa, fonte, tipo, prazo desde/até, dotação mínima, moeda e ordenação. Labels legíveis em vez de códigos isolados. Tamanho fixo de 25 nesta primeira versão.
3. Chips removíveis mostram os filtros ativos, incluindo «Prazo desde hoje». Limpar remove todos; a data inicial não volta silenciosamente.
4. Local previsto para Áreas, integrado com o plano de descoberta. Na entrega inicial só aparece como controlo quando mapping e contrato estiverem prontos; a anotação da maquete é para revisão, não texto permanente do produto.
5. Cinco grupos de dados: Oportunidade, Programa, Dotação da call/aviso, Prazo e Estado. Coluna adicional Ações preserva Interesse/Candidaturas. Código, título e duas linhas de descrição em Oportunidade; abertura fica na célula Prazo, além do fecho. Texto completo na ficha. Contadores privados são carregados pelo serviço tenant e nunca fazem parte do snapshot comum.

O valor de dotação deve identificar «prevista» ou «partilhada» quando aplicável. Conflito material fica junto do valor afetado, não apenas num tooltip. Estado refere-se à oportunidade. Mostra-se «25 oportunidades carregadas», não um total fictício. Atualização disponível e expiração têm ações distintas; filtro sem resultados não é falha do serviço.

## Ficha

Voltar aos resultados mantém contexto. Cabeçalho com código/título, fonte oficial, programa e ações existentes. Resumo: dotação da call/aviso, prazo e estado; abertura e descrição permanecem visíveis. Uma condição que altera o prazo aparece imediatamente sob o resumo.

Navegação por secções: Prazos e condições; Dotação e taxas; Documentos e versões; Conflitos; Relações plano/aviso; Histórico; Fontes e evidências. Prazos abertos inicialmente. Outras secções carregadas quando solicitadas, com estado próprio de carregamento/erro e opção de repetir. A ausência de conflitos não é afirmada até a coleção estar completa.

Documentos mostram versão, publicação, vigência e substituição. Hashes e localizadores técnicos ficam em detalhe expansível. O link atual da fonte não é apresentado como garantia de acesso à versão antiga. Na ficha comum não se mostram nomes de revisores ou documentos privados.

## Telemóvel, teclado e estados

Até 800 px: pesquisa ocupa largura total; Estado/Qualidade dividem uma linha; botão Pesquisar ocupa largura total. Filtros adicionais em uma coluna em ecrãs estreitos. Lista passa a registos empilhados com os mesmos cinco grupos e ações, sem ocultar campos por largura. Não duplicar conteúdo visível e acessível ao leitor de ecrã.

Ficha com resumo vertical, índice «Ir para secção» e secções empilhadas. Alvos de toque >=44 px, foco visível, labels associados e erros anunciados. Não depender só de cor. Mudança de secção move foco para título apenas por ação do utilizador. Sem animações obrigatórias; respeitar movimento reduzido.

Estados desenhados funcionalmente: carregamento sem contagem fictícia; vazio com Limpar filtros; erro de secção sem perder ficha; expiração com Atualizar resultados; sessão terminada pelo fluxo GCNI; conflito material visível. As imagens entregues são maquetes estáticas com dados fictícios, não prova de responsividade ou acessibilidade executada.

## Decisões propostas para fechar G1

- Cinco grupos + Ações, conservando abertura e descrição em conteúdo secundário.
- Preservar filtro inicial por data UTC de hoje, visível/removível; Limpar mostra todos.
- Ficha progressiva sem diagnóstico técnico no resumo.
- Leitura versionada, snapshot de 15 minutos, página de 25 e sem contagem total obrigatória.
- Áreas mantém dependência própria; não bloqueia documentação G1 nem autoriza omitir AC18 do âmbito global.

Estes pontos são propostas concretas de G1; a sua documentação não deve ser citada como aprovação humana já obtida da disposição visual ou como validação de implementação.

Autorrevisão: preservadas abertura, descrição e ações do GCNI; substituído o rótulo ambíguo «Estado da candidatura» por «Estado da oportunidade»; separadas anotação de revisão e informação de produto; nenhuma data, dotação ou documento fictício representa um aviso real.

Próximo passo: rever esta proposta em conjunto com o contrato de leitura antes do trabalho dependente em G2.
