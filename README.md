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
npx tsc --noEmit
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
- Posse tática confirmada, com tolerância para bolas divididas e fases coletivas sem oscilações a cada toque.
- Ciclo cognitivo separado da física: jogadores sustentam planos de passe, corrida, pressão, marcação e cobertura.
- Oito atributos mentais, seis presets de personalidade e evolução ampla das preferências entre partidas.
- Gerenciamento de jogadores e escalações persistido em `localStorage`.
- Pausa, reinício e velocidades de simulação de 0.5x, 1x, 2x, 4x e 8x.
- Relatório tático com precisão de passe, finalizações, recuperações, entradas no terço final e métricas de forma.
- Mapas de ocupação, redes de passe e explicações para a decisão atual de cada jogador.
- Partidas de dez minutos com encerramento e relatório final automáticos.

## Estrutura

- `src/domain`: regras de elenco e partida, IA e sistemas determinísticos de simulação.
- `src/application`: sessão, coordenação do jogo, casos de uso e portas externas.
- `src/content`: jogadores e escalações disponibilizados pelo jogo.
- `src/infrastructure`: persistência versionada e adapters de armazenamento.
- `src/presentation`: shell, telas DOM, loop do navegador, Canvas e view models.
- `src/main.ts`: composition root que apenas instancia e conecta os módulos.

O motor recebe um `MatchConfig` independente do save e expõe uma fachada pequena
para criar, avançar e extrair resultados de uma partida. As regras de dependência
e as APIs públicas estão descritas em [`docs/architecture.md`](docs/architecture.md).

O controle da sessão fica em `MatchSession`, os comandos de perfil em
`GameApplication` e o shell, as telas e o loop do navegador em `presentation`.
O roteiro de regressão visual e funcional está em
[`docs/ui-characterization.md`](docs/ui-characterization.md).

O armazenamento implementa a porta `SaveRepository`, permitindo uma futura troca
por IndexedDB quando replays e históricos maiores forem adicionados.
O schema atual é a versão 2; saves da versão 1 são descartados para inicializar os
novos perfis mentais de forma consistente.
