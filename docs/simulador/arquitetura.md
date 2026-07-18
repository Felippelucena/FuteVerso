# Arquitetura do Simulador

Este documento detalha a arquitetura do simulador de partidas.

## Questões relacionadas

- [Q08 - Estrutura definitiva do simulador](../planejamento/questoes-em-aberto.md)

## Princípios iniciais

- O simulador deve ser uma fronteira clara do domínio.
- A execução deve ser reprodutível quando receber a mesma seed e os mesmos dados de entrada.
- O resultado deve emitir eventos consumíveis por outros módulos.
- A interface não deve conhecer detalhes internos da simulação.

## Objetivos principais

- resultados estatisticamente corretos;
- partida coerente;
- estatísticas ricas;
- rastreabilidade;
- reprodutibilidade;
- integração desacoplada com o restante do jogo.

## Modelo recomendado

```text
Perfil probabilístico
  ↓
Posses
  ↓
Sequências
  ↓
Ações
  ↓
Eventos canônicos
  ↓
Estatísticas, métricas e narração
```

As estatísticas devem ser derivadas dos eventos.

Evitar gerar separadamente números como:

- posse;
- chutes;
- passes;
- faltas;
- gols.

O placar deve emergir das finalizações.

As finalizações devem emergir das jogadas.

As jogadas devem emergir das posses.

