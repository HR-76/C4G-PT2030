# C4G Funding Platform

## Produto pretendido

Produto C4G multi-instituição para universidades, câmaras municipais, empresas e outras entidades. A plataforma centraliza oportunidades de financiamento, qualifica a sua relevância para cada organização, acompanha candidaturas e produz reporting operacional e de gestão.

A aplicação UBI existente é uma implementação/piloto anterior. Não define o produto universal.

## Problema

As organizações descobrem oportunidades em fontes dispersas, avaliam-nas com critérios pouco consistentes e acompanham candidaturas em ferramentas fragmentadas. Isso reduz a rastreabilidade, dificulta a colaboração e torna os indicadores de gestão pouco fiáveis.

## Quatro pilares

1. **Descoberta e centralização:** reunir oportunidades relevantes de várias fontes num catálogo único.
2. **Matching e qualificação:** relacionar oportunidades com competências, interesses, prioridades e elegibilidade de cada organização.
3. **Pipeline de candidaturas:** acompanhar oportunidades selecionadas desde a intenção até à submissão e resultado.
4. **Reporting institucional:** medir oportunidades, candidaturas, financiamento, taxas de sucesso e participação das equipas.

## Utilizadores e acesso

- **Administrador C4G:** gere plataforma, clientes, configurações globais, integrações centrais e suporte auditado.
- **Administrador da organização:** gere utilizadores, unidades, competências, prioridades e configuração do cliente.
- **Gestor de financiamento:** gere oportunidades, qualificação, matching, candidaturas, tarefas e reporting no âmbito autorizado.
- **Colaborador:** participa nos processos em que está envolvido.
- **Utilizador de consulta:** consulta apenas informação autorizada.

Um utilizador tem uma identidade global C4G, mas uma conta operacional de entidade pertence a uma única organização e recebe nessa membership um perfil interno. A identidade global evita duplicar credenciais e preserva o histórico; não concede acesso multi-entidade. A Administração C4G usa atribuições próprias de plataforma, sem membership implícita nos clientes. O acesso normal ocorre por convite ou aprovação; registo público não concede acesso automático.

Clarificação confirmada em 18/10/2026: os técnicos consultam apenas candidaturas em cuja equipa participam; a pertença a um departamento não dá acesso às restantes. Todas as entidades consultam o catálogo central, administrado pela C4G. **Por decisão posterior do utilizador, nesta fase os parceiros e as suas pessoas são apenas registos informativos na candidatura, para conhecimento do gestor.** Convites, acesso externo e colaboração em tarefas foram retirados do âmbito ativo. Mantém-se o percurso de parceiros recuperado na entrega 3. O [plano de utilizadores internos e parceiros](features/organization-users-and-application-guests.md) regista esta simplificação e as questões de acesso interno ainda por implementar/verificar.

## Organizações

A regra de leitura dos técnicos por equipa está implementada e validada localmente no [incremento de acesso por equipa](features/application-technician-team-access.md), em Review desde 18/10/2026. A [gestão simples de perfis no ecrã Acessos](features/organization-internal-access-profiles.md) está implementada e validada localmente, em Review: administrador atribui perfis; gestor atribui Técnico e gere o estado dos técnicos da entidade; técnico continua limitado à equipa. O ecrã gere contas já associadas, sem convites ou colaboração externa.

- Cada cliente é uma organização isolada.
- Unidades organizacionais são hierárquicas e configuráveis.
- Uma unidade pode representar faculdade, departamento, divisão, gabinete, unidade de negócio, equipa ou outro conceito local.
- Utilizadores podem pertencer a várias unidades e ter uma unidade principal.
- Dados e permissões podem ser limitados à organização, unidades, equipas ou recursos concretos.
- “Professor” é uma função ou atributo configurável, não um perfil universal.

## Capacidades do MVP

- Catálogo central C4G, alimentado por integrações e criação manual exclusiva da Administração C4G; oportunidades privadas anteriores preservadas para consulta histórica.
- Criação manual e importação Excel/CSV.
- Conjunto inicial de conectores oficiais após validação técnica.
- Deduplicação determinística e revisão humana de correspondências incertas.
- Qualificação separada das candidaturas.
- Matching determinístico, ponderado, configurável e explicável, sem IA.
- Pipeline configurável com etapas, transições, responsáveis, tarefas, uma aprovação interna e documentos obrigatórios.
- Histórico imutável e auditoria.
- Dashboard operacional e de gestão.
- Exportação CSV/Excel e resumo PDF com as mesmas permissões do ecrã.

## Princípios de dados

- O catálogo central é mantido pela C4G; organizações não alteram dados comuns para outros clientes.
- Cada organização mantém avaliação, notas, prioridade, responsáveis e dados privados sobre uma oportunidade.
- Decisão de 30/10/2026: registar interesse guarda um vínculo privado da organização antes de abrir candidatura. Administradores da organização, gestores e técnicos podem sinalizar; consulta apenas lê. Departamentos/unidades podem ser associados para segmentação, sem conceder acesso a candidaturas. [Contrato e plano](features/organizational-opportunity-interest.md) preparados; implementação ainda por iniciar.
- Decisão de 29/10/2026: só a Administração C4G cria oportunidades, manualmente quando não existe API, no catálogo comum. Os clientes consultam o catálogo e mantêm qualificação e candidaturas privadas. Oportunidades privadas anteriores continuam isoladas no cliente, sem promoção automática nem novas criações. Ver [contrato](features/central-manual-opportunity-authoring.md).
- Oportunidades e candidaturas são arquivadas, nunca eliminadas automaticamente.
- Resultados históricos permanecem explicáveis quando regras ou configurações mudam.
- Nenhum relatório, exportação, job ou acesso de suporte pode quebrar o isolamento do cliente.

## Fora do MVP

- IA ou pesquisa semântica no motor principal de matching.
- Regras condicionais avançadas e múltiplos níveis complexos de aprovação.
- Construtor livre de relatórios.
- Benchmarking entre clientes.
- Análises preditivas.
- Domínios de e-mail personalizados por cliente.
- Forks de produto específicos por cliente.

## Critérios de sucesso

- O catálogo agrega oportunidades com proveniência, qualidade e histórico verificáveis.
- Organizações conseguem decidir relevância com regras transparentes e intervenção humana.
- Uma oportunidade qualificada pode originar uma ou mais candidaturas sem confundir os dois processos.
- O pipeline conserva responsabilidades, tarefas, aprovações, documentos e transições.
- Indicadores são consistentes, rastreáveis e respeitam organização e unidade.
- A aplicação funciona integralmente sem IA ou custos variáveis de modelos externos.

## Questões em aberto

- Quais conectores entram no primeiro lançamento após validação técnica?
- Que tecnologia executará a fila de jobs e eventos no MVP?
- Que planos comerciais e limites operacionais serão aplicados?
- Que prazos de retenção, requisitos de residência e fontes cambiais serão aprovados por contrato?
