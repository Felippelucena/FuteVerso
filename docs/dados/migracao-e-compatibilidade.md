# Migração e Compatibilidade

Este documento detalha a estratégia de migração, versionamento e compatibilidade.

## Escopo

- campanhas antigas;
- mudanças no banco de campanha;
- mudanças no banco de conteúdo;
- compatibilidade entre versões;
- validação antes e depois da migração.

## Itens versionáveis

Devem ser versionados separadamente:

- versão do jogo;
- versão do schema do conteúdo;
- versão do schema da campanha;
- versão do simulador;
- versão dos pacotes e mods.

Campanhas antigas devem utilizar migrações explícitas.

## Conteúdo e mods

Pacotes de conteúdo e mods devem declarar versão própria, versão mínima compatível do jogo e versão do schema de conteúdo.

O jogo deve registrar, ao criar uma campanha, quais pacotes participaram do conteúdo resolvido:

- id do pacote;
- versão;
- hash;
- ordem de carregamento;
- resultado da validação.

Esse registro não serve para recarregar automaticamente os mods atuais do disco. Ele serve para rastreabilidade, diagnóstico, exportação, compatibilidade e eventual migração explícita.

## Campanhas

Campanhas devem ser migradas a partir do próprio banco da campanha e do snapshot salvo nele. A ausência, remoção ou atualização de um mod instalado não deve impedir a abertura de uma campanha já criada.

Atualizar uma campanha existente para uma nova composição de conteúdo ou mods deve ser uma ação explícita do usuário, com validação antes da gravação e possibilidade de backup.

## Diretriz atual

Versionamento formal deve ser implementado quando o jogo for lançado. Durante o desenvolvimento, mudanças internas podem evoluir sem compromisso de migração permanente.

> Versionamento deve ser implementado somente quando o jogo for lançado; mudanças durante o desenvolvimento não devem ser versionadas.
