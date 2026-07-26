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
- `domain/world`: forma serializada `World` (todo o conteúdo editável) e as regras que o mantêm coerente.
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
5. `World` é a forma serializada inteira do conteúdo editável — geração, import/export e testes. Ele **não** é o estado de execução: o catálogo mora no `Catalog` e é consultado sob demanda, porque um mundo construído pelo usuário não cabe em memória por princípio.
5a. Elenco nunca é armazenado: `Contract` é a única fonte da verdade e `squadOf` deriva o resto.
5c. Campo derivado (`overall`, `sortName`) existe só para o índice, é escrito exclusivamente pelo adapter e nunca volta na leitura — o domínio segue dono da fórmula.
5d. Um filtro por consulta. O IndexedDB não cruza índices, e prometer o contrário produziria paginação com total errado.
5b. O vocabulário tático (`BuildUpStyle`, `DefensiveBlock`, `PressTrigger`, `AttackChannel`) é declarado por `domain/tactics` e reexportado por `domain/match/model`.
6. Eventos de partida são dados estruturados. Somente presentation converte eventos em texto.
7. Aleatoriedade da simulação vem da semente de `MatchState`; não usar `Math.random()` dentro do domínio.
8. A ordem de execução e os valores do motor só mudam acompanhados de alteração explícita dos testes de caracterização.
9. Sistemas não importam `engine.ts` nem outros sistemas. Comportamentos compartilhados pertencem a `runtime`.

## Sessão e aplicação

`MatchSession` é o limite entre a simulação determinística e o tempo real. Ela possui o `MatchState`, pausa, velocidade e acumulador do fixed timestep. `advance(realDeltaSeconds)` limita o delta, aplica o multiplicador e executa no máximo 140 ticks por chamada.

`GameApplication` coordena `MatchSession` e a porta `Catalog`. Ela recebe as configurações já resolvidas por `bootstrapCatalog`, persiste memórias e oferece os comandos de seed, aprendizado, escolha de clubes e edição de jogadores, clubes e contratos. Mudanças são gravadas imediatamente, mas uma partida em andamento só recebe o elenco novo quando reiniciada.

**Integridade incremental.** Cada comando repara só o seu raio de alcance, e o raio de uma edição de jogador é o clube a que ele está vinculado — no máximo um, porque um plano só escala quem está no próprio elenco. `repairWorld` continua valendo onde uma incoerência entra de uma vez (mundo recém-gerado ou importado); no caminho da edição ele seria O(clubes × jogadores) e não sobrevive a um catálogo grande. `inspectWorld` é diagnóstico global sob demanda, nunca automático.

A apresentação recebe `queries: ReadonlyCatalog` — lê à vontade, mas gravar é privilégio dos comandos, que são quem mantém a integridade. O tipo impede o atalho.

A partida **não** nasce com a aplicação: `match` é `MatchSession | null`, e num ambiente de edição o catálogo pode nem ter dois clubes. `startMatch(setup)` a põe em campo, `leaveMatch()` a congela (segue viva e retomável enquanto a aba existir) e `endMatch()` a descarta. `requireMatch()` é para as telas que só existem dentro de uma partida; quem pode viver sem ela usa `match` e trata o `null`.

**Clube contra ele mesmo** é permitido — é como se testa um plano contra outro sem trocar o elenco.
O motor identifica quem está em campo pelo id do perfil, então os dois lados não podem ser os
mesmos onze ids: o visitante entra com **cópias** (`match/mirror-side.ts`), os mesmos atletas com
identidade própria nesta partida. Elas herdam a memória do original e aprendem, mas o que aprendem
não volta ao catálogo — seriam duas memórias para o mesmo atleta e o desempate ficaria por conta da
ordem de gravação. O `currentSetup` guarda os planos **do contexto**, não os que entraram, para que
a tela e o ajuste em jogo falem com os ids que estão realmente em campo.

