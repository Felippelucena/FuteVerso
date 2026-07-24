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
| **Jogo rápido** | Escolhe dois times, edita escalação e tática, roda a partida. | Clubes, contratos e plano tático existem; falta o menu inicial e o editor. |
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
- Catálogo de clubes, jogadores e contratos gerado por semente e persistido em
  IndexedDB.

## Conteúdo editável

O jogo nasce com um catálogo gerado por semente: clubes com identidade e
reputação, elencos de 22 jogadores cobrindo todas as posições, contratos ligando
os dois e um plano tático padrão por clube.

- **Doze posições** (GOL, ZAG, LD, LE, VOL, MC, MD, ME, MEI, PD, PE, ATA), com
  posições secundárias e penalidade para quem joga fora de posição.
- **Contrato** é a única fonte da verdade do elenco: camisa, salário e validade
  pertencem ao vínculo, não ao jogador. Sem contrato ativo, agente livre.
- **Plano tático** sobre uma grade de 7 x 5 com 29 slots, cinco eixos de
  mentalidade, estilo de saída, bloco defensivo, gatilhos de pressão e
  instruções por jogador.
- **Nomes por país** em `src/content/names/`: um JSON por país que você acrescenta
  sem tocar em código. País sem lista toma nomes emprestados dos demais.

- **Onze contra onze**: o time que o treinador escala é o que entra em campo, com
  cada jogador ancorado na célula do slot em que foi escalado.
- **Incumbência para todo mundo**: a cada instante o plano coletivo entrega um
  dever a cada um dos onze — pressionar, sustentar a zona, atacar as costas da
  linha, segurar a amplitude, proteger o contra-ataque. Ninguém fica perdido em
  campo, e duas incumbências nunca disputam a mesma célula da grade.
- **Marcação zonal por padrão**, individual só onde o treinador pedir.

## Próximos passos

1. **Recalibrar o 11x11** — campo, gol, estamina e faixas de passe, guiados pelo
   harness de medição em `format-comparison.test.ts`.
2. **Ajustes táticos no motor** — ligar mentalidade, saída, bloco, gatilhos e
   instruções ao comportamento, que hoje é quase todo emergente.
3. **Interface em React** com menu inicial, Jogo Rápido e a tela de partida.
4. **Editores** de jogadores e de clubes, com o campo tático de arrastar e soltar.

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

- `src/domain`: jogadores, clubes, contratos, plano tático, mundo e o motor da partida.
- `src/application`: sessão, boot do mundo, casos de uso e portas externas.
- `src/content`: listas de nomes por país e os geradores de jogador, elenco, clube e catálogo.
- `src/infrastructure`: adapters de armazenamento (IndexedDB e volátil).
- `src/presentation`: shell, telas DOM, loop do navegador, Canvas e view models.
- `src/main.ts`: composition root que apenas instancia e conecta os módulos.

O motor recebe um `MatchConfig` independente do save e expõe uma fachada pequena
para criar, avançar e extrair resultados de uma partida. As regras de dependência
e as APIs públicas estão em [`docs/architecture.md`](docs/architecture.md); o
roteiro de regressão visual e funcional, em
[`docs/ui-characterization.md`](docs/ui-characterization.md).

O armazenamento implementa a porta assíncrona `WorldRepository`. O adapter padrão
usa IndexedDB com uma store por entidade e o versionamento nativo do banco; sem
IndexedDB disponível, um repositório volátil mantém o jogo rodando sem persistir.
