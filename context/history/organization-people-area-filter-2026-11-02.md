# Filtro por área temática nas pessoas da organização
State: Complete

Recuperar a seleção por área temática existente na UBI, integrada nos perfis e no isolamento C4G. Uma área de cada vez, combinada com pesquisa, unidade e estado. Todas as áreas remove apenas essa restrição; Limpar filtros repõe os valores iniciais. Não alterar o matching nem os perfis.

Critérios: opções da taxonomia existente; validação de areaId no servidor; filtro SQL antes de LIMIT e delimitado pela organização; cursor vinculado à área; novas pesquisas reiniciam paginação; Mais pessoas preserva a área; resultados antigos não substituem pesquisas recentes. Sem migrações ou deploy.

## Entrega e revisão

- Referência UBI: Investigators.jsx filtrava research_area_ids na lista carregada. Na C4G reutilizam-se os UUIDs e a taxonomia de thematicAreas e as áreas já guardadas em person_profile.
- GET /organization-directory/people aceita areaId validado contra a taxonomia; a resposta inclui as opções existentes. Cliente organizationDirectoryApi.people e fronteiras de autenticação/organização mantidos.
- EXISTS parametrizado sobre o perfil da mesma organização e pessoa, antes de ORDER BY/LIMIT. Combina pesquisa, unidade e estado. Sem área, preserva a semântica anterior e os bindings dos cursores antigos.
- Cursor assinado inclui a área quando selecionada. Testes rejeitam alterações de área, organização e utilizador antes de executar SQL; autorização continua anterior à consulta.
- Seletor Área temática com Todas as áreas, Aplicar filtros e Limpar filtros. Nova pesquisa reinicia a paginação; Mais pessoas conserva os filtros aplicados. Mantida a proteção existente contra respostas fora de ordem.
- Layout existente reutilizado; Chrome local a 1440/390 px sem overflow horizontal, captura móvel inspecionada.

## Verificação

- Regressões de contrato/consulta falharam antes da implementação e passaram depois.
- Suite backend: 2582 aprovados, 7 ignorados, zero falhas. Teste adicional posterior com cursores assinados incluído na execução focada final: 3 aprovados.
- Suite frontend: 646 aprovados. Build e node --check dos módulos backend alterados aprovados.
- Evidência: output/people-area-backend.log, people-area-frontend.log, people-area-focused.log, people-area-build.log e output/playwright/people-area/verification.json.
- Browser com API simulada; consultas verificadas por testes de contrato/repositório. Não executado gate PostgreSQL externo, não aplicadas migrações nem deploy.
- Revisão focada concluída sem impedimentos. Trabalho anterior e matching preservados.

Próximo passo: retomar a Ficha de Parceiros, começando pela integração dos campos e capacidades existentes na UBI.
