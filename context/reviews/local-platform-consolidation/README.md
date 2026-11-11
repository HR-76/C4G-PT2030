# Consolidação local C4G — 2026-10-17

Contrato: [consolidação da instalação local](../../features/local-platform-consolidation.md). Ambiente de trabalho: **http://localhost:3000**; API 5000; PostgreSQL nativo 5432. Operação diária: [LOCAL.md](../../../LOCAL.md).

## Resultado e âmbito

A conta `hugo` passa a consultar o mesmo catálogo real e o Perfil da Organização que estavam a ser desenvolvidos na demonstração. O frontend já era partilhado: a divergência estava nas bases, nas seis permissões de diretório/estrutura que faltavam à membership nativa e na configuração da fonte/worker. A atualização foi aditiva, através do protocolo de autoridade central com versão esperada; preservou os oito grants anteriores, passwords, identidade, membership e política de MFA escolhida pelo utilizador.

O ambiente 5189 foi arquivado. API e worker antigos estão parados, assim como o contentor `c4g-catalog-demo`; volume, bases e candidatura sintética permanecem intactos. Os entrypoints antigos recusam arrancar perante o marcador privado de arquivo. O preview Vite antigo em 3100, confirmado como pertencente a este repositório e apontando à mesma API, também foi encerrado. A instalação nativa não consulta a antiga base como fallback.

## Dados transferidos e garantias

| Conteúdo | Resultado |
|---|---|
| Oportunidades públicas | 9; 4 com prazos atuais na data da verificação e 5 históricas |
| Revisões / proveniências / recibos de idempotência | 17 de cada, preservados |
| Recolhas / itens / observações | 4 / 18 / 18, sem nova recolha |
| Identidades externas da fonte | 9, conservando correções e referências |
| Auditoria de plataforma | 25 eventos, cadeia e hashes preservados |
| Sessões, credenciais, memberships e jobs da demonstração | Não transferidos |
| Candidatura sintética | Conservada apenas no arquivo de origem |

A autoria dos quatro pedidos históricos continua ligada ao UUID original. Foi criada apenas a referência histórica `ARCHIVED`, sem identidade OIDC, membership ou atribuição administrativa; não se atribuiu esse trabalho ao administrador nativo. Não se modificou a auditoria existente do destino.

`backend/scripts/localPlatform/catalogTransfer.js` transfere somente tabelas allowlisted, com origem/destino fixados, transação serializable, constraints ativas, comparação de conteúdo e recusa de destino divergente. O snapshot usa JSON PostgreSQL para conservar microssegundos. Foi executado primeiro com **ROLLBACK**, depois aplicado e repetido sem duplicação. O digest final continua igual ao snapshot original. Cópias/recibos privados: `.tmp/local-platform/consolidation` (não publicar).

O ensaio detetou que o proprietário NOLOGIN das tabelas Funding não tinha `USAGE` no schema e os checks de FK falhavam. Foi atribuída apenas essa permissão e corrigido o instalador nativo. O proprietário permanece **NOLOGIN / NOSUPERUSER**. Nenhuma constraint, proteção de auditoria ou fingerprint foi relaxada.

## Perfil preenchido e fontes

