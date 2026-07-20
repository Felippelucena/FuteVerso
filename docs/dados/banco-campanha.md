# Banco de Campanha

Este documento detalhará a estrutura do banco de campanha.

## Princípio atual

Uma campanha não deve depender da versão editável atual do conteúdo para continuar funcionando.

## Decisão de armazenamento

SQLite é o armazenamento preferencial para campanhas.


## Autocontenção do save

Cada campanha deve ser autocontida.

O banco da campanha deve armazenar:

- metadados da campanha;
- versão do jogo;
- versão do schema da campanha;
- seed;
- data atual;
- pacotes de origem aplicados na criação;
- snapshot ou cópia resolvida do conteúdo necessário;
- estado vivo dos módulos;
- histórico e eventos persistidos.

Alterações posteriores no conteúdo base, em mods instalados ou em edições locais não devem modificar uma campanha já iniciada automaticamente.
