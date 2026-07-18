# Dependências Entre Módulos

Este documento define como os módulos do FuteVerso podem depender uns dos outros dentro do monólito modular.

## Regra geral

Um módulo pode depender de contratos públicos de outro módulo, mas não de suas tabelas, repositórios, entidades internas ou detalhes de implementação.

A comunicação entre módulos deve ocorrer por:

- comandos;
- consultas;
- eventos de domínio;
- tipos compartilhados explicitamente aprovados;
- contratos públicos documentados.

## Permitido

- importar contratos públicos;
- enviar comandos;
- executar consultas;
- reagir a eventos;
- utilizar IDs de outros módulos;
- utilizar tipos compartilhados realmente genéricos.

## Evitar

- importar schemas internos de banco;
- acessar repositórios de outros módulos diretamente;
- alterar estados de outros módulos;
- compartilhar entidades mutáveis;
- criar dependências circulares;
- concentrar lógica de vários domínios em serviços genéricos.

## Pendências

- Criar matriz de dependências permitidas.
- Definir dependências proibidas módulo a módulo.
- Definir política final para tipos compartilhados.
