# Entidades e utilizadores — apresentação

Pedido de 29/10/2026: melhorar visualmente o ecrã de administração apresentado pelo utilizador, usando frontend-design.

## Plano visual e aceitação

Paleta: petróleo #075b59, verde suave #edf5f2, branco #ffffff, fundo #f5f7f7, texto #123247, bordas #cbdad6. Tipografia de sistema existente: título 28px, secções 18px, corpo 14px e metadados 12px. Alinhamento à esquerda.

```
Título                                      Atualizar
[Entidades] [Utilizadores]
Orientação de acesso
Convite / explicação curta                   Novo convite
Histórico de convites                        Atualizar
Pesquisa + estado + ações
Resultado / tabela / paginação
```

Revisão da direção: agrupar por tarefa, sem criar cartões por métrica nem números inventados. Convites com cabeçalho verde suave; consulta com quadro branco e tabela de cabeçalho contrastante. Tabs com seleção inequívoca. Evitar o grande espaço solto entre convite e pesquisa.

- Preservar filtros, paginação, contagens, navegação, permissões e fluxo modal de convite.
- Aplicar a listagens de entidades/utilizadores; isolar estilos de dashboard, logs e ficha da entidade.
- Agrupar filtros, tabela e paginação; melhorar contraste e espaçamento em convites vazios e preenchidos.
- Mobile a 390px sem overflow, foco visível, modal com Escape/retorno do foco.
- Executar testes frontend, build e inspeção visual com API sintética. Sem dados reais, envio de convites ou deploy.

Estado: Review — implementado e validado em 29/10/2026.

## Resultado

Separadores com ícones e seleção petróleo; convites num quadro com cabeçalho verde suave e histórico separado; pesquisa, contagem, tabela e paginação reunidas num quadro branco. Cabeçalhos de tabela em sentence case e linhas com maior espaço de leitura. Estilos novos limitados a `.directory-workspace`, ausente das fichas individuais e restantes páginas de administração.

- Frontend: 378 testes PASS em 57 ficheiros. Build Vite PASS. Logs `output/directory-visual-{tests,build}.log`.
- Chrome isolado, API sintética: entidades e utilizadores, convites vazios/preenchidos, 1440px/390px sem overflow nem erros de página; pesquisa e limpeza, modal, Escape e retorno do foco PASS.
- Capturas desktop/mobile revistas em `output/playwright/directory-visual-*.png`; script `output/playwright/directory-visual-check.cjs`.
- Nenhum convite real criado, nenhuma alteração de contratos ou permissões, sem deploy.
