# Correções da auditoria de qualidade

Estado: Review — primeiro incremento, 27/10/2026. Paginação integral, capacidade Matching e contrato RFC 9457 permanecem pendentes.

## Autorização e baseline

O utilizador aprovou avançar com as correções do relatório de qualidade, em incrementos pequenos e verificáveis. Branch `feat/f13-organizational-profile`; HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; worktree preexistente com 2531 entradas. Inventário inicial de 30908 ficheiros guardado fora do repositório em `%TEMP%/c4g-fixes-20261027-baseline.json`.

## Contrato e critérios de aceitação

1. Query inesperada no PUT de registo de entidade devolve 400/INVALID_INPUT antes de qualquer gravação.
2. A fronteira HTTP de oportunidades aceita apenas os códigos públicos existentes; exceções desconhecidas devolvem OPPORTUNITY_UNAVAILABLE/503, sem detalhes internos. Contratos válidos mantêm-se.
3. Exceções inesperadas nos ramos HTTP corrigidos são observadas de forma sanitizada, sem duplicar resposta nem permitir que a falha do observador substitua o erro original. Códigos e envelopes públicos existentes são preservados. A migração global para RFC 9457 requer um contrato de compatibilidade separado e não é introduzida implicitamente.
4. O diálogo de confirmação tem papel/nome acessíveis, foco inicial no cancelamento, navegação Tab/Shift+Tab contida, Escape para cancelar e restauro do foco. Confirmar/cancelar mantém o comportamento funcional.
5. Leituras do sino e Matching recebem AbortSignal, cancelam quando substituídas ou desmontadas e não publicam estado obsoleto. Escritas não são repetidas nem canceladas como se fossem leituras.
6. Health checks concorrentes partilham uma execução por dependência. Timeout sinaliza cancelamento; probes que o ignorem não originam execuções ilimitadas sobrepostas. Preservar resposta de readiness e permitir recuperação após a execução terminar.
7. Documentação de validação descreve as suites atualmente existentes e distingue gates com infraestrutura.
8. Otimizações de parceiros/alertas só avançam se mantiverem seleção, ordenação, totais, cursor, autorização, auditoria e erros públicos, sem novas migrations/grants. Medir contagens antes/depois em fixtures isoladas; não apresentar doubles como desempenho produtivo. Qualquer alteração necessária de contrato ou limitação de segurança é documentada antes de implementar.
9. Matching mantém motor determinístico e resultados completos dentro dos limites atuais. Alterar paginação/limites/respostas ou o seletor funcional exige um contrato adicional; não resolver por inferência.
10. Corrigir a fronteira de parceiros: exatamente 10000 candidatos é permitido; o candidato 10001 continua a recusar com LIMIT_EXCEEDED. A consulta adicional de esgotamento é limitada a uma linha; não autoriza nem materializa candidatos acima do limite. Preservar os cursores/digest, ordenação e totais atuais. A paginação SQL integral permanece separada: o cursor atual depende de um digest de todos os registos visíveis e a ordenação usa collation JavaScript, pelo que uma substituição SQL não é equivalente por construção.
11. Regressão de volume revelou limite indevido de 256 KiB na canonicalização da lista completa de parceiros. Calcular o mesmo SHA-256 incrementalmente, mantendo canonicalização/limites por registo e os mesmos bytes/digests para listas anteriormente aceites. Não aumentar limites dos comandos, envelopes ou do canonicalizador partilhado. Testar compatibilidade de cursores e listas acima de 256 KiB.

## Limites e validação

Não alterar migrations, grants/permissões, dados/configuração Dev, deploy, limites de autoridade ou SLO C6. Não fazer commit, merge ou push. Preservar todas as alterações anteriores.

Para cada incremento: teste de regressão primeiro (registar falha anterior), implementação mínima, testes focados e node --check dos JS backend alterados. Executar suites frontend/backend completas e build Vite no final; falhas preexistentes ficam separadas. Não iniciar serviços nem executar gates que alterem dados Dev. Ensaios com bases reais ficam fora desta fase sem uma fixture isolada explicitamente delimitada.

## Resultado

Primeiro incremento implementado: [resultado, testes, medições e limites](../reviews/code-quality-audit-corrections/README.md). 25 novos testes; frontend 346/346 e build PASS; backend 1314 PASS, mesmas três falhas anteriores e sete skips; sintaxe de 12 ficheiros PASS. Health: 20 probes → 1 para 20 leitores concorrentes. Parceiros: fronteira 10000 e digest corrigidos, sem afirmar paginação/capacidade produtiva. Autoridade, migrations, permissões e dados Dev preservados.
