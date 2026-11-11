GCNI — integração da alimentação no arranque habitual
Estado: integrado e arranque verificado em 02/11/2026. Validação autenticada pelo administrador real ainda por realizar.

APP: http://localhost:3000/catalogo/consulta
A API habitual responde em localhost:5000. Saúde 200; frontend 200; catálogo anónimo 401. O arranque usa um ponto de entrada explicitamente sem configuração de fontes. Não inicia o worker de recolha.

DADOS E ACESSO
178 oportunidades e 178 revisões persistidas: 177 do plano Portugal 2030 e 1 EU/Digital Europe. Mesma tabela e ficha; não é cobertura integral EU nem confirmação da publicação de avisos previstos. Fonte EU QUIESCED; zero funding_run. Não foram restaurados os 391 legados arquivados. Dados continuam PENDING_REVIEW.
Apenas o administrador de entidade que já tinha membership ativa foi selecionado. Nenhuma membership foi criada ou modificada. As restantes contas não entram na coorte. A autorização e admissão continuam verificadas por pedido.

JANELA CONTROLADA
Mantido o limite aprovado nos controlos existentes: cinco minutos por arranque admitido. Não existe renovação automática. A sessão do utilizador pode continuar válida depois de terminar a janela do catálogo. Reiniciar o arranque controlado exige nova admissão de destino, esquema, administrador e política; não herda acesso só por encontrar uma política aberta. Não se alargou o acesso a clientes.

IMPLEMENTAÇÃO APLICADA
046–048 instaladas pelo instalador registado; pacote de políticas PostgreSQL já ensaiado instalado separadamente, com hash registado. Quatro contas dedicadas e chave de assinatura guardadas numa pasta privada com permissões do utilizador e SYSTEM; valores não incluídos nesta entrega.
O arranque offline reutiliza a geração e os registos preservados. Identidade do cluster, base e administrador são verificadas antes da admissão. O arranque normal não configurado continua desligado. A composição mantém as rotas antigas e a nova consulta.

AUTORREVISÃO E CORREÇÕES
1. A base habitual recusa CONNECT por omissão. Corrigida a provisão com CONNECT apenas para as quatro contas dedicadas na base c4g_central_dev, sem ampliar permissões de dados.
2. O leitor antigo admitia o esquema048 mas não reconhecia as cinco permissões v2 que esse esquema conserva. Regressão reproduzida antes da correção. O esquema048 passa a usar exatamente o mesmo conjunto de SELECT v2; escrita e tabelas adicionais continuam recusadas.
3. Garantido fecho dos recursos da composição também quando o arranque falha.
4. O launcher controlado retira funding e opportunityEuWriter da configuração entregue ao arranque, sem apagar a configuração privada original. O launcher habitual não inicia o worker quando o modo é controlado.
Um diagnóstico de arranque genérico foi recusado pela revisão automática por receio de iniciar fontes. Foi substituído por verificação offline e pelo ponto de entrada explicitamente sem fontes, ambos posteriormente autorizados e executados. Não foi contornada a recusa.

VALIDAÇÃO
- 21 verificações ponta a ponta do novo arranque: PASS, com OIDC local, dados reais, apenas admin selecionado, reinício sem duplicações, recusa de deriva de permissões e revogação. Infraestrutura isolada removida.
- Backend final: 2535 PASS, 7 omitidos, zero falhas (2542 testes).
- Frontend: build PASS; 586 testes da interface previamente aprovados para os mesmos ficheiros, sem alterações nesta fase.
- Base habitual: 048; 178 oportunidades/revisões; fontes QUIESCED; zero recolhas; uma organização/ORG_ADMIN na política. Verificacao-habitual.json contém a observação exata.
- API e interface habituais arrancadas. Não usei nem pedi palavras-passe pessoais; a navegação autenticada com a conta real não foi efetuada. O ensaio OIDC local não prova uma federação externa.

BACKUP E REVERSÃO
Backup privado: .tmp\catalog-controlled-backup-d581248c-ee6b-4d6a-9e21-5120caa92733
Dump PostgreSQL e estado/configuração anterior preservados; índice do dump e SHA-256 verificados. Não foi feito restauro completo do dump real. SHA-256: 0294d6899548a5e5480db1a3648744c97a9f658b29e3f2615d85561f2fb1b741.
Para retirar imediatamente a exposição sem apagar dados nem iniciar fontes: executar o ficheiro desligar-catalogo.cjs desta pasta com node e o argumento --disable. O script usa somente a conta de operador, muda a política para OFF e preserva os bloqueios de gerações. Foi preparado e verificado sintaticamente; não foi executado após a abertura final. O reinício controlado é uma nova admissão e volta a abrir uma janela curta. Para impedir qualquer nova abertura, parar a API e manter a configuração sem arranque até revisão.
Não repor apenas o código045 sobre a base048. As migrações são preservadas; um restauro integral exige procedimento coordenado com a APP parada. Não há rollback destrutivo automático.

PRÓXIMO PASSO
Validar tabela e ficha com o login real do administrador da entidade e decidir a duração da janela para utilização habitual.
