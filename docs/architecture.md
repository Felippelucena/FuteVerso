# Arquitetura do FuteVerso

O projeto é um monólito modular. Cada módulo tem uma responsabilidade explícita e as dependências apontam para o domínio, nunca no sentido contrário.

## Módulos

```text
content ------------------┐
                         v
presentation --> application --> domain
                         ^          ^
                         |          |
infrastructure ----------┴----------┘
```

- `domain/shared`: tipos e operações sem dependência de outros módulos.
- `domain/roster`: jogadores, doze posições, atributos, memórias e nota geral.
- `domain/club`: clubes, identidade visual e plano tático padrão.
- `domain/contract`: vínculo jogador–clube e as consultas de elenco derivadas dele.
- `domain/tactics`: grade de slots, plano tático, formações, encaixe de posição e escalação automática.
- `domain/world`: agregado `World` (todo o conteúdo editável) e as regras que o mantêm coerente.
- `domain/match`: estado, regras, IA, runtime compartilhado e sistemas determinísticos da partida.
- `application`: sessão em execução, boot do mundo, casos de uso e portas externas.
- `content`: catálogo gerado — listas de nomes por país, países e geradores.
- `infrastructure`: adapters de armazenamento (IndexedDB e volátil).
- `presentation`: shell, telas DOM, loop do navegador, Canvas e formatação visual.
- `main.ts`: composition root que instancia e conecta os módulos.

## Regras de dependência

1. `domain` não importa `application`, `content`, `infrastructure`, `presentation` ou APIs do navegador.
2. O motor recebe somente `MatchConfig`; ele não conhece o perfil salvo nem sua origem.
3. `MatchSession` não conhece DOM, Canvas, relógio do navegador, storage ou repository.
4. `presentation` depende de `application`, tipos do domínio e renderer, mas não importa `infrastructure`.
5. `World` representa todo o conteúdo editável do jogo; o repositório é quem sabe como gravá-lo.
5a. Elenco nunca é armazenado: `Contract` é a única fonte da verdade e `squadOf` deriva o resto.
5b. O vocabulário tático (`BuildUpStyle`, `DefensiveBlock`, `PressTrigger`, `AttackChannel`) é declarado por `domain/tactics` e reexportado por `domain/match/model`.
6. Eventos de partida são dados estruturados. Somente presentation converte eventos em texto.
7. Aleatoriedade da simulação vem da semente de `MatchState`; não usar `Math.random()` dentro do domínio.
8. A ordem de execução e os valores do motor só mudam acompanhados de alteração explícita dos testes de caracterização.
9. Sistemas não importam `engine.ts` nem outros sistemas. Comportamentos compartilhados pertencem a `runtime`.

## Sessão e aplicação

`MatchSession` é o limite entre a simulação determinística e o tempo real. Ela possui o `MatchState`, pausa, velocidade e acumulador do fixed timestep. `advance(realDeltaSeconds)` limita o delta, aplica o multiplicador e executa no máximo 140 ticks por chamada.

`GameApplication` coordena `World`, `MatchSession` e a porta `WorldRepository`. Ela recebe o mundo já carregado por `bootstrapWorld`, monta a partida a partir de dois clubes e seus planos, persiste memórias e oferece os comandos de seed, aprendizado, escolha de clubes e CRUD de jogadores. Toda edição passa por `repairWorld`, então excluir um jogador escalado recompõe a escalação em vez de invalidá-la. Mudanças no catálogo são salvas imediatamente, mas uma partida em andamento só recebe o elenco novo quando reiniciada.

`bootstrapWorld` é o único ponto que decide entre continuar e começar do zero: lê o repositório e, se estiver vazio, gera um catálogo com `generateCatalog` e o grava.

## Apresentação

- `presentation/app/app-shell.ts`: estrutura global, cabeçalho e navegação entre telas.
- `presentation/app/animation-loop.ts`: `requestAnimationFrame`, renderização, atualizações periódicas e autosave.
- `presentation/match`: tela, configurações e view model da partida.
- `presentation/players`: tela, dialogs e view model do elenco.
- `presentation/canvas`: renderer do campo.

Cada tela consulta elementos apenas dentro do próprio container. Elementos globais pertencem ao shell. O loop acessa a aplicação para avançar e persistir a sessão, mas nenhum desses detalhes entra no domínio.

## Pipeline da partida

`engine.ts` apenas coordena o tick, nesta ordem: lifecycle, analytics, kickoff, posse preliminar, tática preliminar, cognição, movimento, colisões, limites do campo, ação controlada, física da bola, posse definitiva, colisão com a bola, tática definitiva, expiração de passe e encerramento.

Os sistemas ficam em `domain/match/systems`:

- lifecycle controla relógio, kickoff, efeitos temporários e encerramento;
- analytics acumula mapas e métricas espaciais;
- cognition renova e resolve planos da IA;
- movement atualiza deslocamento, energia e limites;
- collision resolve contatos entre entidades;
- possession controla disputa, domínio e confirmação da posse;
- ball executa ações, trajetória, gols e reinícios;
- tactics mantém a fase e um plano coletivo persistente com corredor, risco, bloco, gatilho de pressão e a incumbência de cada um dos onze (ver "Cadeia de decisão");
- runtime/prediction projeta bola e jogadores em horizontes curtos, sem avançar nem alterar o estado real da partida;
- tactics mede forma e fases coletivas.

