# Aleatoriedade e Reprodutibilidade

Este documento define como sistemas aleatórios devem ser tratados.

## Diretriz

Toda aleatoriedade deve passar por uma abstração comum.

```ts
interface RandomSource {
  float(): number
  integer(min: number, max: number): number
  weighted<T>(options: WeightedOption<T>[]): T
}
```

A campanha e as partidas devem registrar seeds.

## Objetivos

- repetir simulações;
- depurar;
- criar testes determinísticos;
- comparar versões;
- investigar resultados inesperados.

