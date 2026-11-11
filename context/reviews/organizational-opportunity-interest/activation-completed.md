# Ativação e recuperação — 30/10/2026

Estado: **ativado no ambiente habitual; verificação após retoma PASS**. Esta prova substitui o estado pendente dos relatórios anteriores, que permanecem como histórico.

Pedido explícito: ativar 031–033 e as permissões previstas, revalidando primeiro após a retoma. Critérios aplicados: confirmar o baseline e a autoridade, parar apenas a árvore habitual identificada, renovar backups protegidos e testar restauro isolado, preservar o ledger e dados, aplicar apenas o plano, comprovar replay sem efeitos e retomar API/worker/admissões.

## Resultado efetivo

- Revalidação, ausência de trabalho ativo e de sessões externas confirmadas na janela. Pausa iniciada às 22:23:55 UTC. Backups renovados e restauro isolado concluídos às 22:24:11 UTC, sem divergência; instância isolada encerrada. Proteção por ACL Windows restrita ao utilizador e SYSTEM, sem alegação de cifragem adicional.
- Tenant passou de 030 para `033_organizational_opportunity_interests`, com 031 e 032 intermédias; Central permaneceu 035. Diretório publicado em revisão 4. Fingerprint: `d3526c7287fade9a1009ce223be8d36769c38b9345f89e9c72180cb940c793bc`.
- Três permissões acrescentadas à única membership elegível presente (ORG_ADMIN), versão de autorização 5 → 6. Regras previstas para gestores, técnicos e consulta mantidas no plano; não foram criadas contas para esses perfis. Grants anteriores, membership, políticas e bindings preservados. Auditoria da concessão na mesma transação.
- Histórico de 30 migrações preservado exatamente. Dados tenant e catálogo Central preservados durante a aplicação; a atividade normal posterior da Central produz os seus registos habituais.
- Apenas o schema dos dois snapshots privados existentes foi atualizado. Configuração restante e credenciais comparadas com as cópias protegidas e preservadas. Nenhum serviço externo ou worker documental novo ativado.

## Retoma e correções verificadas

A primeira retoma falhou: a verificação de privilégios por nome de relação exigia acesso ao schema funcional pela identidade restrita da API. O relatório original da janela conserva o estado FAIL; não foi reescrito como sucesso. A consulta passou a usar OIDs do catálogo e a recusar resultados desconhecidos. O runtime foi retomado após a correção.

A prova HTTP/OIDC encontrou ainda quatro lacunas de integração: resolução da organização pelo middleware, transação com auditoria nas leituras de interesses, binding físico de autoridade do módulo e correspondência entre a leitura de unidades e as autorizações adicionais. Foram corrigidas com regressões RED → GREEN. As dependências adicionais são fechadas por operação, intenção e tipo de recurso; a igualdade de organização continua obrigatória. Incluem a verificação READ nas mutações e READ/MANAGE na conversão em candidatura, além da inclusão explícita do responsável na equipa. Diagnósticos temporários removidos.

Chrome com OIDC real: contexto, lista e unidades HTTP 200; três unidades disponíveis no modal; abertura do interesse sem abrir candidatura; lista carregada sem erro. Capturas 1440/390 e inspeção visual. A prova bloqueou escritas de negócio: nenhuma candidatura ou interesse de teste foi criado no ambiente habitual. Escritas funcionais continuam cobertas pelas regressões e pelos ensaios isolados anteriores; não se afirma um ensaio completo de escrita HTTP neste ambiente.

## Validação e evidência

- Backend: **1794 PASS / 1 FAIL preexistente / 7 SKIP** (1802 testes). Falha conhecida em `fundingEnrichmentPersistence.test.js:33`, alheia à ativação.
- Frontend: **461 PASS**; build PASS. Focos finais: 32 + 12 PASS; sintaxe dos ficheiros backend alterados PASS.
- Ensaio isolado de ativação: migrações, grants, replay, preservação, snapshots e metadados com identidade restrita PASS; cleanup confirmado.
- Verificação final READ ONLY: preflights, schema033/revisão4, grants exatos, ledger histórico, metadados restritos, configuração e credenciais, zero registos de negócio de teste e saúde API/worker/admissões PASS.

Artefactos locais (sem segredos): `output/organizational-opportunity-interest/activation-rehearsal.json`, `window-bbdac3c4-00e1-4c4c-a54a-f302f938077b.json`, `backup-restore-e2cfb8b8-dc35-4d24-a89f-3d15f5be252b.json`, `activation-recovery.json`, `live/verification.json` e logs `*-activation-complete.log` na mesma pasta. Backups protegidos: `.tmp/local-platform/interest-backup-e2cfb8b8-dc35-4d24-a89f-3d15f5be252b/`.

Próximo passo: revisão funcional pelo utilizador do primeiro interesse real e da sua associação às unidades.
