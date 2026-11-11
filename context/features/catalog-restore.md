# GCNI — reposição da referência anterior a C1/C2
Estado: Complete nesta reposição. Reposição explicitamente autorizada; apenas laboratório.

Repor os quatro ficheiros de runtime da referência validada9dfce593bfaf409ca0bc087b78930460, após comparar hashes com as versões atuais. Preservar versões rejeitadas e testes como evidência explícita, sem confundir testes de candidatos arquivados com validação do serviço reposto. Não alterar migrations, referências, permissões ou fontes.

Regressão de reposição antes da alteração; testes de revogação, nova validação na mesma ligação, privilégios diretos e checkpoints após lock. Suites completas, build, gate PostgreSQL próprio e OIDC/carga de referência. Mesmos pools,200 medições/40 aquecimentos,27/10000,tabela/ficha,meta500ms. Validar a reposição é diferente de aprovar capacidade; a referência continuava acima da meta.

Autorrevisão, limpeza de recursos próprios e exposiçãoOFF. Sem promoção nem reativação de fontes. Impedir execução silenciosa do comparador antigo sobre um runtime diferente do candidato que avaliou.

## Resultado
Reposição PASS; funcional PASS; capacidade NOT_ACCEPTED. [Autorrevisão e resultados](../history/catalog-restore-2026-11-02.md).
Próximo passo: recolher um perfil de CPU e de esperas da referência reposta para localizar o custo dominante, antes de propor outra otimização.
