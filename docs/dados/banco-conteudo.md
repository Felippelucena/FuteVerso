# Banco de Conteúdo

Este documento detalhará a estrutura do banco de conteúdo.

## Escopo inicial

- clubes;
- pessoas;
- estádios;
- competições;
- regras editáveis;
- pacotes de mods;
- metadados de validação.

## Decisão de formato

O conteúdo editável do FuteVerso deve ser baseado em arquivos estruturados.

JSON é o formato padrão para dados distribuídos e importados.

O banco de conteúdo, quando existir, não é a fonte primária de autoria. Ele deve funcionar como:

- cache compilado;
- índice de busca;
- resultado de conteúdo base mais mods aplicados;
- apoio para validações rápidas;
- apoio para o editor.

Todo conteúdo importado deve passar por validação estrutural e semântica antes de entrar em qualquer banco ou snapshot de campanha.

## Estrutura de arquivos

Estrutura inicial recomendada:

```text
content/
  base/
    manifest.json
    clubs/
      *.json
    people/
      *.json
    competitions/
      *.json
    rules/
      *.json
    media/
```

Pacotes de conteúdo devem declarar:

- id estável;
- nome;
- versão;
- versão mínima compatível do jogo;
- versão do schema de conteúdo;
- lista de entidades incluídas;
- dependências;
- hashes ou metadados suficientes para rastreabilidade.

## Regras editáveis

Esta decisão responde Q07.

Regras editáveis devem ser dados declarativos em arquivos JSON validados por schema. Elas não devem executar código arbitrário.

Quando uma regra precisar de comportamento complexo, o arquivo deve selecionar, parametrizar ou combinar regras já implementadas no domínio ou na aplicação. O conteúdo pode escolher parâmetros; o código do jogo continua sendo responsável por executar as regras.

Exemplos de regras editáveis:

- formato de competição;
- critérios de desempate;
- limites de inscrição;
- janelas de transferência;
- regras de elenco;
- pesos de geração de calendário;
- parâmetros de reputação, evolução e mercado.

## Conteúdo resolvido

Antes de criar uma campanha, o jogo deve gerar uma visão resolvida do conteúdo:

```text
conteúdo base
  + mods selecionados
  + edições locais
  -> validação
  -> conteúdo resolvido
  -> snapshot de campanha
```

Essa visão resolvida pode ser gravada em um banco ou cache, mas deve registrar origem, versão e hash dos pacotes aplicados.

## Questões relacionadas

- [Q07 - Formato das regras editáveis](../planejamento/questoes-em-aberto.md)