| Registo | Informação usada | Fonte e limite |
|---|---|---|
| Organização | C4G – Consulting and Training Network, Lda; tipo Empresa; descrição resumida; `suporte@c4g.pt`; website | [Sobre nós](https://www.c4g.pt/sobre-nos/) |
| Departamento de Formação | Unidade diretamente afeta à C4G | [Recrutamento](https://www.c4g.pt/recrutamento/), anúncio de 11-08-2025 |
| Gabinete de Projetos e Investimentos | Unidade diretamente afeta à C4G | [Sobre nós](https://www.c4g.pt/sobre-nos/), designação no marco de 2014 |
| Departamento Internacional | Unidade diretamente afeta à C4G | Designação no marco de 2019 da mesma página e [website internacional ativo](https://eu.c4g.pt/) |
| Hugo Romão | Contacto de projetos; email profissional publicado; afeto diretamente à organização | [Ficha oficial de parceiro](https://eu.c4g.pt/media/vv4flupn/pif_c4g.pdf), página 2 |

As três unidades formam uma estrutura inicial baseada em designações publicadas, **não um organograma atual validado pelo utilizador**. O campo de departamento na ficha de Hugo é ambíguo; não foi usado para inventar uma unidade nem para escolher a unidade principal. Não se inferiu que esta pessoa corresponde à identidade da conta `hugo`. Registar uma pessoa não cria conta nem acesso. Não se acrescentaram campos/funcionalidades para NIF, PIC, moradas ou telefone.

O preenchimento da ficha, unidades e pessoa passou pelos formulários reais e pelos serviços autenticados existentes. Ficaram dois recibos no diretório (ficha/pessoa) e três recibos de criação de unidades. Leituras posteriores confirmam persistência, revisão 1 da ficha e ausência de duplicados. A designação legal/tipo, campos de administração central, foram atualizados de forma condicionada a partir dos placeholders iniciais, com cópia anterior preservada.

## Verificação

- 30 testes backend focados: migração, conflitos, cadeia de auditoria, limites de worker, preservação de grants/MFA, fonte e diretório; PASS. O runner habitual encontrou `spawn EPERM` da sandbox; a execução com `--test-isolation=none` passou.
- 17 testes frontend de perfil, atalhos e catálogo; build Vite e sintaxe dos JavaScript alterados; PASS.
- Chrome com OIDC real: acessos admin/hugo, escrita autorizada no perfil, leitura persistida, nove oportunidades, quatro detalhes atuais, gestor recusado no ADMIN (403), header de outra organização recusado (409), candidaturas privadas consultáveis pelo gestor (200), ADMIN sem contexto privado (409); PASS. O botão de recolha foi consultado, nunca acionado.
- API/worker nativos prontos; pg-boss instalado na Central nativa, primeiro polling sem jobs bem-sucedido. Mesmo adaptador real e limite de cinco resultados, atualização apenas manual, sem scheduler. Não houve nova prova de recolha externa neste destino.
- [Verificação de base](database-verification.json): digest do catálogo idêntico, cadeias de auditoria tenant válidas, três unidades, uma pessoa, cinco recibos de escrita e zero jobs pendentes. Eventos de leitura/autenticação são os efeitos normais dos percursos.
- [Preenchimento](population.json): a última passagem registou duas escritas; as passagens anteriores já tinham guardado ficha/duas unidades. O teste consulta registos antes de criar e não sobrescreve conteúdo existente. A contagem conjunta é comprovada pelos cinco recibos na base.
- [Revisão final](verification.json): nova sessão admin/hugo, **zero escritas de negócio**, com o PostgreSQL da demonstração já parado; PASS. Capturas: [organização](organization.png), [móvel 390](organization-390.png), [unidades](units.png), [pessoas](people.png), [catálogo](catalog.png), detalhes [1](detail-1.png), [2](detail-2.png), [3](detail-3.png), [4](detail-4.png) e [ADMIN](admin.png). Capturas inspecionadas visualmente.

Referências de implementação: transferência/recusa de conflitos em `backend/scripts/localPlatform/catalogTransfer.js:52`; upgrade de grants em `backend/scripts/localPlatform/consolidate.js:44`; configuração nativa em `backend/scripts/localPlatform/runtime.js:29`; fronteira do worker em `backend/src/config/fundingTendersWorker.js:6`; permissão do proprietário em `backend/scripts/localPlatform/schema.js:103`; arquivo nos entrypoints `scripts/catalog-demo/start.ps1:5` e `scripts/catalog-demo/run.js:5`. Prova repetível, por defeito só de leitura: `node test/integration/local-platform/verifyNative.js`.

As primeiras execuções do harness foram interrompidas por falta de indicação de progresso, não por falha demonstrada da aplicação. A prova foi ajustada para esperar pelo conteúdo efetivamente utilizável, porque `networkidle` sozinho não garante que a fila de pedidos da UI terminou. As capturas móveis desativam animações durante a fotografia para não apanhar a transição do menu a meio.

## Limites e pendências

Confirmar a estrutura atual da empresa, a unidade principal de Hugo e as restantes pessoas não identificadas pelas fontes. Temas/publicação/matching conservam os gates anteriores e apresentam a indisponibilidade no perfil; não foram declarados operacionais por esta consolidação. A amostra Funding continua limitada e a instalação é de desenvolvimento, não produção. A migração guarda o histórico de negócio/auditoria; a linhagem técnica completa dos jobs antigos permanece na base arquivada.

Não houve commit, deploy, reset, remoção de dados, reescrita do frontend ou nova funcionalidade. O residual anterior foi preservado. O `git diff --check` global assinalou apenas linhas finais em ficheiros de provas F13 não alterados nesta tarefa; não foram limpas.