**Ajuste com a bola rolando.** `adjustPlan(team, plan)` leva ao motor o que o treinador grita da
beira: diretrizes e instruções valem na hora, e os onze podem trocar de posição entre si. Quem
entra e quem sai, não — isso é substituição, ainda inexistente, e o comando recusa com
`lineup-locked` em vez de aplicar pela metade. `buildTeamAdjustment` é a mesma tradução de
`buildMatchConfig` sem o que exigiria refazer os participantes (perfil, memória, camisa), e
`applyTeamAdjustment` (domain) recalcula o que o slot decide sobre o atleta: âncora de
recomposição e encaixe. O plano coletivo em cache é descartado — ele foi decidido sob as
diretrizes antigas.

`MatchSession.adjust` reancora a visão ao vivo (ordem é para agora) e **abre um keyframe**. Isso
não é zelo: reconstruir o passado re-simula a partir do keyframe anterior, e isso só reproduz a
história enquanto o trecho entre dois keyframes for função pura do primeiro. Mudar o plano quebra
essa pureza; o keyframe novo a restabelece. Vale para qualquer coisa que altere o curso do jogo
fora do `stepMatch`.

`bootstrapCatalog` é o único ponto que decide entre continuar e começar do zero: lê as configurações e, se o banco estiver vazio, gera um catálogo com `generateCatalog`, o repara e o grava.

`Catalog` expõe quatro `Store<T>` iguais — jogadores, clubes, contratos e memórias — com `page`, `get`, `getMany`, `put` e `remove`. É a mesma interface que a tabela do editor consome, então acrescentar Estádio é acrescentar um store, não um caminho novo. A semântica de paginação (filtro, ordenação, desempate pela chave primária) vive num lugar só, em `infrastructure/persistence/paging.ts`, e os dois adapters são comparados diretamente por teste: divergência aqui é do tipo que passa despercebida — uma linha que some entre duas páginas.

## Apresentação

- `presentation/app/html.ts`: tag template `html` que escapa por padrão. Único dono do escape.
- `presentation/app/dom.ts`: `render` (único ponto que escreve `innerHTML`), `find`, `findAll`.
- `presentation/app/icons.ts`: mapa de ícones e `icon(name)` tipado, serializado como SVG inline.
- `presentation/app/section.ts`: trecho reconstruído só quando muda a assinatura das entradas.
- `presentation/app/screen.ts`: contratos `Screen`, `ScreenContext`, `ScreenDefinition`, `Route`, `Navigation`.
- `presentation/app/navigator.ts`: pilha de rotas, layout, trilha e diálogos, a partir de uma lista de telas.
- `presentation/app/animation-loop.ts`: `requestAnimationFrame`, status da sessão e autosave.
- `presentation/menu`: menu inicial.
- `presentation/quick-game`: seleção de clubes e plano tático do fluxo de Jogo Rápido.
- `presentation/tactics`: editor de plano tático, compartilhado pelo clube, pelo jogo rápido e pela partida.
- `presentation/editor`: tabela, modal e os descritores de entidade.
- `presentation/match`: tela, cabeçalho, roster, mapa tático e view model da partida.
- `presentation/canvas`: renderer do campo.

## Editor

Uma entidade editável é um **descritor** (`presentation/editor/entity.ts`): colunas da lista,
abas do modal, como carregar uma página, como abrir um rascunho e os comandos de salvar e
excluir. `DataTable` e `EntityModal` não conhecem entidade nenhuma, então acrescentar Estádio ou
Competição é acrescentar um arquivo em `editor/entities` e uma linha na lista de descritores.

O modal trabalha sobre um **rascunho** — cópia da entidade —, e só o Salvar comita. Para o clube
o rascunho é um agregado (`{ club, contracts, squad }`), porque a aba de elenco edita vínculos:
Cancelar descarta os três juntos e Salvar comita numa transação só. Todos os painéis são
montados de uma vez e os inativos ficam escondidos — trocar de aba não pode custar o que já foi
digitado.

`bind` recebe o rascunho como **função**, não como valor: ele roda na montagem, antes de existir
rascunho, e os handlers que pendura disparam depois. Um getter resolveria igual até alguém
desestruturar o contexto e capturar `null` sem perceber.

