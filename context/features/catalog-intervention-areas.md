# Áreas de intervenção do catálogo C4G
Estado: Complete
Pedido aprovado em 02/11/2026: implementar famílias gerais, classificar as 178 oportunidades com evidência, Por classificar quando insuficiente, descrição completa na ficha e validação nos dois perfis.

## Contrato
- Coluna única Áreas de intervenção substitui Áreas e Descrição da call na tabela do catálogo comum. Tipificação mantém Concurso/Convite/etc. A ficha conserva descrição integral, objetivos específicos e apresenta áreas com justificação consultável.
- Famílias gerais C4G têm códigos estáveis e versão explícita, reutilizando as 30 áreas existentes como referências de subáreas quando aplicável; novas famílias cobrem Habitação, Administração Pública e Assistência Técnica. Não substituir a taxonomia F13 nem alterar o matching/pessoas.
- Classificação determinística, com várias áreas possíveis. Guardar versão, digest dos dados e evidência por regra/campo. Objetivos PT2030 apenas com scheme/fonte corretos; títulos e texto com limites de palavras/expressões, nunca correspondências parciais como dados em cuidados. Não inferir Biotecnologia de tecnologias críticas, nem Saúde de digitalização.
- Implementação aditiva na leitura autorizada do catálogo: classificação recalculável ligada à revisão; relatório de conferência guarda os resultados das 178 identidades e revisões. Sem reescrita de snapshots, novas recolhas ou alterações de permissões.
- Filtro de área, incluindo Por classificar, aplicado pelo servidor antes da paginação; filtros existentes, retorno da ficha e exportação conservam contexto. Sem filtro por omissão.
- Super Admin gere/consulta o catálogo comum, sem acesso privado implícito; administrador da entidade conserva interesses e candidaturas autorizados.

## Aceitação
1. Todas as 178 oportunidades têm resultado explícito CLASSIFIED/UNCLASSIFIED, com evidência verificável para cada área; relatório identificável por versão e revisão.
2. Regressões para falsos positivos, dados sem evidência, códigos ambíguos, títulos de saúde/digital/biotech; classificação igual na tabela/ficha.
3. Filtro atravessa várias páginas sem omissões/duplicações; inválidos recusados antes de abrir ligação; permissões e revogação preservadas.
4. Tabela sem Descrição da call nem Áreas duplicada; ficha mantém descrição integral; filtro funciona nos dois perfis; moeda sem aviso retirado pelo utilizador.
5. Testes focados, suites completas e build, browser autenticado admin/hugo em desktop e móvel. Base com 178 oportunidades/revisões e fontes suspensas.

## Encerramento
174 classificadas e 4 Por classificar. Revisão pronta para encerrar; suites completas, build e browser nos dois perfis passaram. Evidência: `../reviews/catalog-intervention-areas-2026-11-02.md` e JSON adjacente.
