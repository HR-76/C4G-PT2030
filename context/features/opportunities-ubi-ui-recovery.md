# Recuperar lista e detalhe de oportunidades UBI — Review

Pedido autorizado em 17/10/2026. Referência: `3a79b25`, matriz `reviews/2026-10-17-frontend-ubi-referencia-recuperacao.md`.

Recuperar a tabela responsiva UBI, referência/fonte, programa, datas, estado do registo, financiamento quando disponível e acesso às candidaturas. Recuperar cabeçalho/ações, indicadores, ficha de campos, descrição, áreas e secção de candidaturas no detalhe. Reutilizar estilos/estrutura dos componentes UBI em apresentação comum para central e privada, mantendo serviços, permissões e operações atuais. Não reativar endpoints legacy.

Critérios:
- Catálogo central e oportunidades privadas mantêm identidade/persistência separadas, navegação explícita entre ambos, criação central com revisão exata e candidatura manual independente de matching.
- Filtros central por pesquisa, programa, datas, atuais/histórico e a encerrar 7/14/30 dias, paginação e recuperação de erro permanecem. Voltar ao catálogo conserva filtros aplicados.
- Detalhe apresenta apenas dados existentes; valores ausentes não são zero. Estado ACTIVE significa ativo no catálogo, não aviso aberto. Não inventar dotação, elegibilidade, rondas ou temas. Descrição é texto inerte, links externos apenas HTTP(S).
- Candidaturas associadas lidas pelo serviço privado autorizado da organização; erro/sem permissão nunca é apresentado como zero candidaturas; paginação explícita e descarte de respostas após troca de contexto.
- Edição/arquivo privados mantêm permissões, CAS, idempotência e histórico. Nenhuma eliminação, migração ou recolha externa nesta recuperação visual.
- Testes de componentes focados, sintaxe backend se necessário, build e prova no browser local com dados persistidos, incluindo contexto A/B, filtros e largura móvel. Não declarar paridade integral dos campos que a integração ainda não recolhe.

Deduplicação Gnomon/METU e enriquecimento da fonte continuam lacunas de integração documentadas; não alterar identidades/revisões silenciosamente para recuperar a apresentação.

Implementação disponível na demonstração `http://localhost:5189/catalogo`. [Evidência, capturas e limites da recuperação](../reviews/opportunities-ubi-ui-recovery/README.md): 41 testes frontend, 6 backend, sintaxe e build PASS; Chrome/OIDC real comprovou os quatro detalhes, filtros/regresso, candidatura existente isolada A/B e catálogo comum. Sem novas escritas de domínio. Montantes na lista remetem para detalhe; estado da candidatura por linha não é agregado no catálogo público. Recuperação deste recorte pronta para revisão, sem declarar paridade integral da integração de dados.