`render` é **opcional** na aba. A regra: a aba comum é repintada a partir do rascunho; a aba que
hospeda um componente próprio — a Tática do clube — entrega o painel a ele e se pinta em
`activate`. Repintar por cima arrancaria o componente e os eventos dele. `activate` existe para a
aba cujo conteúdo depende do que outra editou: dispensar um jogador no Elenco tem de aparecer na
Tática, e enquanto escondida ela não é montada.

Coluna só ordena se tiver campo indexado. Camisa e clube não têm — vêm do contrato, e o banco
não cruza índices. Idade ordena por `birthYear` com a direção invertida, porque idade cresce
quando o ano de nascimento diminui.

## Editor de plano tático

`presentation/tactics/plan-editor.ts` é um componente só, usado em **três** lugares: a aba Tática
do clube, o passo do Jogo Rápido e o diálogo da partida em andamento. Ele não sabe qual dos três o
hospeda — tudo que muda entre eles cabe em `PlanEditorSource`: de onde vem o plano, para onde vai a
mudança e se o banco está travado. É essa terceira condição que impede o componente de nascer
acoplado a um formulário com Salvar: na beira do gramado não existe Salvar, e o mesmo `changed`
serve para guardar num rascunho ou aplicar no motor na hora.

O campo é a grade 7x5 de `TACTICAL_GRID` sobre o gramado desenhado, com o próprio gol à esquerda —
a orientação da partida. Ele respeita a **proporção oficial** (`PITCH_RATIO`, derivada de `FIELD`)
em vez de esticar até onde a tela deixar: um campo deformado ensina uma distância que não existe.
Quando a altura é o limite, é a largura que cede.

As marcações vêm de `canvas/pitch-markings.ts`, que descreve os riscos em coordenadas de campo — a
**descrição**, não o desenho. O canvas da partida e o SVG do editor leem a mesma lista e só decidem
como pintá-la; é isso que impede os dois de divergirem, em vez de um comentário pedindo que sejam
mantidos iguais.

O arrasto é por **Pointer Events**, sem biblioteca e sem HTML5 DnD, que não funciona no toque;
mover e soltar são ouvidos na `window`, porque o dedo sai da caixa do editor o tempo todo durante
um arrasto.

**Uma regra só para todo movimento:** quem chega ocupa o destino, e quem estava lá vai para a
origem de quem chegou. Campo com campo é troca de posição; campo com lista é entrada e saída da
escalação; "disponível" é a ausência de vínculo, e não uma lista guardada no plano. Não há caso
particular por par de listas. Durante o arrasto cada slot mostra o encaixe daquele jogador ali
(`positionFit`) e `blocked` recusa a soltura — a regra já existia, a tela só a torna visível antes
de o treinador soltar.

`formationId` não é digitado: sai de `matchFormation`, que devolve o preset cujo conjunto de slots
é exatamente o atual. Voltou ao desenho de um preset, volta a ter o nome dele; saiu, vira
personalizada. `applyFormation` troca o desenho **preservando quem joga** — reescalar do zero é o
outro botão (`autoPickPlan`).

Cada tela consulta elementos apenas dentro do próprio container. Uma tela nova é um
`ScreenDefinition` — um arquivo e uma linha em `main.ts`; o navegador não conhece nenhuma pelo nome,
nem importa nada do domínio.

A navegação é uma **pilha**, não um conjunto de abas: o jogo tem profundidade (menu → clubes → plano
→ partida) e voltar significa subir um nível. Telas são montadas na primeira visita e descartadas ao
sair da pilha — o que precisa sobreviver a sair de cena, a partida, vive na aplicação e não na tela.
`suspend()` é o gancho de quem tem processo vivo. Cada definição declara seu `chrome`: só a partida
pede o placar no topo, as demais mostram a trilha.

O laço avança a sessão quando ela existe, atualiza o status no topo e chama a tela ativa: `frame()`
por quadro, `tick()` no ritmo da interface. Painel escondido não é montado, e o que muda a cada tique
é escrito no lugar, nunca reconstruído.

