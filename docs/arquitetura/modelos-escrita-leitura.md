# Modelos de Escrita e Leitura

Este documento define a separação entre modelos usados para regras e modelos usados para consulta.

## Diretriz

```text
Modelo de domínio
  otimizado para regras e consistência

Modelo de leitura
  otimizado para interface e consultas
```

Uma tela de clube pode combinar informações de:

- clube;
- contratos;
- elenco;
- lesões;
- partidas;
- classificação;
- finanças;
- histórico.

Isso deve ser feito por uma projeção de leitura, sem tornar `Clube` responsável por todos esses dados.

