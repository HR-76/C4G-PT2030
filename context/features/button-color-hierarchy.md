# Hierarquia e cores dos botões

Estado: Review — 30/10/2026. Implementação, testes e revisão concluídos; [evidência](../reviews/button-color-hierarchy.md).

## Atualização de 11/11/2026 — ação única em azul e quatro níveis (contrato em vigor)
Por decisão do utilizador, a cor de ação passa a ser só azul `#245BB3` (hover `#194686`, suave `#EDF3FC`, contorno `#9DB8E3`). Substitui o petróleo da atualização de 10/11 abaixo e resolve a divergência com a [hierarquia de cor na interface](interface-color-hierarchy.md). `--ui-action` deriva agora de `--color-primary`, pelo que ligações, foco e seleção acompanham.

| Nível | Classe | Aparência | Uso |
|---|---|---|---|
| 1 · Principal | `btn-primary` | Azul preenchido | Uma por ecrã ou diálogo: Guardar, Criar, Aplicar filtros |
| 2 · Secundária | `btn-outline` | Branco, texto e contorno azuis | Ações de apoio: Exportar, Editar, Atualizar, Tentar novamente |
| 3 · Neutra | `btn-secondary` | Cinzento suave, sem contorno | Cancelar, Limpar, Voltar, Fechar, paginação |
| 4 · Destrutiva | `btn-danger` / `btn-danger-solid` | Contorno vermelho; preenchido só na confirmação | Remover, Revogar, Suspender |

- Estados selecionados (separadores do Dashboard, filtros, Lista/Cartões, tarefas) usam azul suave, nunca preenchido.
- O verde fica para sucesso, logótipo e item ativo da sidebar. O botão «Entrar» pertence ao tema do Keycloak e não foi alterado.
- Removidos os estilos próprios de botões em Segurança da conta, Matching e Unidades; «Ativar verificação por email» é `btn-primary`.
- 96 botões reclassificados entre os níveis 2 e 3 por rótulo; três testes que fixavam «Cancelar» como contorno foram atualizados.
- Texto informativo não usa a cor de ação (pedido do utilizador, 11/11/2026): rótulos em `--color-text-secondary`, valores e títulos em `--color-text-primary`. O azul fica para o que é clicável (botões, ligações, separadores) e para estados selecionados. Corrigido na ficha e na criação de candidatura, lista de candidaturas, perfil da organização, faturação da plataforma e Dashboard C4G.
- Validação: build PASS; 922 testes frontend PASS. Validação visual autenticada pendente. Por rever: ecrãs com mais de uma ação principal visível (Entidades e utilizadores) e rótulos dinâmicos que o levantamento não classificou.

## Atualização de 10/11/2026 — ação principal em petróleo (substituída)
Por decisão do utilizador, a ação principal passa a usar petróleo `#245C60` (hover `#19494B`) em todas as páginas, substituindo o verde `#39751F`/`#48752A` descrito abaixo. Aplica-se também às variantes `btn-create` e `btn-brand` e à Segurança da conta (que tinha um botão preto). O verde C4G fica no logótipo, no item ativo da sidebar e no selo de interesse confirmado. A hierarquia (principal, apoio, destrutivo, sair) e os restantes pontos deste contrato mantêm-se. Texto branco sobre `#245C60` tem contraste aproximado de 7,6:1. Detalhes em [fundações e shell](metronic-foundations-shell.md).

## Pedido e âmbito aprovados

O utilizador aprovou a proposta visual e pediu a sua implementação: manter o verde escuro C4G nas ações principais; usar vermelho em eliminar/remover e sair, com níveis de destaque distintos; apresentar o interesse registado em verde suave apenas após confirmação do sucesso. Este incremento altera a apresentação do frontend, sem mudar contratos HTTP, permissões, dados, navegação ou semântica das operações.

## Contrato

- Ação principal: preenchimento `#39751F`, texto branco; hover `#2D5D18`. O verde de marca `#5FAD2F` não substitui o fundo acessível dos botões com texto branco.
- Ações de apoio: contorno neutro; cancelar/fechar/voltar discretos. Evitar promover ações repetidas de listas a ações principais.
- Eliminar/remover: ação inicial vermelha de baixo destaque, com texto ou nome acessível; confirmação destrutiva preenchida a vermelho `#DC2626`, hover `#B91C1C`. Cancelar a confirmação continua neutro. Arquivar preserva o histórico e não é apresentado como eliminação.
- Aplicar a mesma distinção visual às ações existentes de revogar, suspender acesso, estornar e cancelar operações persistidas. Reativar acesso e cancelar a edição mantêm aparência neutra; a fase de revisão mantém baixo destaque. Não acrescentar confirmações nem alterar a semântica dessas operações.
- Sair: texto visível e ícone, vermelho discreto. Sobre a navegação `#075B59`, usar vermelho claro `#FECACA`; manter a mesma operação de logout e foco visível.
- Interesse por registar: ação de contorno «Registar interesse» que mantém a abertura do formulário. A submissão mostra «A guardar…» e impede duplicação enquanto aguarda.
- Interesse confirmado: selo verde suave `#EDF5E8`, texto `#39751F`, visto e «Interesse registado», junto da ação neutra «Ver interesse». Não é um toggle; o clique não remove nem arquiva o interesse.
- Interesse arquivado: selo neutro «Interesse arquivado», sem visto de sucesso, mantendo «Ver interesse» e o histórico. Falhas, estados desconhecidos e submissões por confirmar nunca apresentam sucesso.
- Cores partilhadas ficam em tokens semânticos; texto/ícones comunicam significado sem depender só da cor. Preservar foco de teclado e legibilidade em desktop e mobile.

## Critérios de aceitação

1. Botões principais, de apoio e destrutivos têm estilos coerentes, incluindo hover, foco e indisponibilidade; overrides locais não neutralizam a hierarquia.
2. «Sair» é visível e acessível, vermelho na superfície da sidebar, e chama o logout existente uma única vez.
3. A confirmação destrutiva é vermelha e o seu cancelamento neutro; os restantes controlos de remoção usam o estilo discreto apropriado sem mudar os handlers.
4. O catálogo apresenta o selo de sucesso apenas para interesses existentes/confirmados; abrir o formulário, aguardar resposta ou falhar não cria esse selo. Arquivados continuam distinguíveis.
5. A navegação «Ver interesse», os retornos, as autorizações e os estados de envio pendente mantêm-se.
6. Texto normal dos pares ativos relevantes tem contraste mínimo 4,5:1. Foco e controlos funcionam a 1440 e 390 px sem sobreposição.
7. Regressões focadas passam, suites locais completas são executadas com falhas preexistentes separadas e build frontend passa.

## Plano

1. Inspecionar componentes, estilos globais e overrides; acrescentar primeiro regressões dos estados e do logout.
2. Aplicar tokens/variantes partilhadas, selo de interesse, saída e correções pontuais de hierarquia identificadas na inspeção.
3. Executar verificações focadas, suites e build; rever visualmente em ambiente isolado sem gravar dados de negócio.
4. Registar resultados e limitações em `context/reviews/button-color-hierarchy.md`.

## Referências da proposta

- [Carbon — Button](https://www.carbondesignsystem.com/building-blocks/core/components/button/guidelines): hierarquia de destaque e variantes destrutivas.
- [GOV.UK — Button](https://design-system.service.gov.uk/components/button/): confirmação destrutiva e uso moderado do vermelho preenchido.
- [WCAG — Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) e [Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
