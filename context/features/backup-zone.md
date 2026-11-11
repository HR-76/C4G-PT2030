# Zona de backups

Estado: proposta em definição, não implementada. Pedido: uma zona inspirada no exemplo Metronic para o administrador da entidade consultar os backups realizados e para a administração C4G os consultar também.

## Proposta funcional

- Apresentar uma lista cronológica com data e hora, âmbito, estado e detalhes disponíveis de cada backup, utilizando os padrões visuais da aplicação e a tabela do exemplo Metronic como referência.
- O administrador da entidade consulta exclusivamente os registos da sua entidade; a administração C4G consulta os registos autorizados no âmbito da plataforma. O controlo deve ser imposto no servidor.
- Distinguir um backup concluído de um restauro efetivamente testado. Não apresentar dados fictícios nem inferir sucesso a partir da configuração do fornecedor.
- Mostrar estados de carregamento, lista vazia e erro; datas administrativas em Europe/Lisbon. A interface deve funcionar em ecrãs pequenos e com teclado.

## Decisões pendentes

- Origem dos registos e mecanismo que cria os backups; identificação e autenticação da fonte e evidência de conclusão.
- Âmbito dos dados protegidos: base da entidade, base central, documentos e outros objetos; apresentação dos componentes e respetiva consistência.
- Permissões exatas da administração C4G, detalhes visíveis e ações disponíveis para cada perfil. Consulta, criação e restauro são capacidades distintas.
- Frequência, retenção, RPO/RTO, monitorização e ensaios de restauro por classe contratual. As decisões de lifecycle existentes continuam aplicáveis.
- Migração e política para incorporar backups históricos pontuais, caso se pretenda incluí-los; a existência de ficheiros locais não comprova um serviço operacional contínuo.

## Critérios de aceitação propostos

1. As listas apresentam apenas registos reais e evidenciados, com estados e datas coerentes com a fonte.
2. Um administrador de uma entidade não consegue consultar backups de outra, incluindo por pedidos diretos à API; perfis sem autorização são recusados.
3. A administração C4G vê apenas o âmbito que lhe for autorizado; detalhes não expõem credenciais, caminhos internos ou ligações de infraestrutura.
4. Estados vazios e falhas são distinguíveis de backups concluídos; informação de restauro testado só aparece com prova correspondente.
5. A solução tem testes automatizados de autorização e isolamento entre entidades, testes dos estados da interface e build do frontend.

A implementação depende das decisões de origem e de capacidades acima. A referência visual não constitui autorização para disponibilizar os controlos de restauro ou sincronização apresentados na demonstração.

## Decisões do pedido — 10/11/2026

A origem será um serviço de backups ainda por definir. A primeira versão destina-se apenas à consulta do histórico pelos administradores; não inclui execução de backups nem pedidos ou execução de restauro. A integração não pode ser concluída enquanto não houver um serviço, contrato de dados e forma de verificar a identidade e a conclusão das operações. O serviço de backup e a política operacional não estão implementados pelo presente documento.

## Plano para implementação

1. Definir o serviço operacional, cobertura dos dados, retenção e forma de produzir evidência dos resultados, preservando as decisões de recuperação existentes.
2. Definir o contrato de ingestão e consulta de registos, com identificação da entidade verificada no servidor; prever falhas, duplicados e revogação de acesso.
3. Implementar autorização baseada na membership central para ORG_ADMIN e na autoridade C4G para C4G_ADMIN, com testes de isolamento entre entidades e de revogação.
4. Criar a navegação e a tabela de consulta nas duas áreas, sem ações de criação ou restauro; distinguir serviço indisponível de histórico vazio.
5. Validar testes automatizados e build, incluindo ecrãs estreitos e teclado, antes de ativar a ligação operacional.
