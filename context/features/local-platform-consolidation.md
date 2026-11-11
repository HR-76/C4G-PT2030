# Consolidação da instalação local C4G

Estado: Review — implementação e verificação local concluídas em 2026-10-17. [Evidência](../reviews/local-platform-consolidation/README.md).

## Resultado

Uma instalação de trabalho em http://localhost:3000, com as contas nativas existentes, o catálogo real e a integração já construída, e o Perfil da Organização preenchido com informação publicada pela C4G. O ambiente 5189 fica preservado como arquivo, sem API/worker de escrita ativos. Não constitui migração para produção nem uma nova funcionalidade.

## Critérios de aceitação

1. Preservar identidades, passwords, memberships, MFA escolhido, dados privados e residual. Acrescentar apenas as permissões de diretório/estrutura já previstas para o gestor C4G, usando a autoridade central com controlo de versão.
2. Transferir as nove oportunidades públicas, revisões, proveniência e histórico das quatro recolhas para a Central nativa. Recusar destino divergente; preservar autoria histórica sem conceder acesso ao ator arquivado. Verificar transação com rollback antes da aplicação, integridade e repetição sem duplicação.
3. Ligar o worker existente à Central nativa com limites locais explícitos, recolha manual e sem disparar novas recolhas nesta tarefa. Confirmar prontidão da API/worker. Não migrar sessões, jobs pendentes nem a candidatura sintética do ambiente de demonstração.
4. Gravar descrição/contactos publicados, três unidades identificadas nas fontes oficiais e a pessoa nominalmente identificada na ficha pública. Não transformar serviços comerciais em departamentos, criar contas automaticamente ou inferir afetação ambígua. Conservar as fontes e lacunas na evidência.
5. Comprovar em Chrome os acessos nativos, catálogo/detalhes, leitura do perfil persistido, separação admin/gestor e apresentação móvel. Executar build, sintaxe e testes dirigidos de fronteiras/configuração/migração. Atualizar LOCAL.md para um único percurso diário.

## Execução delimitada

Inventariar e guardar recibo privado da transferência; preservar integralmente a origem. Transferir apenas tabelas públicas allowlisted numa transação, incluindo auditoria de plataforma se o respetivo destino estiver vazio e a cadeia for válida. O utilizador histórico fica sem identidades de autenticação, memberships ou privilégios. O estado privado permite retomar os passos independentes; um conflito interrompe a operação sem sobrescrever dados.

O preenchimento do diretório passa pelos serviços autenticados existentes. Fontes: https://www.c4g.pt/sobre-nos/, https://www.c4g.pt/recrutamento/, https://eu.c4g.pt/ e ficha ligada https://eu.c4g.pt/media/vv4flupn/pif_c4g.pdf. Hugo Romão consta como contacto de projetos; unidade principal por confirmar. A ficha não prova que seja a mesma identidade da conta local `hugo`, pelo que não se cria ligação implícita.

## Fora do recorte

Matching/editorial, Dashboard, novas fontes, coleta automática, documentos/e-mail de produção, reorganização do legado e eliminação de bases. A amostra de nove oportunidades não é cobertura integral de financiamento.
