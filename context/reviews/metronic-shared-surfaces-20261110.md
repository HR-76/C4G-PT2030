# Revisão de apresentação C4G — 10/11/2026

## Resultado

Linguagem comum de tabelas, pesquisa e cartões aplicada ao conteúdo da GCNI_C4G, inspirada no Metronic Demo 1 e na paleta petróleo aprovada. Os tokens de ação, foco, superfícies e bordas estão em `frontend/src/c4g-surfaces.css`. A sidebar mantém as cores próprias da marca.

- Pesquisa partilhada na faturação e no catálogo unificado; preservados os campos de datas e montantes.
- Tabelas com cabeçalhos e foco coerentes; apresentação móvel mantém a informação em cartões quando essa adaptação já existe.
- Cartões de diretórios, convites, segurança e faturação com bordas e fundos consistentes. Corrigido espaçamento duplicado nos convites administrativos.
- Legenda do gráfico de estados organizada verticalmente, resolvendo uma colisão com estilos antigos.
- Percurso da faturação e histórico passa a identificar a página atual no cabeçalho.
- Pesquisa de páginas deixa de apresentar a administração de fontes a contas de entidade, acompanhando a proteção já existente na rota.

## Verificação real no navegador

Chrome local, com contas habituais da entidade e da Administração C4G. Capturas a **1440 × 1000** e **390 × 1000**. Nenhum erro JavaScript, resposta HTTP de leitura em erro ou transbordo horizontal detetado nas páginas abaixo.

| Área | Páginas verificadas |
| --- | --- |
| Entidade | Dashboard, Catálogo, Candidaturas, Parceiros, Matching, Alertas |
| Organização e conta | Perfil da organização, Unidades, Pessoas, Acessos, Perfil pessoal, Segurança |
| Cliente | Faturação e Histórico de faturação |
| Administração | Dashboard C4G, Entidades, Logs, Faturação, Importar Portugal 2030, Fontes de oportunidades |

Os resultados completos das 20 páginas e as repetições selecionadas estão em `output/playwright/metronic-continuation/after-organization/` e `after-platform/`. Os primeiros levantamentos da entidade estão em `before-organization/`; não constituem uma comparação quantitativa de desempenho ou garantia de conteúdo idêntico em todos os instantes.

Interações verificadas nas duas contas:

- Pesquisa centrada; texto sem correspondência; Escape e regresso ao botão com foco visível.
- Menu pessoal fecha com Escape.
- Formulários de convite abrem, contêm o foco durante Tab/Shift+Tab e devolvem o foco ao botão de abertura quando fecham.

Foram bloqueados comandos HTTP de negócio no navegador de verificação. Não foram criados clientes, utilizadores, candidaturas ou faturas, nem enviados convites. A autenticação utilizou o fluxo habitual.

## Correções identificadas durante a verificação

Escape no campo de pesquisa podia consumir a tecla sem fechar o diálogo. Foi introduzido fecho explícito com reposição de foco e teste direcionado.

No convite de nova entidade, o botão era desativado ao abrir o formulário e perdia o foco antes da captura automática. Um teste reproduziu o defeito; a referência explícita ao botão corrigiu-o. Testes e Chrome confirmaram o resultado. As falhas anteriores das verificações e uma tentativa de login que expirou não representam o estado final; a repetição concluiu com sucesso.

## Validação e limites

- Frontend: **870 testes / 101 ficheiros PASS**.
- Build Vite: **PASS**.
- Não houve alterações ao backend, aos contratos HTTP ou às regras de autorização nesta continuação.
- A entidade local não tem faturas: faturação e histórico carregam e apresentam o estado vazio correto; não foi feita uma confirmação visual de uma fatura emitida ou do respetivo PDF.
- Foram revistas as páginas principais com dados acessíveis às duas contas e os diálogos descritos. Isto não valida todas as fichas, todos os estados possíveis ou todos os perfis de autorização. Os testes existentes continuam a cobrir os comportamentos funcionais correspondentes.

## Capturas selecionadas

- [Dashboard](../../output/playwright/metronic-continuation/after-organization/dashboard-1440.png)
- [Perfil pessoal em telemóvel](../../output/playwright/metronic-continuation/after-organization/perfil-390.png)
- [Entidades e convites em telemóvel](../../output/playwright/metronic-continuation/after-platform/administracao-entidades-390.png)
- [Faturação](../../output/playwright/metronic-continuation/after-organization/faturacao-1440.png)
