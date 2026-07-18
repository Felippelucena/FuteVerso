# Tipos Compartilhados

Este documento define quais tipos podem viver na camada compartilhada.

## Diretriz

A camada compartilhada deve permanecer pequena.

Exemplos aceitáveis:

- `EntityId`;
- `Money`;
- `GameDate`;
- `DomainEvent`;
- `Result`;
- `RandomSource`.

Evitar transformar `shared` em um depósito de regras de negócio.