## Pipeline da partida

`engine.ts` apenas coordena o tick, nesta ordem: lifecycle (relógio, acréscimos e intervalo), analytics, gate de impedimento (congela e reinicia), posse preliminar, tática preliminar, cognição, movimento, colisões, limites do campo, avanço da bola parada (entrega a posse ao cobrador quando ele chega ao ponto), ação controlada, física da bola, posse definitiva, colisão com a bola, tática definitiva, expiração de passe, restrição do reinício e encerramento.

A bola parada não é uma parada como o impedimento: é uma **fase viva restrita**. Em vez de congelar e teleportar (o antigo `setupKickoff`/`restartPlay`), o motor põe a bola no ponto, deixa os jogadores caminharem até o desenho do reinício e só entrega a posse — e o jogo volta a correr — quando o cobrador chega. Toda a mecânica vive em `runtime/restart`; `ball` e `lifecycle` só a disparam.

Os sistemas ficam em `domain/match/systems`:

- lifecycle controla relógio, tempos (Regra 7: dois de `HALF_DURATION`, com nova saída de bola no intervalo), acréscimos (o tempo de bola morta volta como tempo adicional) e o encerramento com contexto (o apito espera a próxima bola morta ou o fim do lance);
- runtime/restart guarda toda a bola parada: escolhe o cobrador, põe a bola no ponto, dá o alvo de caminhada de cada um (a fonte de incumbência do reinício), entrega a posse quando o cobrador chega e mantém a Regra 8 (bola parada até o primeiro toque, sem toque duplo do cobrador — o que obriga o primeiro toque a ser um passe);
- runtime/kickoff guarda só a agenda dos tempos (quem cobra a saída de cada tempo, qual é o último); runtime/dead-ball responde "a bola está morta?", o predicado que a bola parada e os acréscimos compartilham;
- runtime/offside guarda a geometria pura da Lei 11 (linha do penúltimo adversário, quem está impedido no instante do passe). A aplicação se reparte: ball-system arma a vigilância no passe, possession-system apita quando um vigiado toca a bola, lifecycle congela a jogada (a "bandeira") e reinicia com tiro livre indireto. O passador evita receptores impedidos (ai.ts/choosePass) — é esse o pente que deixa o impedimento "de vez em quando" em vez de a cada passe;
- analytics acumula mapas e métricas espaciais;
- cognition renova e resolve planos da IA;
- movement atualiza deslocamento, energia e limites;
- collision resolve contatos entre entidades;
- possession controla disputa, domínio e confirmação da posse;
- ball executa ações, trajetória e gols, e detecta a saída de bola (delegando o reinício a `runtime/restart`);
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
mais nada por conta própria. A marcação é zonal por padrão (`holdLine`: respondo por quem entra na
minha célula) e vira individual (`trackRunner`) só onde o treinador pediu `marking: "man"`.

### O que o plano manda no motor

`MatchConfig.teams` carrega as **diretrizes** de cada lado (`TeamDirectives`): mentalidade, estilo
de saída, bloco defensivo e gatilhos de pressão. Elas ficam em `state.tactics[team].directives` e
não mudam durante a partida. O que é por jogador (`PlayerInstruction`) viaja junto de cada
participante — o motor nunca vê um `TeamTacticalPlan`.

Três regras uniformes governam a ponte, e é delas que sai a garantia de que **um plano neutro
produz exatamente a partida que o motor produzia antes de existir plano**:

- **estilos** — `auto` é o que o motor calcula sozinho (`chooseBuildUpStyle`, `chooseDefensiveBlock`); qualquer outro valor sobrepõe. Sem caso especial de permeio.
- **gatilhos** — a situação **propõe** um gatilho e o plano diz se ele vale. Gatilho desabilitado não cai para o seguinte: aquela situação simplesmente não dispara a nossa pressão, e ninguém recebe o dever `press`. Lista vazia é o time que nunca sai para a bola.
- **mentalidade** — cada eixo entra como viés em **um único ponto**, e `mentalityBias(50)` vale exatamente zero. A magnitude de cada extremo está em `MENTALITY` (`domain/match/config.ts`).

