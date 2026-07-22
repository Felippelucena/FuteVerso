# Autoball Lab

Simulador de futebol 2D em que dois times com quatro jogadores tomam decisões de
forma autônoma. Posição, função, atributos e memória individual influenciam a
movimentação e as escolhas com e sem a bola.

## Executar

```bash
npm install
npm run dev
```

Abra `http://localhost:5173/`. Para validar o projeto:

```bash
npm test
npm run build
```

## O que existe

- Semente editavel e persistente para reproduzir uma partida ou gerar uma variacao nova.

- Partida 4 x 4 com um goleiro e três jogadores de linha por time.
- Campo físico de 180 x 108 e gols ampliados em 1.4x.
- Posições de goleiro, zagueiro, lateral, meio-campo e atacante.
- Funções de finalização, construção e defesa.
- Posturas coletivas com e sem posse, pressão coordenada, apoio e marcação.
- Fases táticas de construção, progressão, último terço, contra-ataque, pressão e blocos defensivos.
- Coordenação ofensiva com amplitude, profundidade, terceiro homem, tabelas, inversões e defesa de segurança.
- Ritmos bem separados entre domínio curto, sprint controlado e toque longo: a distância desejada determina a força na bola e a duração da explosão de atacantes e defensores.
- Corridas sem bola acionadas por retomadas, contra-ataques e oportunidades de atacar a profundidade.
- Domínio contextual: velocidade da bola, orientação, pressão e atributos podem produzir controle limpo, toque pesado ou erro.
- Fintas exigem posse estabilizada; ao vencer o duelo, o atacante ultrapassa o defensor e ganha uma janela curta de aceleração.
- Passes rasteiros ou aéreos, curtos ou longos, no pé ou no espaço.
- Finalizações com curva de potência própria, claramente mais rápidas que passes longos.
- Erros determinísticos influenciados por habilidade, pressão, distância e fadiga.
- Memória individual com estatísticas e ajuste limitado dos pesos de decisão.
- Gerenciamento de jogadores e escalações persistido em `localStorage`.
- Pausa, reinício e velocidades de simulação de 0.5x, 1x, 2x, 4x e 8x.
- Relatório tático com precisão de passe, finalizações, recuperações, entradas no terço final e métricas de forma.
- Mapas de ocupação, redes de passe e explicações para a decisão atual de cada jogador.
- Partidas de dez minutos com encerramento e relatório final automáticos.

## Estrutura

- `src/game/model.ts`: contratos persistentes e estado da partida.
- `src/game/roster.ts`: elenco inicial e validação das escalações.
- `src/game/storage.ts`: repositório versionado em `localStorage`.
- `src/game/ai.ts`: formação, posturas e decisões coletivas.
- `src/game/tactics.ts`: detecção de fases, forma da equipe e métricas espaciais.
- `src/game/engine.ts`: física, posse, ações, gols e aprendizado.
- `src/game/renderer.ts`: desenho do campo e das entidades no Canvas.
- `src/main.ts`: loop, abas, inspetor e gerenciamento de jogadores.

O armazenamento usa uma interface de repositório para permitir uma futura troca
por IndexedDB quando replays e históricos maiores forem adicionados.
