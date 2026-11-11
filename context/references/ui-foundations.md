# Fundações visuais do produto

## Estatuto e origem

Este documento orienta a futura interface SaaS C4G. A origem visual é `source-docs/brand/`, analisada como referência de mood e identidade, não como especificação final nem como instrução de layout.

Não existe neste momento um manual de marca C4G formal disponível para o projeto. A direção abaixo está aprovada como decisão provisória, mas não transforma valores cromáticos aproximados em cores oficiais. A validação final depende do futuro manual de marca.

## Moods identificados

### Institucional

- composição limpa sobre branco, com hierarquia central e relações representadas por círculos;
- verde vivo como assinatura, chamada à ação e destaque;
- cinza como apoio estrutural e azul escuro em texto ou elementos de autoridade;
- iconografia linear dentro de círculos ou cápsulas arredondadas;
- sensação de confiança, método e acompanhamento.

### Tecnológico e corporativo

- fotografia de equipas, trabalho e tecnologia, por vezes sob overlay escuro ou cromático;
- contraste entre superfícies escuras, cartões brancos e acentos verdes;
- blocos arredondados, separação clara de serviços e chamadas à ação diretas;
- sensação de competência, transformação e pragmatismo.

### Dinâmico e formativo

- composições mais densas e energéticas, com verde, verde-petróleo, azul escuro, azul vivo e acentos ocasionais;
- fotografia recortada, formas circulares, linhas, ícones e selos informativos;
- tipografia e contraste mais expressivos do que no mood institucional;
- adequado a campanhas e formação, mas demasiado promocional para servir como padrão do produto.

## Direção recomendada para o produto

A interface deve ser profissional, clara e sóbria. O produto combina o rigor do mood institucional com sinais tecnológicos discretos; o mood dinâmico fica reservado a onboarding, comunicação contextual e conteúdos formativos.

- usar branco e cinzas claros como superfícies dominantes;
- usar verde-petróleo escuro na sidebar e navegação principal;
- reservar o verde C4G vivo para ação primária, foco, seleção e pequenos acentos de identidade;
- usar carvão ou azul muito escuro para texto e azul escuro como cor complementar e de visualização de dados;
- usar cartões e controlos com arredondamento moderado, não cápsulas em todos os elementos;
- usar espaço, grelha e tipografia para hierarquia antes de recorrer a cor;
- preferir iconografia linear simples e consistente;
- usar fotografia apenas onde acrescenta contexto humano, sobretudo entrada, onboarding, ajuda ou formação;
- evitar fotografia decorativa e overlays cromáticos nas áreas de trabalho intensivo.

## Paleta provisória

Os valores seguintes são aproximações funcionais inspiradas nas referências. Não são cores oficiais da marca. Os nomes dos tokens descrevem função, nunca a cor concreta, para permitir substituir a paleta sem alterar componentes.

| Token provisório | Valor inicial | Papel recomendado |
| --- | --- | --- |
| `action-primary` | `#5FAD2F` | ação primária, foco e seleção; confirmar contraste por componente |
| `action-primary-emphasis` | `#39751F` | estados ativos, texto/link sobre fundo claro e contraste reforçado |
| `navigation-surface` | `#075B59` | sidebar e navegação principal |
| `data-primary` | `#123247` | cor complementar e primeira série de gráfico |
| `text-primary` | `#20262B` | texto principal e superfícies muito escuras |
| `text-secondary` | `#4B5560` | texto secundário |
| `border-subtle` | `#E3E8EB` | divisórias e contornos |
| `surface-subtle` | `#F6F8F8` | fundo da aplicação |
| `surface-default` | `#FFFFFF` | cartões, tabelas e painéis |

`action-primary` não deve ser usado automaticamente para texto pequeno sobre branco. Todas as combinações e estados devem cumprir WCAG 2.2 AA. Estados de hover, foco, disabled e contraste inverso serão derivados depois de as cores oficiais serem confirmadas.

### Implementação futura dos tokens

- centralizar todos os valores em CSS custom properties;
- componentes consomem apenas tokens semânticos, sem valores hexadecimais nem nomes de cores locais;
- separar tokens de marca, superfície, texto, ação, estado e visualização de dados;
- permitir substituir a paleta central sem alterar componentes ou regras de negócio;
- submeter qualquer tema ou personalização de cliente aos mesmos requisitos WCAG 2.2 AA;
- limitar personalização de cliente a pontos previstos pelo sistema, sem alterar a hierarquia, a semântica dos estados ou a identidade estrutural do produto.

