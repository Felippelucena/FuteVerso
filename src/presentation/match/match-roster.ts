import { playerRating, type MatchState } from "../../domain/match";
import type { PlayerRuntime } from "../../domain/match/model";
import { find, render } from "../app/dom";
import { html } from "../app/html";
import { POSITION_LABELS, type TeamNames } from "../app/labels";

const TEAMS = ["blue", "coral"] as const;
const LOW_ENERGY = 30;

const percent = (value: number): number => Math.max(0, Math.min(100, Math.round(value * 100)));

interface PlayerNodes {
  readonly button: HTMLElement;
  readonly caption: HTMLElement;
  readonly meter: HTMLElement;
  readonly longFill: HTMLElement;
  readonly volatileFill: HTMLElement;
  readonly rating: HTMLElement;
}

const ratingBand = (rating: number): string => rating >= 7.5 ? "high" : rating >= 6.5 ? "mid" : "low";

/**
 * O que este jogador fez de mais relevante até agora — o primeiro feito da lista que ele tem. A
 * linha respondia "o que ele está fazendo neste instante", que o painel de detalhe já diz; quem
 * corre os olhos pela lista quer saber quem decidiu a partida.
 */
const HIGHLIGHTS: readonly { readonly of: (stats: PlayerRuntime["match"]) => number; readonly one: string; readonly many: string }[] = [
  { of: (stats) => stats.goals, one: "gol", many: "gols" },
  { of: (stats) => stats.assists, one: "assistência", many: "assistências" },
  { of: (stats) => stats.saves, one: "defesa", many: "defesas" },
  { of: (stats) => stats.shotsOnTarget, one: "chute no alvo", many: "chutes no alvo" },
  { of: (stats) => stats.tacklesWon, one: "desarme", many: "desarmes" },
  { of: (stats) => stats.interceptions, one: "interceptação", many: "interceptações" },
];

const highlightOf = (player: PlayerRuntime): string => {
  for (const highlight of HIGHLIGHTS) {
    const count = highlight.of(player.match);
    if (count > 0) return `${count} ${count === 1 ? highlight.one : highlight.many}`;
  }
  return `${player.match.completedPasses} passes`;
};

/** Só a composição em campo. O que muda a cada tique — intenção e energia — fica de fora. */
export const rosterSignature = (players: readonly PlayerRuntime[], names: TeamNames): string =>
  `${names.blue}|${names.coral}|${players.map((player) => player.profile.id).join(",")}`;

/**
 * A estrutura da lista é reconstruída só quando a composição muda; a cada tique só os valores
 * voláteis são reescritos. Reconstruir os botões destruiria o foco do teclado a cada quadro.
 */
export class RosterList {
  private nodes = new Map<string, PlayerNodes>();

  constructor(private readonly target: HTMLElement) {}

  rebuild(players: readonly PlayerRuntime[], names: TeamNames): void {
    render(this.target, html`${TEAMS.map((team) => html`
      <div class="roster-team"><span class="roster-team-name roster-team-name--${team}">${names[team]}</span>
        ${players.filter((player) => player.team === team).map((player) => html`
          <button type="button" class="roster-player" data-inspect-player="${player.profile.id}">
            <span class="shirt shirt--${team}">${player.shirtNumber}</span>
            <span>
              <strong>${player.profile.name}</strong><small></small>
              <span class="stamina-meter">${["long", "volatile"].map((kind) => html`<span class="stamina-meter-bar"><span class="stamina-meter-fill stamina-meter-fill--${kind}"></span></span>`)}</span>
            </span>
            <b class="rating"></b>
          </button>`)}
      </div>`)}`);
    this.nodes = new Map(players.map((player) => {
      const button = find<HTMLElement>(this.target, `[data-inspect-player="${player.profile.id}"]`);
      return [player.profile.id, {
        button,
        caption: find<HTMLElement>(button, "small"),
        meter: find<HTMLElement>(button, ".stamina-meter"),
        longFill: find<HTMLElement>(button, ".stamina-meter-fill--long"),
        volatileFill: find<HTMLElement>(button, ".stamina-meter-fill--volatile"),
        rating: find<HTMLElement>(button, ".rating"),
      }];
    }));
  }

  patch(state: MatchState, selectedPlayerId: string): void {
    for (const player of state.players) {
      const nodes = this.nodes.get(player.profile.id);
      if (!nodes) continue;
      const long = percent(player.stamina);
      const volatile = percent(player.sprintEnergy);
      const rating = playerRating(player);
      nodes.rating.textContent = rating.toFixed(1);
      nodes.rating.className = `rating rating--${ratingBand(rating)}`;
      nodes.caption.textContent = `${POSITION_LABELS[player.profile.position]} · ${highlightOf(player)}`;
      nodes.meter.title = `Fôlego ${long}% · Pique ${volatile}%`;
      nodes.longFill.style.width = `${long}%`;
      nodes.volatileFill.style.width = `${volatile}%`;
      nodes.longFill.classList.toggle("is-low", long <= LOW_ENERGY);
      nodes.volatileFill.classList.toggle("is-low", volatile <= LOW_ENERGY);
      nodes.button.classList.toggle("is-selected", player.profile.id === selectedPlayerId);
    }
  }
}
