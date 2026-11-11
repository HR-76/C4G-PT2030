# Entrega 2 — pessoas, perfil pessoal e Matching do piloto

Estado: Complete, 2026-10-17. Visual aprovado pelo utilizador; revisão final autorizada e concluída no ambiente habitual após preenchimento do perfil pelo titular. [Fecho e limites](../history/c4g-pilot-parity-delivery-2.md). Contrato superior: [plano de recuperação, entrega 2](c4g-pilot-parity-action-plan.md).

Implementação e ensaio isolado concluídos; [provas, comparação e limites](../reviews/c4g-pilot-parity-delivery-2.md). O utilizador aprovou o visual e autorizou explicitamente a atualização local («Autorizo»). Migrações 016/026 e três permissões aplicadas com cópias de segurança verificadas; dados de negócio, identidades e memberships preservados. Validação Chrome/OIDC no ambiente habitual PASS, incluindo estados sem associação e sem áreas. Posteriormente, por pedido explícito, a conta foi associada à ficha real. O titular preencheu as competências na página; a releitura confirmou biografia, palavras-chave e seleção de Cibersegurança e FinTech e Economia Digital. As duas sugestões do Matching foram confrontadas com requisitos oficiais, sem afirmar elegibilidade nem alterar o algoritmo original.

## Implementação delimitada

Reutilizar o diretório 025, árvore F13-P1, páginas Profile/Matching e classificação determinística `researchAreaMatcher`. Acrescentar apenas persistência de biografia, palavras-chave, áreas pessoais e associação explícita pessoa–membership. Associação escolhida pelo gestor, nunca inferida de email; criar pessoa não cria conta. Perfil pessoal resolve a pessoa pela membership atual, não por identificador enviado pelo cliente. Alterar uma pessoa inativa não reativa a membership.

O catálogo de áreas inicial reutiliza integralmente os 30 nomes/palavras-chave de `researchAreaSeedService.DEFAULT_RESEARCH_AREAS`. Identificação estável por hash do nome original e namespace de recuperação, exposta com nome e versão; IDs numéricos do piloto não são transportados entre bases. Não se equiparam estes IDs a conceitos F13 existentes sem correspondência explícita. Administração/evolução da taxonomia permanece na entrega 4. Não há alterações às publicações F13 nem dependência de perfil publicado.

Matching consome apenas catálogos autorizados atuais e pessoas da organização. Reutiliza `suggestResearchAreas` com os parâmetros originais (mínimo 1, máximo 3); apresenta áreas e palavras que explicam a classificação sugerida. Cruzamento exato com áreas pessoais, ordenado por número de áreas coincidentes e prazo, sem score novo. Excluir registos arquivados/cancelados e prazos passados; prazo ausente mantém-se explicitamente desconhecido. Não afirmar elegibilidade ou abertura pelo estado do registo. Falha de leitura não equivale a zero resultados; mudanças de organização descartam respostas antigas.

## Aceitação

1. Unidade/pessoa: criar/editar, pesquisar, filtrar, preservar várias afetações e unidade principal; isolamento atual mantido.
2. Gestor consulta ficha da pessoa, guarda biografia/competências e associa apenas membership da mesma organização. Outra entidade não lê nem altera a ficha; CAS, idempotência e auditoria mantidos.
3. Perfil pessoal apresenta/edita a própria ficha autorizada; ausência de associação tem explicação e não permite apropriar a ficha de outra pessoa. Não exige perfil completo para candidaturas.
4. Matching por pessoa, pelo próprio perfil e pessoas correspondentes à oportunidade; tabela original, nomes das áreas, explicação e navegação para fontes atuais. Casos vazio/sem perfil/sem competências/erro distintos.
5. Acessos geridos no âmbito da membership central, nunca do utilizador global; suspensão/reativação comprovadas com duas organizações. Nenhuma criação implícita de conta ou alteração de credenciais.
6. Migração aditiva validada em PostgreSQL isolado, testes de autorização/isolamento/concorrência, build, browser e comparação com os componentes originais. Só depois adaptar a instalação habitual preservando dados e histórico.

Precisão da revisão final em dados reais: no cartão móvel do Matching, todas as explicações de uma oportunidade com várias áreas devem permanecer alinhadas, com o título completo e sem overflow. Correção apenas de apresentação; classificação e dados preservados.

Fora do âmbito: IA, novo motor de qualificação, publicação obrigatória, novas configurações, dados de equipa inventados, candidaturas completas da entrega 3, novas fontes da entrega 4 e operações Git/publicação.

## Persistência e acessos

Migração tenant 026 adiciona perfil pessoal com isolamento, revisão e receipts aos mecanismos existentes. Migração central 016 adiciona ao protocolo fechado apenas as consultas necessárias à suspensão/reativação e à auditoria central. Permissões explícitas `personal_profile.read`, `personal_profile.edit` e `organization_membership.manage`; nenhuma alteração automática de roles globais. Operações anteriores continuam a validar o fingerprint exato do esquema instalado durante a transição.
