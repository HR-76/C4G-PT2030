# Ficha de Parceiros — integração e consulta
State: Complete

Comparação UBI/C4G: os campos entidade, país, área/interesse, responsável, contacto, email e pessoas (nome, papel, área, contacto/email) já estão recuperados no contrato e nos componentes C4G. Criar/editar/retirar logicamente, histórico e pesquisa por país/papel também existem. Não duplicar o cadastro nem introduzir campos sem evidência.

Incremento autorizado: integrar a ficha existente na página agregada Parceiros, com consulta direta em modal acessível e ligação à secção de parceiros da candidatura; melhorar formulário com limites já estabelecidos pelo servidor (50 pessoas, país 100, áreas 2000, nomes/contactos 200, email 254). Preservar edição no contexto da candidatura, IDs de pessoas, histórico, recibos e permissões. Fechar ficha ao mudar filtros/página/organização; conservar filtros ao fechar normalmente.

Aceitação: ficha apresenta todos os campos e pessoas da linha autorizada; nenhuma escrita na consulta; fecho por Escape/foco restaurado; limpeza ao mudar organização; formulário respeita limites e repetição pendente; testes completos, build e verificação móvel. Sem alterações de esquema, CRM, contas de parceiros ou deploy.

## Resultado e validação

- Ficha de consulta integrada na página Parceiros: abrir pelo nome da entidade, ver campos e pessoas completos, candidatura/aviso associados e ligação à secção Parceiros da candidatura.
- Reutilizados PartnerCards e FormModal: Escape, foco contido e restaurado, layout móvel. Consulta usa apenas dados da página autorizada; nenhuma API de escrita nova. Mudança de filtros/página/organização fecha a ficha.
- Formulário mantém os campos UBI e IDs existentes. Limites alinhados com backend: nomes/responsável/contactos 200, país 100, emails 254, áreas 2000 e 50 pessoas. Ao atingir o limite, informa e bloqueia apenas a adição; retirar uma pessoa permite nova adição.
- Não houve campos UBI em falta no esquema atual; melhoria de integração e UI, sem duplicação ou migração. Edição, retirada lógica, revisões e recibos existentes preservados.
- Regressões adicionadas e verificadas RED antes da implementação. Backend completo: 2583 aprovados, 7 ignorados. Frontend completo: 648 aprovados. Verificação focada final: 9 aprovados, incluindo edição da ficha completa com preservação de pessoa/ID e contactos, pedidos incertos e leitores sem edição.
- Build aprovado. Chrome local com API simulada em 1440/390 px, sem overflow no modal, Escape e conteúdo verificados; captura móvel inspecionada. Não representa validação em base real nem deploy.
- Evidência em output/partner-card-*.log e output/playwright/partner-card/. Revisão focada concluída sem impedimentos; APIs/autorizações/backend não alterados.

Próximo passo: rever e melhorar o percurso de registo de interesse até à criação da candidatura, aproveitando os componentes existentes.
