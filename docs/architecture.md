# Arquitetura do FuteVerso

O projeto é um monólito modular. Cada módulo tem uma responsabilidade explícita e as dependências apontam para o domínio, nunca no sentido contrário.

## Módulos

```text
content ───────────────┐
                      v
presentation ──> application ──> domain
                         ^          ^
                         │          │
infrastructure ──────────┴──────────┘
```

- `domain/shared`: tipos e operações sem dependência de outros módulos.
- `domain/roster`: jogadores, atributos, memórias e regras de escalação.
- `domain/match`: estado, regras, IA, runtime compartilhado e sistemas determinísticos da partida.
- `application`: casos de uso que preparam dados do domínio e definem portas externas.
- `content`: catálogo embutido; futuramente será uma das fontes do editor de conteúdo.
- `infrastructure`: adapters de armazenamento e documentos versionados.
- `presentation`: Canvas, formatação e demais detalhes visuais.
- `main.ts`: composition root temporário, responsável por conectar os módulos.

## Regras de dependência

1. `domain` não importa `application`, `content`, `infrastructure`, `presentation` ou APIs do navegador.
2. O motor recebe somente `MatchConfig`; ele não conhece o perfil salvo nem sua origem.
3. `GameProfile` representa os dados usados pelo jogo. `SaveDocumentV2` representa o documento persistido.
4. Eventos de partida são dados estruturados. Somente presentation converte eventos em texto.
5. Aleatoriedade da simulação vem da semente de `MatchState`; não usar `Math.random()` dentro do domínio.
6. A ordem de execução e os valores do motor só mudam acompanhados de alteração explícita dos testes de caracterização.
7. Sistemas não importam `engine.ts` nem outros sistemas. Comportamentos compartilhados pertencem a `runtime`.

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
- tactics mede forma e fases coletivas.

`domain/match/runtime` contém somente primitivas compartilhadas de eventos, RNG, controle, aprendizado e métricas dos jogadores. Todo sistema recebe e muta `MatchState`; não há ECS ou estado duplicado.

## APIs públicas

O ponto de entrada público da partida é `domain/match/index.ts`:

- `createMatchState(config)` cria um estado isolado.
- `stepMatch(state, dt)` avança a simulação.
- `extractPlayerMemories(state)` devolve snapshots persistíveis das memórias.

`buildMatchConfig(profile, seedOverride?)` é o caso de uso que valida escalações, completa memórias ausentes e cria os participantes da partida sem referências compartilhadas com o perfil.

Persistência é acessada pela porta `SaveRepository`. O adapter atual usa `localStorage`, chave `autoball.save` e schema 2. Novas versões devem ser adicionadas ao registro sequencial de migrações.

## Evolução planejada

Novas telas consomem casos de uso de application. Conteúdo editável cria catálogos compatíveis com os mesmos tipos usados pelo conteúdo embutido. O próximo marco introduz `MatchSession` e separa a navegação e as telas sem levar responsabilidades de interface para o domínio.
