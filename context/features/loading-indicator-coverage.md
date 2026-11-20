# Loader animado em todos os ecrãs

Estado: **Review**, 19/11/2026. Pedido do utilizador: verificar se todas as páginas têm loader e uniformizar.

## Situação encontrada

Todas as rotas mostram o loader comum (`LoadingIndicator`) enquanto o código da página abre. No carregamento dos dados, cerca de uma dúzia de ecrãs mostravam só texto.

## Alteração

- `LoadingIndicator` ganha a variante `compact` (ícone pequeno ao lado do texto), para partes de uma página.
- Loader completo no primeiro carregamento de: O meu trabalho, Calendário da entidade, lista de Candidaturas, Equipa e tarefas, Parceiros da candidatura, Documentos e revisão, Parceiros, Faturação do cliente, Pré-qualificação, Consulta do catálogo, detalhe do ciclo de faturação e Acessos.
- Loader compacto em: oportunidade de origem e histórico da candidatura, histórico da equipa, chat da equipa, documentos do perfil publicado e histórico das integrações.
- Em Documentos e revisão o loader só aparece enquanto não há erro; o botão de recarregar mantém-se.
- Os textos e o papel `status` mantêm-se. Linhas de estado de pesquisa («A pesquisar tarefas…», «A consultar parceiros…») continuam em texto, por serem resumos da lista.
- Ficam sem loader, de propósito, as secções secundárias que só aparecem com dados: objetivos na candidatura, contributos dos departamentos e objetivos dos departamentos do Técnico.

## Validação

Lint e build aprovados. Suite frontend: 1170 aprovados e 2 falhas por tempo limite em `ApplicationDocumentsReview` e `ApplicationPartners`, que passam isolados (50). Sem browser.
