# Identificação do perfil e acesso interesse → candidatura
State: Review
Pedido: 03/11/2026. GCNI_C4G exclusivamente.

Âmbito: verificar conta local da entidade em leitura; distinguir administrador do cliente de membro no menu; tornar explícito o acesso do interesse à candidatura. Sem alterar atribuições de acesso, criar candidaturas reais, publicar ou ativar emails.

Contrato: acrescentar organization.profileLabel ao contrato de sessão/seleção/listagem quando o perfil central é conhecido, calculado a partir do contexto de membership já validado pelo servidor. Campo apenas de apresentação, nunca autorização. Manter identificadores internos e grants fora desta resposta. Sidebar usa perfil da organização selecionada e preserva Administração C4G para o Super Admin; limpar rótulo ao perder/trocar contexto.

Interesses: ação explícita para abrir detalhe e candidaturas; explicar interesse vs candidatura; tornar a preparação mais visível no detalhe; quando indisponível, explicar sem atribuir causas não comprovadas. Criar continua a exigir ação explícita e capacidades atuais do backend.

Critérios: ORG_ADMIN distinto de CONTRIBUTOR/VIEWER e Super Admin; troca/ausência de organização não conserva perfil; contrato não expõe papéis desconhecidos; links funcionam sem mutações; capacidades negadas não mostram criação. Regressões antes das correções, testes focados, suites e build. Registar separadamente conta central real e navegador simulado.

## Verificação e resultado

Consulta real apenas de leitura à base central local: identidade Hugo, organização C4G, membership ativa com perfil ORG_ADMIN e validade atual. Grants organizacionais necessários presentes no mesmo contexto: opportunity_interest.read/manage, opportunity.read e application.read/create/edit. Sessões ativas não expiradas correspondentes selecionam a mesma entidade, com versão de membership atual. Não foram lidos tokens/cookies nem alteradas atribuições. Isto confirma a configuração central; não identifica o separador exato do Brave.

Implementação: profileLabel público derivado do contexto central, sem exposição de membership/grants e sem utilização para autorização; menu distingue perfil da entidade e Administração C4G. Lista de interesses tem ação explícita, detalhe mostra preparação no topo e explica confirmação necessária; mantém consulta de candidaturas associadas, links oficiais e filtros ao voltar.

Regressões falharam antes da correção e passaram depois: backend focado 19 PASS; frontend focado 41 PASS. Suite backend completa 2652 PASS / 7 SKIP / 0 FAIL; frontend 724 PASS; build PASS. Prova Chrome com API simulada cobre administrador/membro em 1440/390, acesso lista → detalhe → formulário e recusa por capacidades; não cria candidatura real.

API local recarregada pelo mesmo entrypoint scripts/startCatalogControlled.js (sem setup, migrations ou seed); /api/local-health através de localhost:3000 devolveu ready:true. Mantidas fontes automáticas e emails desativados. É necessário atualizar a página para consultar novamente o perfil da sessão.

Próximo passo: na sessão do administrador do cliente, abrir um interesse existente e confirmar o formulário de candidatura, sem criar dados de teste na entidade.


Revisão visual final: botão da lista mantém texto completo com quebra de linha, sem corte em desktop/mobile. Gate: test/integration/local-platform/interest-access-ui.cjs; evidência: output/playwright/interest-access/verification.json. Ficheiro de prova usa API simulada; a configuração central foi verificada separadamente em leitura.
