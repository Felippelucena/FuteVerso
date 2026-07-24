# Listas de nomes por país

Um arquivo JSON por país, nomeado com o código ISO 3166-1 alpha-2 em minúsculas
(`br.json`, `ar.json`, `pt.json`...). Basta soltar o arquivo nesta pasta: o carregador em
[`index.ts`](./index.ts) usa `import.meta.glob`, então nenhum código precisa ser alterado
para um país novo entrar no jogo.

## Formato

```json
{
  "country": "BR",
  "firstNames": ["Caio", "Bento"],
  "lastNames": ["Ribeiro", "Andrade"],
  "clubNames": {
    "cities": ["Salvador", "Curitiba"],
    "prefixes": ["Atlético", "Esporte Clube"],
    "suffixes": ["FC", "EC"]
  }
}
```

- `country` precisa bater com o nome do arquivo e ter exatamente duas letras.
- `firstNames` e `lastNames` são obrigatórios e não podem estar vazios.
- `clubNames` é opcional; sem ele, o gerador de clubes usa as listas de outros países.
- Arquivos malformados são ignorados com aviso no console, e não derrubam o jogo.

## País sem lista

Um jogador pode ter qualquer nacionalidade do catálogo em
[`../countries.ts`](../countries.ts), tenha ou não arquivo de nomes aqui. Quando não tem, o
gerador sorteia a partir da união de todas as listas disponíveis — o jogador nasce com o
país escolhido e um nome emprestado. Conforme você acrescenta arquivos, os nomes vão
ficando fiéis sem que nada mais mude.
