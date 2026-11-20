# Páginas da Organização — abertura

Estado: Review. Sem medição em ambiente real.

Oitavo bloco da revisão de desempenho página a página (14/11/2026). Bloco anterior: [Alertas](alerts-opening-performance.md). Perfil da organização, Unidades e Pessoas já abriam de imediato desde 11/11 (`directoryCache.js`) e não foram alterados.

## Alterações (só frontend)

1. **Perfil pessoal e ficha da pessoa.** Usam os [dados confirmados](confirmed-reads-page-reuse.md): aparecem de imediato e são lidos de novo; uma leitura recusada retira-os. Um formulário em edição não é substituído quando a resposta é o perfil que já está no ecrã.
2. **Acessos.** A moldura (`Layout`) já pedia `GET /organization-directory/access` em cada carregamento, só para decidir a ligação do menu, e descartava a resposta. Passa a guardá-la como dado confirmado; a página de Acessos da entidade abre de imediato com ela e lê de novo. A seleção em curso só é reposta se a resposta for diferente. A tabela usada na Administração C4G não guarda nada.
3. **Faturação.** A comparação com a ficha da entidade usa o contexto do diretório que já está em memória e só o pede quando não existe. Faturas, resumo, detalhe e dados de faturação reabrem com os dados confirmados; uma leitura recusada retira-os.

## Validação

- `PersonalProfile.test.jsx` (+2), `CustomerBilling.test.jsx` (+2), `OrganizationAccess.test.jsx` (+1). Frontend 1075 aprovados, build e lint aprovados. Sem browser nem sessão real.
- O teste dos Acessos confirma a leitura repetida e a ausência de dados sem âmbito, mas não o conteúdo apresentado a partir da memória.

## Não feito

4. **Grupo «Organização» do menu.** Em cada carregamento completo, a moldura faz três pedidos de permissões (diretório, acessos, faturação) e o grupo só aparece depois. Trazê-las na resposta da sessão altera o contrato da sessão no servidor; diretório e acessos decorrem do perfil, a faturação depende de uma concessão individual. Por decidir.
