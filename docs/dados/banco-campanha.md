# Banco de Campanha

Este documento detalhará a estrutura do banco de campanha.

## Escopo inicial

- snapshot inicial;
- estado vivo da campanha;
- histórico;
- agenda;
- resultados;
- contratos;
- evolução de jogadores;
- eventos persistidos.

## Princípio atual

Uma campanha não deve depender da versão editável atual do conteúdo para continuar funcionando.

## Decisão de armazenamento

SQLite é o armazenamento preferencial para campanhas.

No Windows desktop, SQLite deve ser tratado como alvo principal desde o início. Em Tauri, o acesso ao banco deve ocorrer por adaptador de infraestrutura, mantendo domínio e aplicação sem dependência direta do plugin ou da API nativa.

Em um runtime web/PWA, IndexedDB pode existir como adaptador secundário para protótipos, testes locais e uso offline no navegador. Esse adaptador deve implementar os mesmos contratos de aplicação quando cobrir os mesmos casos de uso.

Para mobile futuro, a preferência é manter SQLite também, evitando um modelo de save diferente apenas para Android ou iOS.

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

## Estrutura inicial

Sugestão de arquivo:

```text
saves/
  campaign-<id>.db
```

Sugestão de agrupamento lógico de tabelas:

```text
campaign_*
content_snapshot_*
world_*
people_*
clubs_*
competitions_*
market_*
development_*
matches_*
history_*
```

As tabelas podem evoluir, mas a fronteira entre módulos deve continuar clara. Consultas de leitura podem compor projeções, desde que essas projeções não substituam as fontes de verdade.
