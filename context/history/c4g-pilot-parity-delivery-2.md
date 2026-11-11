# Recuperação do piloto C4G — entrega 2

Estado: **Complete**, 2026-10-17. Visual aprovado («Gostei estamos no caminho»), atualização local autorizada («Autorizo»), associação à ficha solicitada expressamente e competências preenchidas pelo titular. Revisão final do perfil, Matching e requisitos oficiais autorizada por «ok avança» e concluída. Não implica aprovação de uma candidatura nem de novas funcionalidades.

## Resultado e aceitação

| Critério | Evidência de conclusão |
| --- | --- |
| Organização → unidades → pessoas | Formulários, pesquisa, hierarquia, várias afetações/principal e isolamento demonstrados em PostgreSQL descartável; percurso de consulta repetido na instalação habitual. |
| Ficha e associação explícita | CAS, idempotência, autorização e auditoria validados; conta real associada à ficha existente por pedido do utilizador, sem criar acesso implícito. |
| Perfil pessoal | Própria membership resolve a ficha; titular guardou biografia, palavras-chave e duas áreas. Releitura em Chrome/OIDC confirmou valores iguais aos do serviço e revisão 2. |
| Matching explicável | Regra original do piloto, catálogos central/privado autorizados, estados vazios e erros distintos. Perfil próprio/pessoa e consulta inversa demonstrados; duas oportunidades centrais reais, explicações e detalhes verificados. |
| Acessos da organização | Suspensão/reativação, recuperação e isolamento entre duas organizações com a mesma identidade comprovados; identidade global e pessoa preservadas. |
| Migração e apresentação | 016/026 aditivas verificadas, backups e dados preservados. Comparação com componentes originais, aprovação visual e ativação nativa verificadas. Correção final do alinhamento móvel de múltiplas áreas inspecionada em 390 px; desktop 1008/1440 preservado. |

Validação anterior: 88 testes frontend, 73 backend e 40 de compatibilidade com sobreposição, build/sintaxe, gates PostgreSQL e browser. Nesta revisão: novo ensaio real somente de leitura PASS após correção CSS; zero erros JavaScript/escritas de negócio e hashes antes/depois iguais; build frontend, sintaxe dos scripts e regeneração da comparação PASS. Não somar contagens sobrepostas nem declarar testes anteriores repetidos.

## Limites preservados

- O Matching cruza áreas selecionadas; não usa diretamente biografia/palavras-chave pessoais nem certifica elegibilidade. Termos genéricos podem gerar correspondências pouco pertinentes. Sem IA ou novo score.
- EFCSN requer atividade elegível de verificação de factos, não demonstrada para C4G. POLICY ENLARGE admite acolhimento europeu no instrumento 3, sujeito a parceria/participante elegíveis; não foi declarada elegibilidade. Requisitos oficiais e fontes estão na revisão.
- Não foi inventada afetação a unidade, biografia ou competência. O preenchimento da restante equipa depende de dados reais.
- Mantêm-se limites de 1000 registos por origem/lista, ausência de ensaio de carga e distinção entre instalação local e prontidão para produção. Os testes de isolamento usam duas entidades de ensaio, não escritas fictícias na entidade real.
- Candidatura continua independente de perfil completo e Matching. Dados, histórico, autenticação e tarefas existentes preservados. Entrega 3 não iniciada.

Fontes: [contrato](../features/c4g-pilot-parity-delivery-2.md), [revisão e requisitos oficiais](../reviews/c4g-pilot-parity-delivery-2.md), [prova real final](../../output/playwright/c4g-pilot-people/real-profile/review.json), [comparação lado a lado e capturas atuais](../../output/playwright/c4g-pilot-people/comparacao.html).

Próximo passo: preparar o contrato executável da entrega 3 a partir das páginas originais de candidaturas e dos serviços atuais, preservando tarefas e independência de Matching/perfil completo.
