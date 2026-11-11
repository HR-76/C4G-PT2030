# Candidaturas — primeira fatia utilizável

**Estado:** Complete — fecho humano restrito aprovado em 2026-10-17. Âmbito entregue: criar a partir de oportunidade acessível, gerir responsável, prazo e estado, consultar detalhe e histórico. O contrato integral de `application-pipeline.md` continua futuro.

## Campos e origem

Identidade UUID da candidatura e organização resolvida no servidor; oportunidade privada F12 acessível e exata, sem exigir avaliação F14 ou qualificação. Uma oportunidade pode ter várias candidaturas. `evaluationId` é opcional e, quando presente, refere uma avaliação exata da mesma organização e oportunidade, sem afirmar elegibilidade. Na criação: título (1–200 caracteres), membership central ativa do responsável na organização, prazo obrigatório (data civil ISO), estado inicial **Intenção de candidatura**. O servidor guarda ator, instante UTC e revisão. Edição posterior permite título, responsável e prazo; associação F14 não muda silenciosamente. IDs, estado inicial, organização e autor nunca são aceites como autoridade do cliente.

## Estados e transições aprovados

Subconjunto das categorias semânticas aprovadas: **Intenção de candidatura → Em preparação**; de qualquer estado não terminal para **Cancelada** ou **Arquivada**. Cancelada/Arquivada são terminais nesta fatia. Transição exige revisão esperada e motivo 1–500 caracteres; cada mudança cria evento imutável com origem, destino, ator e instante. Não há configurador de pipeline nesta fatia. A escolha foi confirmada pelo utilizador.

## Acesso e integridade

Sessão server-side, membership central atual e grants explícitos de candidatura para leitura, criação, edição e transição; leitura da oportunidade cumulativa na criação e na consulta da ligação. Leitura de avaliação opcional é cumulativa. IDOR e A/B respondem indisponível uniforme. Responsável revalidado na fonte central no momento de criar/editar. Escritas com chave de idempotência, digest da intenção, CAS de revisão, auditoria F7 atómica e recuperação de resultado incerto; listagem paginada e ordenada de forma estável. Histórico append-only, sem apagar candidatura.

## Aceitação

- Criar manualmente sem F14 e criar com avaliação exata vinculada à mesma oportunidade; recusar avaliação de outra organização/oportunidade.
- Atribuir responsável elegível, título e prazo; recusar responsável externo, inativo ou sem membership atual.
- Listar e consultar detalhe, navegar oportunidade↔candidatura, editar com CAS, transitar e consultar histórico completo e paginado.
- Provar grants, IDOR e isolamento A/B, duplo envio, concorrência, auditoria e resultado incerto com PostgreSQL real.
- Completar percurso no browser e passar testes afetados e build.

## Excluído

Equipa alargada, tarefas detalhadas, documentos por etapa, aprovação interna, submissão externa, alertas, reporting avançado e configurador genérico. O estado da candidatura não é recomendação nem prova de elegibilidade. Sem migração automática da candidatura UBI nesta fatia.