### Cores semânticas

Sucesso, aviso, erro e informação mantêm significados próprios e não dependem apenas da marca. Como o verde é simultaneamente assinatura C4G, sucesso deve incluir ícone e texto explícito para evitar ambiguidade.

| Semântica | Família provisória | Regra |
| --- | --- | --- |
| Sucesso | verde funcional distinto | combinar ícone, rótulo e cor |
| Aviso | âmbar | não reutilizar para estado de candidatura sem legenda |
| Erro | vermelho | reservar para falha, bloqueio ou ação destrutiva |
| Informação | azul | usar para orientação, sincronização e contexto neutro |

### Gráficos

A sequência provisória para séries categóricas é azul escuro, verde-petróleo, verde vivo, azul médio, violeta e âmbar. Esta paleta de dados é deliberadamente mais ampla do que a paleta base do produto. Cada série deve continuar identificável por legenda, rótulo direto, forma ou padrão; cor isolada não pode carregar o significado. Escalas sequenciais usam luminosidade crescente de uma única família. Vermelho e verde sem apoio adicional não devem constituir uma comparação.

Antes de produção, validar contraste, daltonismo, projeção e impressão. Em séries com muitas categorias, agregar em “Outros” ou mudar a visualização em vez de multiplicar cores semelhantes.

## Regras de utilização da marca

- preservar área de respiro, proporção e legibilidade do logótipo; não o reconstruir a partir destes tokens;
- não recolorir, distorcer, rodar ou aplicar efeitos ao logótipo sem variantes oficiais;
- usar o verde vivo como assinatura e ação principal, não como fundo dominante do produto;
- não aplicar a cor de marca a todos os estados positivos;
- usar verde-petróleo escuro de forma consistente na sidebar e navegação; reservar azul escuro para complemento e dados;
- limitar cada vista a uma ação primária visualmente dominante;
- usar cores secundárias com parcimónia e propósito, sobretudo em comunicação, formação e visualização de dados;
- combinar ícone, texto e estado para comunicar significado e acessibilidade.

## Limite entre produto e comunicação

| Produto SaaS | Comunicação e formação |
| --- | --- |
| superfícies neutras, densidade controlada e leitura continuada | maior liberdade cromática e composição mais expressiva |
| componentes repetíveis e estados previsíveis | fotografia dominante, recortes, selos e grafismos de campanha |
| cor orientada a ação, estado e dados | cor orientada também a atenção e emoção |
| tipografia funcional e hierarquia estável | tipografia promocional e mensagens de impacto quando apropriado |
| movimento discreto e funcional | animação e ritmo visual mais dinâmicos, se aprovados |

Materiais promocionais podem ligar ao produto, mas os seus layouts não devem ser copiados literalmente para dashboards, formulários ou tabelas.

## Aplicação nos dashboards

- navegação escura estável; área analítica sobre fundo neutro;
- cabeçalho com organização ativa, período, filtros aplicados e última atualização;
- KPIs em cartões claros, com número, definição curta, tendência e contexto temporal;
- verde de marca para ação primária e realce selecionado, não para preencher todos os cartões;
- gráficos com a paleta categórica acessível e rótulos diretos sempre que o espaço permita;
- alertas e bloqueios usam cores semânticas, ícone e texto, sem herdar automaticamente o verde C4G;
- tabelas preservam densidade legível, cabeçalhos discretos e estados de foco visíveis;
- drill-down mantém filtros e torna explícita a passagem de agregado para registos de origem;
- estados vazios podem usar ilustração linear ou fotografia discreta, sem competir com a ação seguinte.

## Confirmações necessárias da C4G

- Quando existir, qual é o manual de marca vigente e quais são os ficheiros vetoriais oficiais do logótipo e respetivas variantes?
- Quando existir o manual, quais serão os valores oficiais de cor, espaços de cor e combinações aprovadas?
- Que família tipográfica e licenças estão aprovadas para produto digital?
- Existem regras oficiais de iconografia, fotografia, ilustração, cantos, sombras e movimento?
- Que cores secundárias podem integrar produto e gráficos, e quais ficam restritas a comunicação/formação?
- Que elementos concretos podem ser personalizados por cliente dentro do limite aprovado e dos requisitos WCAG 2.2 AA?
