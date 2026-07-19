# Sistema de Mods

Este documento detalhará a estratégia de mods do FuteVerso.

## Questões relacionadas

- [Q04 - Estratégia exata de mods](../planejamento/questoes-em-aberto.md)
- [Q05 - Resolução de conflitos entre pacotes](../planejamento/questoes-em-aberto.md)

## Perguntas respondidas

1. Mods substituem, estendem ou combinam entidades?
2. Como a ordem de carregamento é definida?
3. Como conflitos são detectados e apresentados ao usuário?
4. Como mods afetam campanhas já iniciadas?
5. Quais partes do jogo serão editáveis por mods?

## Decisão de estratégia

Estas decisões respondem Q04 e Q05.

Mods serão pacotes declarativos de dados. Um mod pode adicionar, substituir ou estender entidades do conteúdo base, mas não deve executar código arbitrário dentro do domínio.

O formato padrão de mod será um conjunto de arquivos estruturados. Para distribuição, um pacote `.fvmod` pode ser usado como convenção de empacotamento; internamente, ele deve ser tratável como um arquivo compactado contendo manifesto, dados e mídias.

No Windows, o jogo pode aceitar tanto pastas de mod quanto pacotes importáveis. Em mobile futuro, a estratégia preferencial deve ser importação de pacote, porque o acesso a pastas soltas é mais restrito.

Cada pacote deve possuir um manifesto com, no mínimo:

- id estável do pacote;
- nome;
- versão;
- autor ou origem;
- versão mínima compatível do jogo;
- dependências;
- conflitos declarados;
- lista de alterações;
- escopo de conteúdo alterado.

As alterações devem ser descritas em arquivos JSON/JSONC e validadas por schemas Zod antes de serem aplicadas. O carregador de mods deve produzir um conteúdo resolvido, validado e rastreável, sem alterar diretamente as fontes originais dos pacotes.

## Estrutura de pacote

Estrutura recomendada:

```text
meu-mod/
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

Distribuição compactada:

```text
meu-mod.fvmod
```

O editor pode exportar um pacote `.fvmod`, mas durante o desenvolvimento local o mesmo conteúdo pode ser mantido como pasta para facilitar versionamento, diff e revisão.

## Operações permitidas

A estratégia inicial permite três tipos de operação:

- `add`: adiciona uma nova entidade;
- `replace`: substitui uma entidade existente de forma explícita;
- `patch`: altera campos específicos de uma entidade existente.

Operações destrutivas, renomeações globais e migrações complexas devem ser tratadas como capacidades futuras, não como parte obrigatória da primeira versão.

## Ordem de carregamento

A ordem de carregamento deve ser determinística.

O carregador deve considerar, nesta ordem:

1. conteúdo base do jogo;
2. dependências obrigatórias dos mods;
3. ordem explícita definida pelo usuário;
4. desempate estável por id do pacote.

Se a ordem solicitada pelo usuário violar dependências declaradas, o pacote deve ser recusado ou reposicionado com aviso explícito, conforme a política final do editor.

## Resolução de conflitos

Conflitos devem ser detectados antes da criação ou continuação de campanha.

São conflitos, no mínimo:

- dois pacotes adicionando a mesma entidade com o mesmo id;
- dois pacotes substituindo a mesma entidade sem relação de dependência ou ordem explícita suficiente;
- um pacote alterando entidade inexistente;
- uma dependência ausente ou incompatível;
- uma referência quebrada após a composição final do conteúdo;
- uma violação de schema ou regra de integridade.

Conflitos não devem ser resolvidos de forma silenciosa. O editor deve apresentar relatório com pacote de origem, entidade afetada, operação, severidade e ação sugerida.

## Campanhas existentes

Uma campanha deve guardar snapshot ou referência resolvida do conteúdo usado na sua criação.

Alterações posteriores em mods instalados não devem modificar uma campanha existente automaticamente. Atualizar uma campanha para uma nova composição de mods deve ser uma operação explícita, validada e migrável.

## Conteúdo modável

A meta de design é permitir que todo conteúdo de jogo seja modável por dados, incluindo:

- clubes;
- pessoas;
- estádios;
- cidades;
- países;
- competições;
- regras parametrizáveis;
- mídias;
- atributos iniciais;
- históricos oficiais.

Essa abertura não significa permitir código arbitrário em mods. Comportamentos complexos devem ser expostos como regras, parâmetros, presets ou combinações suportadas pelo código oficial do jogo.
