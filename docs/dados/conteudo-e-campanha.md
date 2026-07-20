# Conteúdo e Campanha

Este documento define a separação entre conteúdo editável e estado da campanha.

## Diretriz central

A arquitetura deve separar claramente:

1. conteúdo editável;
2. estado da campanha.

## Conteúdo editável

O conteúdo representa o mundo inicial configurado pelo jogo, pelo usuário ou por mods.


## Armazenamento do conteúdo

O conteúdo editável deve ser baseado em arquivos estruturados, com JSON e arquivos de midia (png, svg, webp).


Arquivos de conteúdo são a fonte de verdade para autoria, revisão, importação, exportação e mods. Bancos ou índices derivados podem existir para performance, mas devem ser reconstruíveis a partir dos arquivos e manifests.

## Estado da campanha

A campanha representa uma cópia independente do conteúdo inicial.

Depois de criada, ela segue seu próprio caminho.

Alterações futuras no conteúdo editável, em caches de conteúdo ou em mods instalados não devem modificar automaticamente campanhas existentes.

## Snapshot inicial da campanha

Ao iniciar uma nova campanha:

```text
Conteúdo base
  +
Mods selecionados
  +
Edições do usuário
  ↓
Conteúdo consolidado
  ↓
Validação
  ↓
Snapshot
  ↓
Inicialização da campanha
```

A campanha deve armazenar metadados como:

```ts
type MetadadosCampanha = {
  id: string
  nome: string
  dataInicial: string
  dataAtual: string

  versaoDoJogo: string
  versaoDoSchema: number

  pacotesDeOrigem: {
    id: string
    versao: string
    hash: string
  }[]

  seed: string
}
```

O snapshot deve preservar o suficiente do conteúdo resolvido para que a campanha continue funcionando mesmo que arquivos base, edições locais ou mods sejam alterados depois. Atualizar uma campanha existente para uma nova composição de conteúdo deve ser uma operação explícita, validada e migrável.
