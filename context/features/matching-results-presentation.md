# Apresentação das correspondências de Matching

Estado: Review. Proposta visual aprovada em 10/11/2026.

- Em /matching e na consulta de pessoas por oportunidade, listar os nomes das áreas em comum em cada resultado, mesmo com a explicação fechada.
- Disponibilizar um único controlo «Porque aparece?» por resultado. Ao expandir, mostrar os termos encontrados na oportunidade, agrupados pelas respetivas áreas.
- Apresentar títulos e programas completos numa lista responsiva, com estado, prazo, origem e ligações existentes. A correspondência temática não determina elegibilidade.
- Conservar consulta, ordenação, seleção de perfil, estados de carregamento e erro, e contrato da API.
- Validar ambos os modos, abertura e fecho por teclado, textos longos e área de toque em ecrãs de computador e telemóvel. Executar testes frontend e build.

## Validação

- Chromium com frontend compilado e API simulada. Os dois modos passaram a 1440, 1024, 768, 390 e 320 px, com nomes completos, áreas visíveis, termos agrupados, ligações corretas e ausência de transbordo horizontal na lista. Abertura e fecho por teclado e toque. O controlo tem pelo menos 44 px de altura em telemóvel.
- Build aprovado. Os 13 testes de Matching passaram. Na suite frontend passaram 876 de 877 testes. A única falha, no diálogo «Adicionar membro» de ApplicationWork, repetiu-se no teste isolado e está fora do âmbito desta alteração.
- A instância local habitual não estava disponível para validação com dados reais.
