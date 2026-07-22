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
- `domain/roster`: jogadores, atributos, memórias e regras de escalação.
- `domain/match`: estado, regras, IA, runtime compartilhado e sistemas determinísticos da partida.
- `application`: sessão em execução, casos de uso do perfil e portas externas.
- `content`: catálogo embutido; futuramente será uma das fontes do editor de conteúdo.
- `infrastructure`: adapters de armazenamento e documentos versionados.
- `presentation`: shell, telas DOM, loop do navegador, Canvas e formatação visual.
- `main.ts`: composition root que instancia e conecta os módulos.

## Regras de dependência

1. `domain` não importa `application`, `content`, `infrastructure`, `presentation` ou APIs do navegador.
2. O motor recebe somente `MatchConfig`; ele não conhece o perfil salvo nem sua origem.
3. `MatchSession` não conhece DOM, Canvas, relógio do navegador, storage ou repository.
4. `presentation` depende de `application`, tipos do domínio e renderer, mas não importa `infrastructure`.
5. `GameProfile` representa os dados usados pelo jogo. `SaveDocumentV2` representa o documento persistido.
6. Eventos de partida são dados estruturados. Somente presentation converte eventos em texto.
7. Aleatoriedade da simulação vem da semente de `MatchState`; não usar `Math.random()` dentro do domínio.
8. A ordem de execução e os valores do motor só mudam acompanhados de alteração explícita dos testes de caracterização.
9. Sistemas não importam `engine.ts` nem outros sistemas. Comportamentos compartilhados pertencem a `runtime`.

## Sessão e aplicação

`MatchSession` é o limite entre a simulação determinística e o tempo real. Ela possui o `MatchState`, pausa, velocidade e acumulador do fixed timestep. `advance(realDeltaSeconds)` limita o delta, aplica o multiplicador e executa no máximo 140 ticks por chamada.

`GameApplication` coordena `GameProfile`, `MatchSession` e a porta `SaveRepository`. Ela carrega o perfil, cria snapshots de partida, persiste memórias e oferece os comandos de seed, aprendizado, escalação e CRUD de jogadores. Mudanças no perfil são salvas imediatamente, mas uma partida em andamento somente recebe o novo elenco quando reiniciada.

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
- tactics mantém a fase e um plano coletivo persistente com corredor, risco, opções de passe, defesa de segurança e gatilho de pressão;
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

O adapter atual usa `localStorage`, chave `autoball.save` e schema 2. Novas versões devem ser adicionadas ao registro sequencial de migrações.

## Evolução planejada

Novas telas devem consumir comandos e consultas de application. Conteúdo editável deve produzir catálogos compatíveis com os mesmos tipos usados pelo conteúdo embutido. Os próximos marcos podem introduzir fluxo inicial, progressão e editor sem acoplar essas funcionalidades ao motor ou ao armazenamento concreto.