| Eixo | Ponto único | O que move |
| --- | --- | --- |
| `defensiveLine` | `lineHeightFor` | sobe ou desce a linha mais recuada, com e sem a bola |
| `width` | `teamWidthFor` | abre ou fecha a forma |
| `pressing` | `chooseSecondPresser` | até que altura do campo o 2º homem ainda sai da linha |
| `tempo` | `carrierDecision` | o tempo de acomodação antes de o portador considerar o passe |
| `risk` | `createCollectivePlan` | `collectivePlan.risk`, que rest defense, sobreposição e apetite de passe já leem |

`shootFreedom` e `dribbleFreedom` entram por uma tabela só (`FREEDOM_APPETITE`), somada às
utilidades de chute e de drible; `normal` vale zero, como o neutro da mentalidade.

Quem guarda a garantia é [characterization.test.ts](../src/domain/match/characterization.test.ts),
que mede o fingerprint da partida de referência — e ela entra com diretrizes neutras. É gated por
`CALIBRATE=1`: se um dos hashes mudar sem que o motor tenha mudado, um eixo vazou para o meio da
régua. Que cada controle **chegue** ao jogo é assunto de
[tactical-plan.test.ts](../src/domain/match/tactical-plan.test.ts), na suíte normal.

## Forma e colocação

`runtime/formation-geometry.ts` é a única tradução entre a grade 7 x 5 do editor e o gramado, e
separa duas coisas:

- **forma** — a distância relativa entre as linhas, desenhada na escalação. Não muda em jogo.
- **colocação** (`TeamShapePlacement`) — onde essa forma está agora: `lineHeight` (profundidade da
  linha mais recuada), `width` (quanto o time abre), `depth` (quanto encurta a distância entre as
  linhas) e `forwardLimit` (até onde pode avançar).

A colocação sai da posição da bola e é recalculada **a cada tick**, fora do cache do plano
coletivo: quem faz o quê muda devagar, onde o time está não pode. Com a bola a referência é a
retaguarda (a última linha fica uma folga atrás da bola); sem a bola é a frente (a primeira linha
de pressão fica junto da bola e a forma se estende para trás, entre a bola e o próprio gol).

`forwardLimit` é a penúltima linha adversária. O motor não apita impedimento — ele impede a
posição, que é o efeito tático que interessa: o atacante joga **na** última linha e não atrás
dela. Sem esse limite os dois times deixam de se encaixar e a bola longa vira gol.

O resultado é que as duas equipes ocupam a mesma região do gramado e suas linhas se interpenetram,
em vez de cada uma viver na sua metade. O diagnóstico está em
[shape-diagnostics.test.ts](../src/domain/match/shape-diagnostics.test.ts) (`it.skip`, roda sob
demanda): sobreposição das faixas, adversários dentro da própria faixa e defensores entre a bola
e o próprio gol.

Ligar um botão novo do plano tático significa mudar **como a incumbência é escolhida**, não
passar mais um booleano por dentro de `ai.ts`. Os reinícios de jogo já usam esse gancho:
`restartLayoutTarget` (`runtime/restart`) é uma fonte de incumbência com prioridade sobre a
normal, injetada no topo de `decideAll` enquanto a bola está parada. Jogadas ensaiadas entram
por aí, refinando esse alvo por tipo de cobrança.

## Evolução planejada

Novas telas devem consumir comandos e consultas de application. Os próximos marcos são as
**substituições** — a única peça que falta para o plano ser inteiro em jogo, e que destravaria o
banco no editor da beira do gramado —, a recalibragem do 11x11 guiada por medição e as entidades
novas do editor (Estádio, Competição), cada uma um descritor. Nenhum deles deve acoplar o motor ao
armazenamento concreto. A interface segue sem framework, por decisão: o custo está no contrato
entre módulos, não na ausência de biblioteca.
