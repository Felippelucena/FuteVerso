# Persistência

Este documento detalha a estratégia de persistência do FuteVerso.

## Escopo

- banco de conteúdo;
- banco de campanha;
- versionamento de saves;
- migração;
- compatibilidade;
- integridade referencial.

## Princípio atual

Conteúdo editável e estado de campanha devem ser persistidos separadamente.

Mesmo usando um único banco SQLite por campanha, a separação lógica por módulo deve ser mantida.

## Decisão de armazenamento

A aplicação deve depender de portas de persistência, não de um banco concreto.

Para o runtime web/PWA, IndexedDB pode ser usado como armazenamento local, preferencialmente por meio de uma biblioteca como Dexie. Esse adaptador é adequado para protótipos, editor local, saves locais e uso offline no navegador.

Para a distribuição desktop, SQLite é o armazenamento preferencial. Em Tauri, o acesso deve ocorrer por adaptador de infraestrutura, usando o plugin SQL ou outra integração equivalente.

IndexedDB e SQLite devem implementar os mesmos contratos de aplicação quando atenderem ao mesmo caso de uso. O domínio não deve importar APIs de IndexedDB, Dexie, SQLite, Tauri ou Electron.

Campanhas longas, histórico, migrações, exportação, importação e backups devem ser projetados considerando SQLite como alvo desktop principal.

Exemplo:

```text
campaign_*
world_*
people_*
clubs_*
competitions_*
market_*
development_*
matches_*
history_*
```

## Escrita e leitura

Operações de escrita devem respeitar a fronteira dos módulos.

Consultas de leitura podem combinar dados em projeções próprias, desde que não transformem projeções em fonte de verdade.
