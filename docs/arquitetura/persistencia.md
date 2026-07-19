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

O conteúdo editável e modável deve ter arquivos estruturados como fonte de verdade. Esses arquivos podem ser carregados, validados, combinados e compilados para caches ou bancos auxiliares, mas o formato primário de autoria, edição, distribuição e revisão deve continuar sendo baseado em arquivos.

Para conteúdo e mods, o formato padrão será JSON. JSONC pode ser aceito em arquivos de autoria quando comentários ajudarem o editor ou o modder, desde que o pipeline normalize e valide o conteúdo antes de aplicá-lo. Todo arquivo de conteúdo deve ser validado por schemas Zod ou mecanismo equivalente na fronteira de importação.

Para o runtime web/PWA, IndexedDB pode ser usado como armazenamento local, preferencialmente por meio de uma biblioteca como Dexie. Esse adaptador é adequado para protótipos, editor local, saves locais e uso offline no navegador.

Para a distribuição desktop Windows, SQLite é o armazenamento preferencial e deve ser tratado como alvo principal de campanhas longas. Em Tauri, o acesso deve ocorrer por adaptador de infraestrutura, usando o plugin SQL ou outra integração equivalente.

Para mobile futuro em Tauri, a preferência também é SQLite, desde que o suporte do runtime e dos plugins usados esteja adequado no momento da implementação. IndexedDB não deve ser a base principal de saves desktop ou mobile, mas pode continuar existindo como adaptador web.

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

## Fontes de verdade

As fontes de verdade devem ser separadas da seguinte forma:

| Área | Fonte de verdade | Observação |
| --- | --- | --- |
| Conteúdo base | Arquivos JSON/JSONC versionados junto ao jogo | Podem ser compilados para cache. |
| Mods | Pacotes de arquivos estruturados | Devem possuir manifesto e validação. |
| Conteúdo resolvido para nova campanha | Snapshot gerado após composição e validação | Deve registrar origem, versão e hash dos pacotes. |
| Campanha em andamento | SQLite | Deve ser autocontida e migrável. |
| Web/PWA experimental | IndexedDB | Adaptador secundário, não alvo principal. |

Um banco de conteúdo pode existir como índice, cache ou saída compilada para acelerar busca, validação e carregamento. Ele não deve substituir os arquivos de conteúdo como formato primário de autoria e distribuição de mods.

## Escrita e leitura

Operações de escrita devem respeitar a fronteira dos módulos.

Consultas de leitura podem combinar dados em projeções próprias, desde que não transformem projeções em fonte de verdade.
