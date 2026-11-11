# Lacunas de decisões arquiteturais — propostas para análise

Estado: **propostas, não aprovadas**. Este documento não altera os contratos aceites, não autoriza implementação ou implantação e não afirma que as opções aqui comparadas tenham sido historicamente consideradas. Responsáveis e datas de decisão estão por confirmar.

## Identidade e isolamento de dados

Escolha registada: [identidade global e base por organização](multi-tenant-identity-and-data.md), com [diretório e lifecycle](tenant-directory-and-lifecycle.md). Opções para documentar e comparar: base por organização (maior separação e recuperação por tenant; mais bases, migrações e pools); base partilhada com RLS (menos unidades de operação; maior dependência de políticas e risco de erro transversal); instalação inteiramente dedicada (maior isolamento físico; custo operacional maior). São consequências técnicas a validar, não reconstrução de motivos históricos.

Pendente: confirmar autores, critérios originais, custos, requisitos contratuais e eventual substituição de cláusulas históricas. Teste: revisão conjunta dos registos e comparação com o contrato corrente e gates de isolamento, sem inferir implantação real.

## Sessão e origem

Escolha registada: [cookie host-only e mesma origem](session-cookie-csrf-and-origin-policy.md). Comparar com frontend/API cross-site: esta opção pode exigir política CORS e cookies distintos, com maior complexidade de CSRF e dependência de comportamento do navegador. Teste: confirmar política de proxy, cookies e recusas cross-origin em ambiente de teste. Pendente: confirmar se esta alternativa foi historicamente avaliada e quais os critérios de mudança.

## Alojamento e fornecedores

A [decisão do MVP](hosting-and-external-services.md) identifica os serviços escolhidos. Alternativas para análise: serviços geridos versus operação própria; VPS partilhada versus implantação dedicada; armazenamento compatível S3 versus fornecedor específico. As comparações devem incluir custo, residência, isolamento, suporte, falhas comuns, portabilidade, testes de recuperação e custo de saída. Nenhum fornecedor alternativo é selecionado aqui. Pendente: confirmar as alternativas realmente avaliadas e os responsáveis; testar exercício de recuperação isolado e rever dependências por serviço.

## Privilégios centrais do leitor geral

Estado: sem contrato mínimo comprovado para todos os percursos. A [fixture HTTP](../../test/integration/http-oidc/fixture.js) usa `pg_read_all_data`; isto não demonstra os grants de produção. O leitor de catálogo tem [contrato próprio](central-catalog-reader.md) e não substitui o inventário do leitor geral.

Comparar: papel único de leitura com lista explícita de tabelas/colunas; papéis separados por capacidade; funções/projeções de leitura com interface fechada. Avaliar exposição de dados, segregação, manutenção de grants e compatibilidade operacional. Pendente: inventário real de queries, proprietário e plano de migração. Teste antes de qualquer ativação: PostgreSQL descartável com permissões positivas mínimas, recusa de escrita e de leituras não necessárias, revogação e percursos HTTP; nunca conceder privilégios à base habitual para o ensaio.

## Matching com paginação

Estado: **não escolhido nem implementado**. O [contrato](../features/audit-remediation.md) exige ordenação global, limites e revalidação de autoridade. Alternativas para avaliar: snapshot persistido com TTL e quotas (custo de escrita, retenção e limpeza); novo varrimento limitado por página (menor estado persistido, maior custo e necessidade de consistência verificável); materialização temporária em base de dados (transações, armazenamento e controlo de concorrência). Cache exclusivamente local não prova continuidade entre processos. A prova sintética existente não comprova snapshot consistente nem autorizações reais.

Pendente: escolher mecanismo e fronteira de consistência, limites e invalidação. Teste: mais de 1000 itens em PostgreSQL isolado, comparar concatenação com ordenação global, incluindo empates, alterações fora da página, revogação, adulteração e isolamento.

## Recuperação

Estado: RPO/RTO operacionais e fronteiras de medição por aprovar; [prova sintética](../reviews/threat-recovery-20261109-v2/results.json) não mede esses objetivos. Comparar restauração a partir de backups periódicos com recuperação pontual/WAL quando disponível, e estratégias de reconciliar metadados, objetos e eventos de auditoria. Custos, retenção, consistência e dependência de fornecedor devem ser explicitados. Pendente: responsáveis, objetivos, volumes e sequência de recuperação. Teste: exercício isolado com momento de perda conhecido, início e fim definidos, verificação funcional e reconciliação de objetos e auditoria. R2 real permanece para o final.
