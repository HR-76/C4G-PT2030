# Adesão de entidades — integração local

Estado: Review — integrado no ambiente habitual em 18/10/2026. Autorizado pelo utilizador.

## Âmbito e aceitação

Ligar os recortes A–D ao ambiente habitual: C4G inicia com nome/email, entrega ligação temporária, destinatário autentica no Keycloak, preenche a ficha portuguesa, submete e aguarda preparação automática. Sem registo público, email ou alteração de contas existentes. A ficha integra o perfil canónico; entidades anteriores não são bloqueadas nem têm contactos adotados automaticamente.

- Worker privado prepara tenants, projeções e ativação com fila durável, lease/fence e retoma; não expõe DDL nem segredos por HTTP.
- Resolvedor obtém apenas credenciais API limitadas para a ligação exata do diretório. Publicação durável antes de ativar, disponível após reinício e sem reiniciar a API para cada entidade.
- Criação posterior de utilizadores funciona também nas novas entidades. Mantém-se a autorização central e o percurso MEMBERSHIP.
- Ponte nativa distingue convites MEMBERSHIP/ADMISSION sem alterar passwords, MFA ou o login normal.
- Backup privado da base central, dados tenant e configuração relevante, com restauro descartável e comparação antes da migração 022–025. Preservar dados e histórico. Reversão desliga a composição nova; nunca elimina entidades criadas.
- Testes automatizados de resolvedor, worker e regressão dos percursos; prova PostgreSQL/Keycloak isolada. Build frontend e sintaxe backend. Revisão local desktop/mobile sem contas fictícias no ambiente habitual.

## Limites

Composição de desenvolvimento local; não é publicação em produção. Armazenamento, antivírus e email permanecem adiados. A criação de entidades reais depende de dados fornecidos pela C4G; demonstração com dados sintéticos ocorre apenas no ensaio descartável.

## Implementação e operação

`admissionWorker.js` executa a fila central a cada três segundos, num processo IPC supervisionado pela API. Provisionamento/projeção usam o adaptador PostgreSQL existente e reservas cifradas; a publicação verifica as ligações API/WORKER, a identidade física, a geração e o esquema antes da ativação. O resolvedor privado aceita apenas a combinação exata tenant/versão/referência e devolve à API apenas a credencial limitada API. Reiniciar o worker não requer reconfigurar nem reiniciar a API. Não existe endpoint HTTP de provisionamento ou de credenciais.

Composição habitual usa o mesmo coordenador de autoridade para sessão, ficha e submissão. A ponte Keycloak existente resolve os dois propósitos, com callbacks separados e os mesmos clientes; foram acrescentados apenas os redirect URIs necessários. Não foram alteradas passwords, MFA, recuperação ou registo público. O worker de utilizadores anterior mantém as entidades anteriores; novas entidades usam a projeção com credenciais publicadas.

Entidades e utilizadores apresenta «Novo convite» quando o servidor disponibiliza adesões. Revisão nome/email, criação, preparação da conta, emissão/substituição manual, consulta e cancelamento. Lista própria paginada com nome/email, criado em/por, estado e validade, com datas apresentadas no fuso de Lisboa. O URL conserva apenas o identificador do convite para retoma; a ligação secreta existe apenas na memória do ecrã. Entidades concluídas aparecem no diretório existente. A leitura da lista usa um adaptador interno, com autorização central C4G verificada antes e depois da consulta; não exige novas migrações nem alarga o protocolo de escrita.

O diagnóstico `/health/db` verifica a instalação local real (central e tenant) e identifica explicitamente o legado como não necessário. Os preflights de recolha e catálogo reconhecem 022–025 sem ignorar a verificação do esquema. Não foram iniciadas novas importações.

## Validação e evidência

- 57 testes backend focados PASS; 32 testes frontend PASS; build frontend e sintaxe dos ficheiros alterados PASS.
- Onze grupos PostgreSQL de adesão PASS, incluindo a nova lista paginada, total correto em página vazia, ausência de segredos, recusa de membros comuns e de autorização C4G revogada. [Resultado](../../output/playwright/c4g-admission/service-verification.json).
- Prova Keycloak/PostgreSQL/Chrome descartável com `member-real-gate.ps1 -SkipBuild -LocalCompletion`: worker habitual automático, publicação cifrada, reinício e entrada no perfil da nova entidade através do resolvedor dinâmico, sem recompor a API. Regressões de identidade, convites, isolamento, contas existentes, candidaturas e tarefas PASS. [Resultado](../../output/playwright/c4g-completion/local-worker-verification.json).
- `admissionSetup.js --apply`: backup privado central + tenant, configuração anterior e clientes Keycloak; restauro de ambas as bases em destinos temporários, comparação de fingerprints; migrações 022–025 e configuração aplicadas, contas/memberships/catálogo/dados tenant preservados. [Resultado, sem segredos](../../output/playwright/c4g-completion/local-upgrade.json).
- API e workers habituais ativos, `/api/local-health` e `/health/db` HTTP 200. Interrupção controlada do worker de adesões vazio seguida de recuperação automática, sem reiniciar a API: [prova](../../output/playwright/c4g-completion/local-supervision.json).
- Chrome habitual com OIDC existente, formulário e acessos anteriores em 1440/390, sem escritas de negócio: [resultado](../../output/playwright/c4g-completion/native-verification.json), [desktop](../../output/playwright/c4g-completion/native-invitation-1440.png), [móvel](../../output/playwright/c4g-completion/native-invitation-390.png). Capturas conferidas visualmente. Zero adesões reais e zero importações ativas no final.
- Revisão local de autorização, fronteiras de segredo, publicação/retoma e interface concluída. Corrigidas as duas verificações antigas de versão do catálogo e o diagnóstico que ainda exigia o legado desativado.

## Recuperação e limites de segurança locais

O caminho do backup está no relatório de instalação; conteúdo privado protegido por ACL do utilizador Windows e SYSTEM. Não copiar segredos para contexto ou logs. Para suspender esta funcionalidade, desativar `admissionAccess` na configuração privada e reiniciar a API; a interface deixa de oferecer convites e os registos existentes ficam preservados. As migrações são aditivas/irreversíveis: não fazer downgrade nem restaurar por cima de dados novos. Um restauro operacional exige comparar a atividade posterior ao backup.

O worker contém os novos adaptadores privilegiados e não tem listener HTTP. Esta composição local mantém os privilégios centrais preexistentes e o mesmo utilizador de sistema operativo; não constitui isolamento de segredos de produção. Novas entidades são assinaladas com residência LOCAL, sem alegar alojamento UE. A primeira adesão com dados reais será feita pela C4G, não foi criada uma entidade fictícia no ambiente habitual.

Próximo passo: rever com o utilizador o primeiro convite real em Entidades e utilizadores.
