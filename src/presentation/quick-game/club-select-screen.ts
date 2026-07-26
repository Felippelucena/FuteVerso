import type { GameApplication } from "../../application/game-application";
import type { Club } from "../../domain/club/model";
import type { Team } from "../../domain/shared/model";
import { countryName } from "../../content/countries";
import { find, render } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon } from "../app/icons";
import type { Navigation, Screen, ScreenDefinition } from "../app/screen";

const TEAM_LABELS: Record<Team, string> = { blue: "Casa", coral: "Visitante" };

const clubSelectTemplate = (): Html => html`
  <section data-screen="quick-clubs" class="club-select-view">
    <div class="manager-heading">
      <div><span class="eyebrow">JOGO RÁPIDO</span><h2>Escolha os clubes</h2></div>
      <button type="button" class="primary-button" id="clubs-continue">${icon("ChevronRight")}Plano tático</button>
    </div>
    <p id="clubs-message" class="manager-message" aria-live="polite"></p>
    <div class="club-select-grid">
      ${(["blue", "coral"] as const).map((team) => html`
        <div class="club-column club-column--${team}">
          <div class="section-heading"><h3>${TEAM_LABELS[team]}</h3><span id="clubs-chosen-${team}"></span></div>
          <div class="club-list" id="clubs-list-${team}" role="listbox" aria-label="Clube ${TEAM_LABELS[team]}"></div>
        </div>`)}
    </div>
  </section>`;

export const clubSelectScreenDefinition = (application: GameApplication): ScreenDefinition => ({
  id: "quick-clubs",
  label: "Clubes",
  icon: "Shield",
  template: clubSelectTemplate,
  mount: ({ root, navigation }) => new ClubSelectScreen(root, navigation, application),
});

export class ClubSelectScreen implements Screen {
  private readonly chosen: Record<Team, string | null> = { blue: null, coral: null };

  constructor(
    private readonly root: HTMLElement,
    private readonly navigation: Navigation,
    private readonly application: GameApplication,
  ) {
    for (const team of ["blue", "coral"] as const) {
      this.find(`#clubs-list-${team}`).addEventListener("click", (event) => {
        const option = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-club]");
        if (option) this.choose(team, option.dataset.club!);
      });
    }
    this.find("#clubs-continue").addEventListener("click", () => this.continue());
  }

  render(): void {
    const clubs = this.sortedClubs();
    // A sugestão da aplicação abre a tela já jogável; trocar um lado é opcional.
    const suggested = this.application.suggestedSetup();
    this.chosen.blue ??= suggested?.blue.clubId ?? clubs[0]?.id ?? null;
    this.chosen.coral ??= suggested?.coral.clubId ?? clubs[1]?.id ?? null;
    for (const team of ["blue", "coral"] as const) this.renderColumn(team, clubs);
  }

  private renderColumn(team: Team, clubs: Club[]): void {
    const selected = this.chosen[team];
    const opponent = this.chosen[team === "blue" ? "coral" : "blue"];
    this.find(`#clubs-chosen-${team}`).textContent = clubs.find(({ id }) => id === selected)?.name ?? "—";
    render(this.find(`#clubs-list-${team}`), html`${clubs.map((club) => html`
      <button type="button" role="option" data-club="${club.id}"
        class="club-option ${club.id === selected ? "is-selected" : ""}"
        aria-selected="${club.id === selected ? "true" : "false"}"
        ${club.id === opponent ? html`disabled` : ""}>
        <span class="club-crest" style="--crest:${club.colors.primary};--crest-alt:${club.colors.secondary}"></span>
        <span class="club-option-name"><strong>${club.shortName}</strong>${club.name}</span>
        <span class="club-option-meta">${club.city} · ${countryName(club.nationality)} · REP ${club.reputation}</span>
      </button>`)}`);
  }

  private choose(team: Team, clubId: string): void {
    this.chosen[team] = clubId;
    this.render();
  }

  private continue(): void {
    const { blue, coral } = this.chosen;
    if (!blue || !coral) {
      this.setMessage("Escolha um clube para cada lado.", true);
      return;
    }
    this.navigation.push({ screenId: "quick-plan", params: { blue, coral } });
  }

  private sortedClubs(): Club[] {
    return [...this.application.world.clubs].sort((first, second) => first.name.localeCompare(second.name));
  }

  private setMessage(message: string, error = false): void {
    const element = this.find("#clubs-message");
    element.textContent = message;
    element.classList.toggle("is-error", error);
  }

  private find<T extends HTMLElement>(selector: string): T {
    return find<T>(this.root, selector);
  }
}
