# Conteúdo e Campanha

Este documento define a separação entre conteúdo editável e estado da campanha.

## Diretriz central

A arquitetura deve separar claramente:

1. conteúdo editável;
2. estado da campanha.

## Conteúdo editável

O conteúdo representa o mundo inicial configurado pelo jogo, pelo usuário ou por mods.

Exemplos:

- jogadores;
- clubes;
- técnicos;
- auxiliares;
- estádios;
- cidades;
- países;
- competições;
- regras;
- mídias;
- atributos iniciais;
- históricos oficiais.

O conteúdo pode ser:

- criado;
- editado;
- importado;
- exportado;
- validado;
- sobrescrito por mods;
- versionado.

## Armazenamento do conteúdo

O conteúdo editável deve ser baseado em arquivos estruturados, com JSON como formato padrão. JSONC pode ser aceito em arquivos de autoria quando comentários forem úteis, desde que seja normalizado antes da validação.

Estrutura conceitual:

```text
content/
  base/
    manifest.json
    clubs/
    people/
    competitions/
    rules/
    media/

mods/
  pacote-exemplo/
    manifest.json
    clubs/
    people/
    competitions/
    rules/
    media/
```

Arquivos de conteúdo são a fonte de verdade para autoria, revisão, importação, exportação e mods. Bancos ou índices derivados podem existir para performance, mas devem ser reconstruíveis a partir dos arquivos e manifests.

## Estado da campanha

A campanha representa uma cópia independente do conteúdo inicial.

Depois de criada, ela segue seu próprio caminho.

Exemplos de alterações exclusivas da campanha:

- jogadores evoluem;
- jogadores envelhecem;
- contratos são assinados;
- transferências acontecem;
- clubes mudam financeiramente;
- novas temporadas são criadas;
- jogadores novos são gerados;
- competições produzem campeões;
- históricos são acumulados.

Alterações futuras no conteúdo editável, em caches de conteúdo ou em mods instalados não devem modificar automaticamente campanhas existentes.

## Armazenamentos separados

Sugestão inicial:

```text
content.db
campaign-<id>.db
```

`content.db`, quando existir, deve ser tratado como cache ou banco compilado de conteúdo resolvido. Ele não substitui os arquivos de conteúdo e mods como fonte de verdade.

O save da campanha deve ser autocontido.

A remoção ou alteração de um mod não deve inutilizar campanhas já criadas.

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
