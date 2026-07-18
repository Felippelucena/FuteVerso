# IDs e Referências

Este documento define como entidades são identificadas e referenciadas entre conteúdo, campanha e módulos.

## Decisão pendente

O esquema definitivo de IDs ainda está em aberto.

Ver questão [Q06](../planejamento/questoes-em-aberto.md).

## Princípios iniciais

- IDs de conteúdo devem ser estáveis o suficiente para suportar edição, mods e criação de campanhas.
- IDs de campanha devem identificar entidades vivas dentro de um save.
- Referências entre módulos devem apontar para contratos públicos, não para estruturas internas.
- Dados derivados não devem ser usados como identificadores.

## Perguntas a responder

1. IDs serão UUIDs, inteiros, slugs estáveis ou outro formato?
2. IDs de conteúdo e campanha terão namespaces separados?
3. Como mods poderão declarar, substituir ou estender entidades existentes?
4. Como conflitos entre pacotes serão detectados?
5. Como referências quebradas serão reportadas ao editor?

