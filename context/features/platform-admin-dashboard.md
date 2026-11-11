# Dashboard da administração C4G

Estado: Review. Implementado e validado em 18/10/2026.

## Contrato e critérios

Reorganização autorizada da sidebar: Dashboard primeiro no grupo Plataforma C4G; depois Oportunidades e catálogo (catálogo e fontes); Administração e segurança reúne entidades/utilizadores, logs e segurança da conta. Evitar duplicar catálogo e segurança quando C4G tem organização ativa. Preservar rotas, permissões e navegação das entidades.

Simplificação confirmada em 18/10/2026: retirar o grupo «Qualificação · ferramentas» da sidebar atual das entidades, incluindo Análise de critérios e Publicação do perfil. Preservar páginas, rotas, serviços e dados existentes; futura apresentação contextual no perfil/oportunidade fica por definir.

Página `/administracao/dashboard`, início da sessão C4G e primeira opção do menu da plataforma. Apenas administrador C4G atual, sem exigir organização selecionada. Não alterar o dashboard das entidades.

Totais de entidades e contas centrais (incluindo arquivadas), com subtotal ACTIVE. Contas únicas, não número de memberships. Total de oportunidades centrais, incluindo todos os estados e arquivadas, contando a oportunidade e não revisões/proveniências. Distribuição por ACTIVE/STALE/DRAFT/ARCHIVED; não confundir ACTIVE com prazo de candidatura aberto.

Indicadores adicionais: entradas e utilizadores distintos nos últimos 30 dias, erros nos últimos 24h, cinco entidades mais recentes. Atividade baseada nos logs disponíveis, com início de cobertura e falhas de recolha explícitos. Sem dados privados de candidaturas, sem métricas financeiras ou tendências inventadas. Ligações para entidades, contas, catálogo e logs.

Leitura central autorizada antes e após consulta, snapshot único dos indicadores, timeout, sem cache HTTP. Erro não se apresenta como zero. Datas Europe/Lisbon, estados vazio/carregamento/erro, atualizar manualmente. Sem migração nem escrita de negócio.

## Direção visual (frontend-design)

Paleta existente: petróleo #075B59, verde #39751F, lima #5FAD2F, texto #20262B, fundo #F6F8F8, branco #FFFFFF. Tipografia nativa existente (Segoe UI no Windows), números tabulares; título 28px, indicadores 40px, secções 18px e texto 14px. Conteúdo alinhado à esquerda.

```text
Dashboard C4G                         Atualizar
Entidades         Utilizadores         Catálogo
Estado do catálogo (distribuição)      Atividade
Entidades recentes (tabela)            Atalhos
```

Revisão prévia: usar uma faixa conjunta de totais, evitando cartões repetidos e gráficos sem utilidade. O painel de atividade em petróleo será o único destaque cromático forte; restantes superfícies discretas. Barras acompanhadas de rótulos/valores, sem depender só da cor. Mobile em uma coluna; foco visível e sem animações decorativas.

Validação: testes PostgreSQL de contagens/autorização/revogação, frontend de loading/erro/zero, navegação, build e sintaxe; confronto com base real e revisão Chrome desktop/mobile. Preservar dados e trabalho existente.

## Evidência

- Consulta única central em transação de leitura, autoridade C4G revalidada; nenhuma consulta tenant ou migração. Ligada a `GET /api/admin/directory/dashboard` e ao início da sessão C4G.
- Nove grupos PostgreSQL no gate de logs/dashboard PASS: métricas por estado, contas únicas, ausência de configuração de logs, rejeição de utilizador de entidade/anónimo, input inválido e revogação durante leitura; regressão dos logs preservada.
- 20 testes frontend (dashboard, shell, logs), 11 backend de regressão, sintaxe e build PASS.
- Chrome habitual: login abre dashboard, totais confrontados diretamente com PostgreSQL (1 entidade, 4 contas, 119 oportunidades na observação), distribuição soma o total, atualização manual, anonimato 401. Fingerprints de autoridade, catálogo e dados tenant preservados. Nenhum dado de negócio criado.
- Revisão visual 1440/390: hierarquia, links e barras legíveis, layout sem overflow; singular das contagens corrigido após a revisão. API e workers saudáveis. Evidência em `output/playwright/c4g-admin-dashboard/native-verification.json` e capturas `native-dashboard-{1440,390}.png`; gate em `test/integration/platform-logs/gate.js`.

Limites: atividade cobre apenas o período em que os logs estiveram ativos; falhas de recolha podem reduzir as contagens. Estados ACTIVE do catálogo não equivalem a concursos abertos. Totais incluem a entidade C4G e contas administrativas existentes, não representam apenas clientes pagantes.

Próximo passo: rever o Dashboard C4G com o utilizador.
