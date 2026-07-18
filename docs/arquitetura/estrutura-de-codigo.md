# Estrutura de Código

Este documento descreve a estrutura inicial de código prevista para o projeto.

## Estrutura inicial

```text
src/
├── app/
│   ├── commands/
│   ├── queries/
│   ├── handlers/
│   └── bootstrap/
│
├── modules/
│   ├── content/
│   ├── campaign/
│   ├── world/
│   ├── people/
│   ├── clubs/
│   ├── competitions/
│   ├── market/
│   ├── development/
│   ├── matches/
│   ├── history/
│   └── media/
│
├── shared/
│   ├── domain/
│   ├── application/
│   └── infrastructure/
│
└── ui/
    ├── game/
    └── editor/
```

## Regra

Cada módulo deve expor apenas seu contrato público.

Detalhes internos, repositórios, schemas e entidades mutáveis não devem ser importados diretamente por outros módulos.