`domain/match/runtime` contém somente primitivas compartilhadas de eventos, RNG, controle, aprendizado e métricas dos jogadores. Todo sistema recebe e muta `MatchState`; não há ECS ou estado duplicado.

## APIs públicas

O ponto de entrada público da partida é `domain/match/index.ts`:

- `createMatchState(config)` cria um estado isolado.
- `stepMatch(state, dt)` avança a simulação.
- `extractPlayerMemories(state)` devolve snapshots persistíveis das memórias.

Na camada application:

- `buildMatchConfig(profile, seedOverride?)` valida escalações e cria participantes isolados.
- `MatchSession` controla o ciclo de vida em tempo real da partida.
- `GameApplication` expõe os comandos consumidos pela apresentação.
- `SaveRepository` define a porta síncrona de persistência.

O adapter atual usa IndexedDB (banco `futeverso`), com uma store por entidade: `players`, `clubs`, `contracts`, `memories` e `settings`. O versionamento é o nativo do IndexedDB — subir `DATABASE_VERSION` dispara `onupgradeneeded`, que cria e migra stores; não há mais registro manual de migrações. `saveProgress` grava só memórias e configurações, para o autosave da partida não reescrever o catálogo inteiro. Sem IndexedDB disponível, `MemoryWorldRepository` mantém o jogo rodando sem persistir.

## Conteúdo gerado

`content/names/` guarda um JSON por país (`br.json`, `ar.json`...) com nomes e sobrenomes. O carregador usa `import.meta.glob`, então acrescentar um país é soltar o arquivo na pasta. País sem arquivo recebe nomes da união de todas as listas — a nacionalidade escolhida é preservada.

Os geradores encadeiam `generatePlayer` → `generateSquad` → `generateClub` → `generateCatalog`, todos determinísticos por semente e usando o RNG próprio de `content/generators/random.ts`. O RNG da partida não serve aqui: ele muta a semente do `MatchState`.

## Formato da partida

O time que o treinador escala é o time que entra em campo: onze contra onze. `buildMatchConfig` percorre os slots ocupados do plano e entrega a cada participante o `slotId`, o `positionFit` e a `instruction` já resolvidos — o motor nunca conhece `TeamTacticalPlan`. O motor não fixa o número de jogadores em lugar nenhum: os testes de comportamento rodam num fixture reduzido de cinco por lado, onde o cenário é legível, e caracterização e calibragem rodam no 11x11.

## Cadeia de decisão

Cinco níveis, do mais lento ao mais rápido, cada um alimentando o seguinte:

| Nível | Quem decide | Quando | Onde |
| --- | --- | --- | --- |
| 0 · Plano | treinador, fora da partida | nunca muda em jogo | `TeamTacticalPlan` |
| 1 · Momento | time | a cada tick | `updateTacticalContext` |
| 2 · Estratégia | time | a cada refresh do plano | `createCollectivePlan` |
| 3 · Incumbência | jogador | herdada do nível 2 | `buildAssignments` |
| 4 · Ação | jogador | a cada think tick | `carrierDecision`, `choosePass` |

O nível 3 é a entrega do coletivo para o individual. `buildAssignments`
(`systems/assignment-system.ts`) devolve um `PlayerAssignment` para **cada** jogador — dever,
célula da grade, alvo humano, liberdade e justificativa — sob duas invariantes travadas por
teste:

- **totalidade**: nenhum jogador fica sem dever, então ninguém cai num comportamento padrão em torno da âncora;
- **exclusividade**: duas incumbências nunca apontam para a mesma célula, que é a regra de ocupação do jogo posicional.

`supportTarget` e `defensiveTarget` **renderizam** a incumbência em alvo de corrida; não decidem
mais nada por conta própria. A âncora de cada um é a célula da grade, que desliza com o canal de
ataque, sobe com a fase e recua com o bloco — é isso que faz o time se mover como bloco. A
marcação é zonal por padrão (`holdLine`: respondo por quem entra na minha célula) e vira
individual (`trackRunner`) só onde o treinador pediu `marking: "man"`.

`runtime/formation-geometry.ts` é a única tradução entre a grade 7 x 5 do editor e o gramado, e
serve tanto ao plano coletivo quanto à decisão individual.

Ligar um botão novo do plano tático significa mudar **como a incumbência é escolhida**, não
passar mais um booleano por dentro de `ai.ts`. Jogadas ensaiadas entram, quando existirem
reinícios de jogo, como uma fonte de incumbência com prioridade sobre a normal.

## Evolução planejada

Novas telas devem consumir comandos e consultas de application. Os próximos marcos são a
recalibragem do 11x11 guiada por medição, os ajustes táticos ligados ao plano (mentalidade,
saída, bloco, gatilhos), a migração da interface para React e os editores de jogadores e clubes
— nenhum deles deve acoplar o motor ao armazenamento concreto.
