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

Alterações futuras no banco de conteúdo não devem modificar automaticamente campanhas existentes.

## Bancos separados

Sugestão inicial:

```text
content.db
campaign-<id>.db
```

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

