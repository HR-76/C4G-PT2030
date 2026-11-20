# Administração C4G — abertura e continuidade

Estado: Review. Sem medição em ambiente real.

Nono e último bloco da revisão de desempenho página a página (14/11/2026). Bloco anterior: [páginas da Organização](organization-pages-opening-performance.md). Estas páginas leem diretamente a Central, com um a três pedidos; o Dashboard C4G e as Oportunidades foram tratados nos blocos do [Dashboard](dashboard-opening-performance.md) e das [Oportunidades](opportunities-table-opening-performance.md).

## Alterações (só frontend)

1. **Entidades e utilizadores.** As listas de entidades e de utilizadores reabrem com os [dados confirmados](confirmed-reads-page-reuse.md) e são lidas de novo; ao filtrar ou paginar, as linhas anteriores ficam esbatidas e inativas até chegar a resposta, e saem se a leitura falhar. A ficha de uma entidade é sempre lida do servidor.
2. **Faturação da plataforma.** Resumo e ciclos reabrem com os dados confirmados para os mesmos filtros; ao filtrar ou paginar, a posição anterior fica esbatida e inativa.
3. **Logs.** Ao filtrar ou paginar, as linhas anteriores ficam esbatidas e inativas até chegar a resposta. Por ser uma vista de auditoria, nada é guardado entre entradas.

Os dados confirmados da Administração ficam no âmbito do administrador (`readScope(user.id,'')`), só em memória, e são limpos por qualquer escrita, logout ou sessão expirada, como nas restantes páginas.

## Validação

- `PlatformDirectory.test.jsx` (+2), `PlatformLogs.test.jsx` (+1), `PlatformBilling.test.jsx` (+2). Frontend 1080 aprovados, build e lint aprovados. Sem browser nem sessão real.

## Balanço da revisão página a página

Blocos: Dashboard, Oportunidades e Candidaturas, detalhe da candidatura, Interesses, O meu trabalho e Calendário, Parceiros e Matching, Alertas, Organização e Administração C4G; e a cache de `/assets` no Caddy do staging.

Por fazer ou por decidir, por ordem de impacto esperado:

1. **Medir no staging** com sessão real, por perfil, antes e depois. Nenhum ganho desta revisão foi medido.
2. **Permissões do menu «Organização» na sessão** (três pedidos por carregamento; contrato da sessão).
3. **Autorizações repetidas por linha na lista de interesses e nos resumos** (servidor).
4. **Pedido único para o detalhe da candidatura** (registo, equipa e documentos), só se a medição o justificar.
5. **PERF-01**: custo fixo de autoridade e auditoria por pedido.
