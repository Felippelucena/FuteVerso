# FuteVerso

Jogo de futebol **open source** com conteúdo totalmente editável — clubes,
jogadores e competições — construído sobre um simulador 2D que abstrai o realismo
em gameplay e game design. Vários modos de jogo compartilham o mesmo motor de
simulação; muda a estrutura ao redor, a partida é sempre a mesma base.

## Objetivo

- Jogo **open source** com conteúdo editável: clubes, jogadores e competições.
- Simulador 2D que troca fidelidade fotográfica por **gameplay e game design**.
- Um único simulador servindo **vários modos de jogo**.

## Modos de jogo

Todos os modos usam o mesmo simulador de partida.

| Modo | Descrição | Estado |
| --- | --- | --- |
| **Jogo rápido** | Escolhe dois times, edita escalação e tática, roda a partida. | Simulador pronto; falta estruturar em torno de um menu inicial. |
| **Carreira de técnico** | No estilo Brasfoot: gerencia um clube ao longo das temporadas. | Planejado. |
| **Roguelike** | Monta um time e vê até onde ele vai; cada vitória melhora o elenco. | Planejado. |

## Estado atual

O simulador de partida já existe e é o coração do projeto. Hoje ele roda uma
partida 4 x 4 (um goleiro e três jogadores de linha por time) em que cada jogador
decide de forma autônoma a partir de posição, função, atributos e memória
individual.

O que o simulador entrega hoje:

- Campo físico de 180 x 108 com gols ampliados; posições de goleiro, zagueiro,
  lateral, meio-campo e atacante e funções de finalização, construção e defesa.
- Ciclo cognitivo separado da física: jogadores sustentam planos de passe,
  corrida, pressão, marcação e cobertura sem oscilar a cada toque.
- Fases táticas coletivas — construção, progressão, último terço, contra-ataque,
  pressão e blocos defensivos — com amplitude, profundidade, terceiro homem,
  tabelas, inversões e defesa de segurança.
- Ritmos separados entre domínio curto, sprint controlado e toque longo; a
  distância desejada define a força na bola e a duração das explosões.
- Domínio contextual (controle limpo, toque pesado ou erro), fintas com janela de
  aceleração, passes rasteiros ou aéreos e finalizações com curva de potência
  própria — tudo com erros determinísticos influenciados por habilidade, pressão,
  distância e fadiga.
- Defesas físicas do goleiro (mergulhos, não perseguição magnética).
- Oito atributos mentais, seis presets de personalidade e evolução das
  preferências de decisão entre partidas.
- Semente editável e persistente para reproduzir uma partida ou gerar variações.
- Relatório tático com precisão de passe, finalizações, recuperações e forma;
  linha do tempo com retrocesso, pausa, reinício e velocidades de 0.5x a 8x.
- Gerenciamento de jogadores e escalações persistido em `localStorage`.

## Próximos passos

O simulador está pronto; o foco imediato é **estruturar a partida rápida como um
modo de jogo de verdade**:

- **Menu inicial** com dois botões: **Jogo Rápido** e **Editor**.
- **Editor de jogadores** (já existe uma tela de elenco) e um novo
  **editor de clubes**.
- **Contratos** ligando jogadores a clubes.
- **Clube de início** com **elenco** e **plano tático padrão** — escalação,
  reservas, postura e demais ajustes.

Carreira de técnico e roguelike vêm depois, reaproveitando esse mesmo editor e o
simulador.

## Executar

```bash
npm install
npm run dev
```

Abra `http://localhost:5173/`. Para validar o projeto:

```bash
npm test
npx tsc --noEmit
npm run build
```

## Estrutura

Monólito modular: as dependências apontam sempre para o domínio, nunca no sentido
contrário.

- `src/domain`: regras de elenco e partida, IA e sistemas determinísticos de simulação.
- `src/application`: sessão, coordenação do jogo, casos de uso e portas externas.
- `src/content`: catálogo embutido de jogadores e escalações — futura fonte do editor de conteúdo.
- `src/infrastructure`: persistência versionada e adapters de armazenamento.
- `src/presentation`: shell, telas DOM, loop do navegador, Canvas e view models.
- `src/main.ts`: composition root que apenas instancia e conecta os módulos.

O motor recebe um `MatchConfig` independente do save e expõe uma fachada pequena
para criar, avançar e extrair resultados de uma partida. As regras de dependência
e as APIs públicas estão em [`docs/architecture.md`](docs/architecture.md); o
roteiro de regressão visual e funcional, em
[`docs/ui-characterization.md`](docs/ui-characterization.md).

O armazenamento implementa a porta `SaveRepository`, permitindo trocar por
IndexedDB quando replays e históricos maiores forem adicionados. Conteúdo editável
deverá produzir catálogos compatíveis com os mesmos tipos usados pelo conteúdo
embutido, sem acoplar essas funcionalidades ao motor ou ao armazenamento concreto.
