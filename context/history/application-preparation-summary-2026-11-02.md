# Resumo de preparação da candidatura
State: Complete

Funcionalidade nova, explicitamente aprovada pelo utilizador após distinção face à UBI. Reutiliza as consultas autorizadas já feitas pelos componentes de equipa/tarefas e documentos; não cria endpoints, permissões ou persistência.

## Contrato

- Três blocos: equipa (responsável e participantes ativos), tarefas abertas (prazos e atalhos) e documentos/revisão (versões indisponíveis, pedidos pendentes e alterações solicitadas).
- Os componentes existentes publicam apenas a projeção já carregada ao resumo. Enquanto carregam, atualizam, aguardam confirmação ou têm erro/acesso recusado, o resumo não apresenta números anteriores como atuais.
- Contagens de participantes/tarefas/revisões limitadas às páginas carregadas, com indicação explícita quando existe cursor. Nunca interpretar erro ou página incompleta como zero pendências.
- Tarefas: apenas OPEN, por prazo e ID, até três atalhos iniciais e indicação das restantes carregadas. Data local define prazo ultrapassado; tarefa com prazo hoje não é atrasada.
- Documentos: usable do servidor é a referência. Pedidos com stale ou documentsRestricted não contam como revisões atuais utilizáveis; são assinalados separadamente. Não inferir aprovação global nem escolher revisão mais recente pela ordem UUID da paginação.
- Atalhos para secções e tarefas/documentos/pedidos exatos já apresentados. Nenhuma ação de escrita automática.
- Sem percentagem de completude, elegibilidade ou declaração de pronto para submissão. Sem checklist de documentos obrigatórios inventada.
- Isolamento por candidatura/utilizador/organização continua nos componentes e na chave do ecrã; o resumo não conserva dados entre contextos.

Aceitação: estados de carregamento/erro/pendência, páginas parciais, tarefas concluídas, revisão desatualizada/restrita, atualização após alteração e limpeza após revogação/contexto. Sem pedidos adicionais na integração; testes completos, build e Chrome com API simulada.

## Entrega e revisão

- Resumo integrado no detalhe da candidatura, com três cartões responsivos e navegação para as pendências exatas. A orientação por estado recuperada da UBI mantém-se.
- Componentes existentes comunicam projeções ao ecrã; nenhuma consulta adicional, alteração de API, base de dados ou autorização. Links oficiais preservados.
- Revisão concluída: paginação explicitamente parcial, estados de erro/atualização sem dados anteriores, apenas tarefas abertas, revisão restrita/desatualizada separada, sem conclusão de elegibilidade. Estado do ecrã isolado pela chave utilizador/organização/candidatura. Sem bloqueios identificados neste âmbito.
- Testes do resumo cobrem carregamento, erro, pendência, atualização, páginas parciais, prazo local, revisões restritas/desatualizadas e tarefas concluídas. Testes de integração do componente de equipa verificam atualização após mutação, ausência de consultas adicionais, recusa de acesso e limpeza ao desmontar.
- Frontend: 669 testes aprovados / 82 ficheiros. Backend: 2583 aprovados, 7 ignorados, zero falhas. Build de produção aprovado.
- Chrome local com API simulada: desktop 1440px e telemóvel 390px, sem overflow, atalhos com foco no alvo, uma consulta inicial por fonte. Evidência em output/playwright/preparation-summary/verification.json e capturas associadas.
- Limites: contagens refletem apenas páginas consultadas. Não equivale a teste com infraestrutura real; R2/ClamAV reais e deploy continuam adiados por decisão do utilizador.

Próximo passo: validar de ponta a ponta o percurso já integrado, do registo de interesse à preparação da candidatura, com cenários de administrador e membro da equipa, corrigindo eventuais fricções sem acrescentar funcionalidades.
