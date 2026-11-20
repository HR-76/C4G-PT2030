# Favicon C4G no login

Pedido de 15/11/2026: usar uma versão mini do logótipo C4G no separador de login.

## Aceitação

- Usar as letras verdes C4G do logótipo existente, sem o texto secundário.
- Disponibilizar `login/resources/img/favicon.ico`, consumido pelo template herdado do Keycloak 26.8.0, com fundo transparente e tamanhos de 16 a 256 px.
- Preservar os formulários e a configuração de autenticação.
- Verificar as dimensões e a composição do recurso. Aplicação na instância ativa depende da atualização do tema nesse ambiente.

## Resultado

Recurso criado e estrutura ICO validada: seis imagens PNG com as dimensões previstas. Confirmado o caminho no template oficial de login 26.8.0. Sem alterações de código executável. Instância ativa não atualizada: Docker não está disponível neste ambiente.
