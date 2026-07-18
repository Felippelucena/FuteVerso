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

## Diretriz atual

Versionamento formal deve ser implementado quando o jogo for lançado. Durante o desenvolvimento, mudanças internas podem evoluir sem compromisso de migração permanente.

> Versionamento deve ser implementado somente quando o jogo for lançado; mudanças durante o desenvolvimento não devem ser versionadas.

