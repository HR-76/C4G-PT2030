# Consolidação EU v2 e protocolo de desempenho

31/10/2026 — pedido do utilizador: consolidar a versão do escritor EU v2 e preparar o protocolo de medição de desempenho. Execução do [plano de recuperação e desempenho](../research/backend-test-recovery-performance-plan.md).

## Âmbito autorizado

Consolidar uma referência local verificável do código/pacote atual, reconciliar a evidência disponível, executar validações locais e entregar o protocolo concreto da medição futura. Preservar o escritor, SQL043, pacotes publicados, defaults e trabalho paralelo. A consolidação não representa ativação, deploy ou aprovação de desempenho.

## Entregáveis e critérios de aceitação

1. Manifesto da baseline com identidade derivada de hashes, versões de runtime/dependências, pacote043 e digest do pacote11145, SQL canónico e fingerprints. O inventário deve cobrir fontes concretas do writer/gate, testes e contratos relevantes; excluir segredos, configurações locais e dependências instaladas.
2. Cópia de fontes por allowlist para reprodução, com checksum e sem sobrescrever arquivos anteriores. Verificador local de leitura que recuse ficheiros alterados/ausentes, caminhos fora do workspace, pacote incoerente e arquivo divergente. A referência aprovada não é recalculada automaticamente ao verificar.
3. Validações focadas do writer, pacote e metadados, suites backend/frontend, build e sintaxe aplicável. Verificar hashes antes/depois e declarar qualquer prova física cujo inventário já não corresponda à baseline. Nenhum gate de infraestrutura é substituído pela suite local.
4. Matriz de evidência com cada requisito funcional/segurança relevante, prova/teste, correspondência de hashes e limites. Não marcar o escritor pronto para produção se a prova física continuar em curso ou não corresponder às fontes fixadas.
5. Protocolo de desempenho com ordem das fases, fontes/dados fixados, cargas, métricas, amostras, cálculo dos quantis, erros e critérios de validade/aceitação. Incluir a política de admissão C6 existente quando aplicável, sem inventar SLO HTTP nem definir uma otimização candidata ainda inexistente.
6. Identificar exatamente o que os harnesses históricos precisam de adaptar, os destinos novos e o âmbito operacional dos ensaios futuros. Nenhum comando de carga é apresentado como pronto quando faltam compatibilidade ou dados.
7. Revisão independente dos artefactos e documentação do trabalho ativo, preservando o histórico.

## Limites

Preparar o protocolo não executa carga, SQL, migrations, grants, contentores, suspensão de serviços ou acesso às bases habituais. A execução futura terá o âmbito isolado e autorização próprios previstos em `AGENTS.md`. O estado habitual042/034 e EU quiescente permanecem apenas a última evidência documentada; não é feita nova inspeção ou alteração habitual neste incremento.

Contrato fixado para a consolidação. Estado de execução e resultados em `context/current-work.md` e `context/reviews/eu-writer-baseline-performance.md`.
