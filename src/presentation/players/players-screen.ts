import type { CommandError, GameApplication } from "../../application/game-application";
import { COUNTRIES, countryName } from "../../content/countries";
import type { PlayerMentalAttributes, PlayerPosition, PlayerProfile, PlayerRole, PlayerSkills } from "../../domain/roster/model";
import { createMentalAttributes, dominantMentalTraits, MENTAL_PRESET_LABELS, MENTAL_PRESETS, type MentalPreset } from "../../domain/roster/personality";
import { PLAYER_POSITIONS } from "../../domain/roster/positions";
import { escapeHtml, POSITION_LABELS, POSITION_SHORT_LABELS, ROLE_LABELS } from "../app/labels";
import { hydrateIcons } from "../app/icons";
import { createPlayersViewModel } from "./players-view-model";

const SKILL_FIELDS: { key: keyof PlayerSkills; label: string }[] = [
  { key: "acceleration", label: "Aceleração" }, { key: "sprintSpeed", label: "Velocidade" },
  { key: "burst", label: "Explosão" }, { key: "stamina", label: "Resistência" },
  { key: "control", label: "Controle" }, { key: "passing", label: "Passe" },
  { key: "vision", label: "Visão" }, { key: "finishing", label: "Finalização" },
  { key: "defending", label: "Defesa" }, { key: "kickPower", label: "Força" },
  { key: "goalkeeping", label: "Goleiro" },
];

const MENTAL_FIELDS: { key: keyof PlayerMentalAttributes; label: string }[] = [
  { key: "decisionMaking", label: "Tomada de decisão" }, { key: "anticipation", label: "Antecipação" },
  { key: "composure", label: "Compostura" }, { key: "aggression", label: "Agressividade" },
  { key: "teamwork", label: "Trabalho coletivo" }, { key: "creativity", label: "Criatividade" },
  { key: "intensity", label: "Intensidade" }, { key: "adaptability", label: "Adaptabilidade" },
];

const DEFAULT_AGE = 24;

const skillInputs = (): string => SKILL_FIELDS.map(({ key, label }) => `
  <label class="skill-field"><span>${label}</span><input name="${key}" type="number" min="1" max="100" value="65" required /></label>
`).join("");

const mentalInputs = (): string => MENTAL_FIELDS.map(({ key, label }) => `
  <label class="skill-field"><span>${label}</span><input name="mental-${key}" type="number" min="1" max="100" value="65" required /></label>
`).join("");

const positionOptions = (): string => PLAYER_POSITIONS
  .map((position) => `<option value="${position}">${POSITION_SHORT_LABELS[position]} · ${POSITION_LABELS[position]}</option>`)
  .join("");

const countryOptions = (): string => COUNTRIES
  .map((country) => `<option value="${country.code}">${escapeHtml(country.name)}</option>`)
  .join("");

export const playersScreenTemplate = (): string => `
  <section id="players-view" class="manager-view" hidden>
    <div class="manager-heading"><div><span class="eyebrow">CATÁLOGO</span><h2>Jogadores</h2></div><button id="add-player" class="primary-button" type="button"><i data-lucide="plus"></i>Novo jogador</button></div>
    <p id="manager-message" class="manager-message" aria-live="polite"></p>
    <div class="players-section"><div class="section-heading"><h3>Todos os jogadores</h3><span id="player-count"></span></div><div id="players-table" class="players-table"></div></div>
  </section>`;

export const playerDialogTemplate = (): string => `
  <dialog id="player-dialog" class="player-dialog">
    <form id="player-form" method="dialog">
      <div class="dialog-heading"><div><span class="eyebrow">PERFIL</span><h2 id="dialog-title">Novo jogador</h2></div><button class="icon-button" id="close-player" type="button" aria-label="Fechar" title="Fechar"><i data-lucide="x"></i></button></div>
      <input type="hidden" name="id" />
      <div class="identity-fields">
        <label><span>Nome</span><input name="name" maxlength="32" required /></label>
        <label><span>Idade</span><input name="age" type="number" min="15" max="45" required /></label>
        <label><span>Nacionalidade</span><select name="nationality">${countryOptions()}</select></label>
        <label><span>Posição</span><select name="position">${positionOptions()}</select></label>
        <label><span>Função</span><select name="role">${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
      </div>
      <div class="skills-heading"><strong>Atributos</strong><span>1–100</span></div><div class="skills-grid">${skillInputs()}</div>
      <div class="skills-heading"><strong>Personalidade</strong><span>1–100</span></div>
      <label class="mental-preset"><span>Preset mental</span><select id="mental-preset" name="mentalPreset">${Object.entries(MENTAL_PRESET_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}<option value="custom">Personalizado</option></select></label>
      <div class="skills-grid mental-grid">${mentalInputs()}</div>
      <div class="dialog-actions"><button type="button" class="secondary-button" id="cancel-player">Cancelar</button><button type="submit" class="primary-button"><i data-lucide="save"></i>Salvar jogador</button></div>
    </form>
  </dialog>`;

const commandMessage = (reason: CommandError): string => {
  if (reason === "invalid-player") return "Revise os dados do jogador antes de salvar.";
  if (reason === "player-not-found") return "O jogador não existe mais.";
  if (reason === "club-not-found") return "O clube não existe mais.";
  return "Essa alteração deixaria um plano tático inválido.";
};

export class PlayersScreen {
  private editingPlayerId: string | null = null;
  private readonly playerForm: HTMLFormElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly dialog: HTMLDialogElement,
    private readonly application: GameApplication,
  ) {
    this.playerForm = this.dialogFind<HTMLFormElement>("#player-form");
    this.bindEvents();
  }

  render(): void {
    const viewModel = createPlayersViewModel(this.application.world);
    this.find("#player-count").textContent = viewModel.countLabel;
    this.find("#players-table").innerHTML = viewModel.rows.map((row) => {
      const secondary = row.secondaryPositions.map((position) => POSITION_SHORT_LABELS[position]).join("/");
      const player = this.application.world.players.find(({ id }) => id === row.id)!;
      return `
      <div class="player-table-row"><span class="shirt shirt--neutral">${row.shirtNumber ?? "–"}</span><div class="player-table-name"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.clubName)} · ${POSITION_SHORT_LABELS[row.position]}${secondary ? ` (${secondary})` : ""} · ${ROLE_LABELS[row.role]} · ${row.age} anos · ${escapeHtml(countryName(row.nationality))} · ${dominantMentalTraits(player.mental).join(" / ")}</span></div>
        <div class="player-rating"><span>GER <strong>${row.overall}</strong></span><span>CON <strong>${player.skills.control}</strong></span><span>PAS <strong>${player.skills.passing}</strong></span><span>VEL <strong>${player.skills.sprintSpeed}</strong></span></div>
        <div class="row-actions"><button class="icon-button" type="button" data-edit-player="${row.id}" aria-label="Editar ${escapeHtml(row.name)}" title="Editar"><i data-lucide="pencil"></i></button><button class="icon-button icon-button--danger" type="button" data-delete-player="${row.id}" aria-label="Excluir ${escapeHtml(row.name)}" title="Excluir"><i data-lucide="trash-2"></i></button></div></div>`;
    }).join("");
    hydrateIcons();
  }

  private bindEvents(): void {
    this.find("#add-player").addEventListener("click", () => this.openPlayerDialog());
    this.find("#players-table").addEventListener("click", (event) => this.handlePlayerAction(event));
    this.dialogFind("#cancel-player").addEventListener("click", () => this.dialog.close());
    this.dialogFind("#close-player").addEventListener("click", () => this.dialog.close());
    (this.playerForm.elements.namedItem("position") as HTMLSelectElement).addEventListener("change", () => this.syncRoleOptions());
    this.dialogFind<HTMLSelectElement>("#mental-preset").addEventListener("change", (event) => this.applyMentalPreset((event.currentTarget as HTMLSelectElement).value));
    for (const { key } of MENTAL_FIELDS) {
      (this.playerForm.elements.namedItem(`mental-${key}`) as HTMLInputElement).addEventListener("input", () => {
        (this.playerForm.elements.namedItem("mentalPreset") as HTMLSelectElement).value = "custom";
      });
    }
    this.playerForm.addEventListener("submit", (event) => this.savePlayer(event));
  }

  private handlePlayerAction(event: Event): void {
    const edit = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-edit-player]");
    const remove = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-delete-player]");
    if (edit) {
      const profile = this.application.world.players.find(({ id }) => id === edit.dataset.editPlayer);
      if (profile) this.openPlayerDialog(profile);
    }
    if (remove) {
      const result = this.application.deletePlayer(remove.dataset.deletePlayer!);
      if (result.ok) {
        this.setMessage("Jogador excluído. As escalações afetadas foram recompostas.");
        this.render();
      } else {
        this.setMessage(commandMessage(result.reason), true);
      }
    }
  }

  private savePlayer(event: SubmitEvent): void {
    event.preventDefault();
    const data = new FormData(this.playerForm);
    const position = String(data.get("position")) as PlayerPosition;
    const existing = this.editingPlayerId
      ? this.application.world.players.find(({ id }) => id === this.editingPlayerId)
      : null;
    const age = Number(data.get("age"));
    const profile: PlayerProfile = {
      id: this.editingPlayerId ?? (crypto.randomUUID?.() ?? `player-${Date.now()}`),
      name: String(data.get("name")).trim(),
      nationality: String(data.get("nationality")),
      birthYear: this.application.world.settings.currentYear - (Number.isFinite(age) ? age : DEFAULT_AGE),
      position,
      // As posições secundárias ainda não têm campo próprio; são preservadas na edição e
      // ganham interface no editor de jogadores da fase seguinte.
      secondaryPositions: (existing?.secondaryPositions ?? []).filter((secondary) => secondary !== position && secondary !== "goalkeeper" && position !== "goalkeeper"),
      role: position === "goalkeeper" ? "defender" : String(data.get("role")) as PlayerRole,
      skills: Object.fromEntries(SKILL_FIELDS.map(({ key }) => [key, Number(data.get(key))])) as unknown as PlayerSkills,
      mental: Object.fromEntries(MENTAL_FIELDS.map(({ key }) => [key, Number(data.get(`mental-${key}`))])) as unknown as PlayerMentalAttributes,
    };
    const result = this.application.upsertPlayer(profile);
    if (!result.ok) {
      this.setMessage(commandMessage(result.reason), true);
      return;
    }
    this.dialog.close();
    this.setMessage(this.editingPlayerId ? "Jogador atualizado. A partida atual não foi alterada." : "Jogador criado como agente livre.");
    this.render();
  }

  private openPlayerDialog(profile?: PlayerProfile): void {
    this.editingPlayerId = profile?.id ?? null;
    this.playerForm.reset();
    this.dialogFind("#dialog-title").textContent = profile ? "Editar jogador" : "Novo jogador";
    const currentYear = this.application.world.settings.currentYear;
    (this.playerForm.elements.namedItem("id") as HTMLInputElement).value = profile?.id ?? "";
    (this.playerForm.elements.namedItem("name") as HTMLInputElement).value = profile?.name ?? "";
    (this.playerForm.elements.namedItem("age") as HTMLInputElement).value = String(profile ? currentYear - profile.birthYear : DEFAULT_AGE);
    (this.playerForm.elements.namedItem("nationality") as HTMLSelectElement).value = profile?.nationality ?? "BR";
    (this.playerForm.elements.namedItem("position") as HTMLSelectElement).value = profile?.position ?? "centerMid";
    (this.playerForm.elements.namedItem("role") as HTMLSelectElement).value = profile?.role ?? "playmaker";
    for (const { key } of SKILL_FIELDS) (this.playerForm.elements.namedItem(key) as HTMLInputElement).value = String(profile?.skills[key] ?? 65);
    const defaultMental = profile?.mental ?? createMentalAttributes("balanced");
    for (const { key } of MENTAL_FIELDS) (this.playerForm.elements.namedItem(`mental-${key}`) as HTMLInputElement).value = String(defaultMental[key]);
    (this.playerForm.elements.namedItem("mentalPreset") as HTMLSelectElement).value = profile ? "custom" : "balanced";
    this.syncRoleOptions();
    this.dialog.showModal();
  }

  private syncRoleOptions(): void {
    const position = this.playerForm.elements.namedItem("position") as HTMLSelectElement;
    const role = this.playerForm.elements.namedItem("role") as HTMLSelectElement;
    const goalkeeper = position.value === "goalkeeper";
    if (goalkeeper) role.value = "defender";
    for (const option of role.options) option.disabled = goalkeeper && option.value !== "defender";
  }

  private applyMentalPreset(preset: string): void {
    if (preset === "custom") return;
    const values = MENTAL_PRESETS[preset as MentalPreset];
    for (const { key } of MENTAL_FIELDS) {
      (this.playerForm.elements.namedItem(`mental-${key}`) as HTMLInputElement).value = String(values[key]);
    }
  }

  private setMessage(message: string, error = false): void {
    const element = this.find("#manager-message");
    element.textContent = message;
    element.classList.toggle("is-error", error);
  }

  private find<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Elemento ${selector} não encontrado na tela de jogadores.`);
    return element;
  }

  private dialogFind<T extends HTMLElement>(selector: string): T {
    const element = this.dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Elemento ${selector} não encontrado no formulário de jogador.`);
    return element;
  }
}
