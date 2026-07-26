import type { PlayerProfile } from "../../domain/roster/model";
import { playerOverall } from "../../domain/roster/rating";
import { applyFormation, autoPickPlan } from "../../domain/tactics/auto-lineup";
import { defaultFormation, findFormation, FORMATIONS, matchFormation } from "../../domain/tactics/formations";
import {
  DEFAULT_INSTRUCTION,
  instructionFor,
  type FreedomInstruction,
  type PlayerInstruction,
  type TacticalMentality,
  type TeamTacticalPlan,
} from "../../domain/tactics/model";
import { positionFit } from "../../domain/tactics/position-fit";
import { inspectPlan } from "../../domain/tactics/rules";
import { findSlot, TACTICAL_GRID, TACTICAL_SLOTS, type TacticalSlot, type TacticalSlotId } from "../../domain/tactics/slots";
import {
  BUILD_UP_STYLES,
  DEFENSIVE_BLOCKS,
  PRESS_TRIGGERS,
  type BuildUpStyle,
  type DefensiveBlock,
  type PressTrigger,
} from "../../domain/tactics/vocabulary";
import { PITCH_RATIO, pitchMarkingsSvg } from "../canvas/pitch-markings";
import { render } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon } from "../app/icons";
import {
  BUILD_UP_LABELS,
  DEFENSIVE_BLOCK_LABELS,
  FREEDOM_LABELS,
  MARKING_LABELS,
  MENTALITY_AXES,
  PLAN_ISSUE_LABELS,
  POSITION_FIT_LABELS,
  POSITION_SHORT_LABELS,
  PRESS_TRIGGER_LABELS,
  SUPPORT_LABELS,
} from "../app/labels";

/**
 * De onde um jogador saiu e para onde vai. O campo, o banco e os disponíveis são os três lugares
 * possíveis — "disponível" é a ausência de vínculo, não uma lista guardada no plano.
 */
type PlanSpot =
  | { kind: "slot"; slotId: TacticalSlotId }
  | { kind: "list"; list: "bench" | "available" };

export interface PlanEditorSource {
  plan(): TeamTacticalPlan;
  squad(): PlayerProfile[];
  /** Depois de cada mudança. O dono decide o que fazer com o plano: guardar, aplicar, nada. */
  changed(plan: TeamTacticalPlan): void;
  /**
   * Com a bola rolando ninguém entra nem sai — isso é substituição. Os onze seguem podendo
   * trocar de posição entre si, que é o ajuste que um treinador faz sem parar o jogo.
   */
  benchLocked?: boolean;
}

const DRAG_THRESHOLD = 4;

const slotByCell = new Map<string, TacticalSlot>(
  TACTICAL_SLOTS.map((slot) => [`${slot.zone.column}:${slot.zone.row}`, slot]),
);

const sameSpot = (first: PlanSpot, second: PlanSpot): boolean => first.kind === "slot"
  ? second.kind === "slot" && first.slotId === second.slotId
  : second.kind === "list" && first.list === second.list;

const spotOf = (element: HTMLElement): PlanSpot | null => {
  const slot = element.closest<HTMLElement>("[data-slot]");
  if (slot) return { kind: "slot", slotId: slot.dataset.slot as TacticalSlotId };
  const list = element.closest<HTMLElement>("[data-list]");
  if (list) return { kind: "list", list: list.dataset.list as "bench" | "available" };
  return null;
};

const isDefaultInstruction = (instruction: PlayerInstruction): boolean =>
  (Object.keys(DEFAULT_INSTRUCTION) as (keyof PlayerInstruction)[])
    .every((key) => instruction[key] === DEFAULT_INSTRUCTION[key]);

/**
 * O editor de plano tático: campo com slots, banco, disponíveis e os controles que o motor lê.
 *
 * É o mesmo componente na aba do clube, no passo do jogo rápido e com a partida em andamento —
 * ele não sabe qual dos três o hospeda. Tudo que muda entre eles está em `PlanEditorSource`:
 * de onde vem o plano, para onde vai a mudança e se o banco está travado.
 */
export class PlanEditor {
  private selectedSlot: TacticalSlotId | null = null;
  private dragging: { playerId: string; from: PlanSpot; ghost: HTMLElement } | null = null;
  private pressed: { playerId: string; from: PlanSpot; x: number; y: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly source: PlanEditorSource,
  ) {
    this.host.classList.add("plan-editor");
    this.host.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    // Mover e soltar são ouvidos na janela, e não no host: o dedo sai da caixa do editor o tempo
    // todo durante um arrasto, e prender os eventos ao host deixaria o fantasma preso no ar.
    window.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", (event) => this.onPointerUp(event));
    window.addEventListener("pointercancel", () => this.cancelDrag());
    this.host.addEventListener("click", (event) => this.onClick(event));
    this.host.addEventListener("change", (event) => this.onChange(event));
    this.host.addEventListener("input", (event) => this.onSlide(event));
  }

  render(): void {
    const plan = this.source.plan();
    const squad = this.source.squad();
    render(this.host, this.template(plan, squad));
  }

  // --- Marcação -------------------------------------------------------------------------

  private template(plan: TeamTacticalPlan, squad: PlayerProfile[]): Html {
    const byId = new Map(squad.map((player) => [player.id, player]));
    const bySlot = new Map(plan.assignments.map(({ slotId, playerId }) => [slotId, byId.get(playerId) ?? null]));
    const issues = inspectPlan(plan, squad);
    const faultySlots = new Set(issues.map(({ slotId }) => slotId).filter(Boolean));
    const assigned = new Set(plan.assignments.map(({ playerId }) => playerId));
    const benched = new Set(plan.bench);
    const available = squad.filter((player) => !assigned.has(player.id) && !benched.has(player.id));
    const formation = plan.formationId ? findFormation(plan.formationId) : null;

    return html`
      <div class="plan-toolbar">
        <label class="plan-formation">
          <span>Formação</span>
          <select data-role="formation">
            ${FORMATIONS.map((preset) => html`<option value="${preset.id}" ${preset.id === formation?.id ? html`selected` : ""}>${preset.name}</option>`)}
            ${formation ? "" : html`<option value="" selected>Personalizada</option>`}
          </select>
        </label>
        <button type="button" class="secondary-button" data-action="auto">${icon("Wand2")}Escalação automática</button>
        ${this.source.benchLocked
          ? html`<span class="plan-lock">${icon("Radio")}Em jogo: os onze trocam de posição, mas ninguém entra nem sai.</span>`
          : ""}
      </div>

      <div class="plan-layout">
        <div class="plan-field" style="--pitch-ratio:${PITCH_RATIO}" aria-label="Campo tático">
          ${pitchMarkingsSvg()}
          ${TACTICAL_GRID.rows.map((row) => TACTICAL_GRID.columns.map((column) => {
            const slot = slotByCell.get(`${column}:${row}`);
            // Buraco da grade: a célula existe para segurar o lugar, sem slot e sem alvo.
            if (!slot) return html`<div class="plan-cell"></div>`;
            const player = bySlot.get(slot.id) ?? null;
            return html`<div class="plan-cell ${player ? "is-filled" : ""} ${faultySlots.has(slot.id) ? "is-faulty" : ""}
              ${this.selectedSlot === slot.id ? "is-selected" : ""}" data-slot="${slot.id}">
              <span class="plan-slot-label">${slot.label}</span>
              ${player ? this.card(player, slot) : ""}
            </div>`;
          }))}
        </div>

        <div class="plan-side">
          <section class="plan-list" data-list="bench" aria-label="Reservas">
            <header><strong>Reservas</strong><span>${plan.bench.length}</span></header>
            <div class="plan-list-body">
              ${plan.bench.length === 0 ? html`<p class="data-empty">Arraste alguém para cá.</p>` : ""}
              ${plan.bench.map((playerId) => {
                const player = byId.get(playerId);
                return player ? this.card(player, null) : "";
              })}
            </div>
          </section>
          <section class="plan-list" data-list="available" aria-label="Disponíveis">
            <header><strong>Disponíveis</strong><span>${available.length}</span></header>
            <div class="plan-list-body">
              ${available.length === 0 ? html`<p class="data-empty">Todo o elenco está escalado.</p>` : ""}
              ${available.map((player) => this.card(player, null))}
            </div>
          </section>
        </div>
      </div>

      ${issues.length === 0 ? "" : html`<ul class="plan-issues">
        ${[...new Set(issues.map(({ kind }) => kind))].map((kind) => html`<li>${PLAN_ISSUE_LABELS[kind]}</li>`)}
      </ul>`}

      <div class="plan-tune">
        ${this.directivesPanel(plan)}
        ${this.instructionPanel(plan, bySlot)}
      </div>`;
  }

  private card(player: PlayerProfile, slot: TacticalSlot | null): Html {
    const fit = slot ? positionFit(player, slot) : null;
    return html`<button type="button" class="plan-card ${fit ? `is-fit-${fit.level}` : ""}"
      data-player="${player.id}" title="${fit ? POSITION_FIT_LABELS[fit.level] : player.name}">
      <strong>${player.name}</strong>
      <em>${POSITION_SHORT_LABELS[player.position]} · ${playerOverall(player)}</em>
    </button>`;
  }

  private directivesPanel(plan: TeamTacticalPlan): Html {
    return html`
      <section class="plan-panel">
        <header><strong>Como o time joga</strong></header>
        <div class="plan-axes">
          ${MENTALITY_AXES.map(({ key, label, low, high }) => html`
            <label class="plan-axis">
              <span class="plan-axis-name">${label}<em data-axis-value="${key}">${plan.mentality[key]}</em></span>
              <input type="range" min="0" max="100" step="5" value="${plan.mentality[key]}" data-axis="${key}"
                aria-label="${label}, de ${low} a ${high}" />
              <span class="plan-axis-ends"><em>${low}</em><em>${high}</em></span>
            </label>`)}
        </div>
        <div class="plan-styles">
          <label><span>Saída de bola</span>
            <select data-style="buildUpStyle">
              ${(["auto", ...BUILD_UP_STYLES] as const).map((value) => html`
                <option value="${value}" ${value === plan.buildUpStyle ? html`selected` : ""}>${BUILD_UP_LABELS[value]}</option>`)}
            </select>
          </label>
          <label><span>Bloco defensivo</span>
            <select data-style="defensiveBlock">
              ${(["auto", ...DEFENSIVE_BLOCKS] as const).map((value) => html`
                <option value="${value}" ${value === plan.defensiveBlock ? html`selected` : ""}>${DEFENSIVE_BLOCK_LABELS[value]}</option>`)}
            </select>
          </label>
        </div>
        <div class="plan-triggers">
          <span class="plan-triggers-title">Quando pressionar</span>
          ${PRESS_TRIGGERS.map((trigger) => html`
            <label class="plan-trigger">
              <input type="checkbox" data-trigger="${trigger}" ${plan.pressTriggers.includes(trigger) ? html`checked` : ""} />
              <span>${PRESS_TRIGGER_LABELS[trigger]}</span>
            </label>`)}
        </div>
      </section>`;
  }

  private instructionPanel(plan: TeamTacticalPlan, bySlot: Map<string, PlayerProfile | null>): Html {
    const slot = this.selectedSlot ? findSlot(this.selectedSlot) : null;
    const player = slot ? bySlot.get(slot.id) ?? null : null;
    if (!slot || !player) {
      return html`<section class="plan-panel plan-panel--empty">
        <header><strong>Instruções</strong></header>
        <p class="data-empty">Toque num jogador em campo para dar instruções só a ele.</p>
      </section>`;
    }
    const instruction = instructionFor(plan, slot.id);
    const choice = <T extends string>(field: string, label: string, current: T, options: Record<string, string>): Html => html`
      <label><span>${label}</span>
        <select data-instruction="${field}">
          ${Object.entries(options).map(([value, text]) => html`
            <option value="${value}" ${value === current ? html`selected` : ""}>${text}</option>`)}
        </select>
      </label>`;
    return html`
      <section class="plan-panel">
        <header><strong>${player.name}</strong><span>${slot.label} · ${POSITION_FIT_LABELS[positionFit(player, slot).level]}</span></header>
        <div class="plan-instructions">
          ${choice("support", "Apoio ao ataque", instruction.support, SUPPORT_LABELS)}
          ${choice("marking", "Marcação", instruction.marking, MARKING_LABELS)}
          ${choice("shootFreedom", "Liberdade de chutar", instruction.shootFreedom, FREEDOM_LABELS)}
          ${choice("dribbleFreedom", "Liberdade de driblar", instruction.dribbleFreedom, FREEDOM_LABELS)}
        </div>
      </section>`;
  }

  // --- Arrasto --------------------------------------------------------------------------

  private onPointerDown(event: PointerEvent): void {
    const card = (event.target as HTMLElement).closest<HTMLElement>("[data-player]");
    if (!card) return;
    const from = spotOf(card);
    if (!from) return;
    this.pressed = { playerId: card.dataset.player!, from, x: event.clientX, y: event.clientY };
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.pressed && !this.dragging) {
      const travelled = Math.hypot(event.clientX - this.pressed.x, event.clientY - this.pressed.y);
      // Só vira arrasto depois de andar: senão todo toque para selecionar viraria uma mudança.
      if (travelled < DRAG_THRESHOLD) return;
      this.startDrag();
    }
    if (!this.dragging) return;
    event.preventDefault();
    this.dragging.ghost.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    this.highlightTarget(event);
  }

  private startDrag(): void {
    const { playerId, from } = this.pressed!;
    const ghost = document.createElement("div");
    ghost.className = "plan-ghost";
    ghost.textContent = this.source.squad().find(({ id }) => id === playerId)?.name ?? "";
    document.body.append(ghost);
    this.dragging = { playerId, from, ghost };
    this.host.classList.add("is-dragging");
    this.markFits(playerId);
  }

  /**
   * Enquanto arrasta, cada slot mostra o encaixe daquele jogador ali. A regra já existe em
   * `positionFit`; a tela só a torna visível antes de o treinador soltar.
   */
  private markFits(playerId: string): void {
    const player = this.source.squad().find(({ id }) => id === playerId);
    if (!player) return;
    for (const cell of this.host.querySelectorAll<HTMLElement>("[data-slot]")) {
      const slot = findSlot(cell.dataset.slot!);
      if (!slot) continue;
      cell.dataset.fit = positionFit(player, slot).level;
    }
  }

  private highlightTarget(event: PointerEvent): void {
    const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const target = under ? spotOf(under) : null;
    for (const zone of this.host.querySelectorAll<HTMLElement>("[data-slot], [data-list]")) {
      const spot = spotOf(zone);
      zone.classList.toggle("is-target", Boolean(target && spot && sameSpot(spot, target)));
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const drag = this.dragging;
    this.pressed = null;
    if (!drag) return;
    const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const target = under ? spotOf(under) : null;
    this.cancelDrag();
    if (target) this.move(drag.playerId, drag.from, target);
  }

  private cancelDrag(): void {
    this.dragging?.ghost.remove();
    this.dragging = null;
    this.pressed = null;
    this.host.classList.remove("is-dragging");
    for (const cell of this.host.querySelectorAll<HTMLElement>("[data-slot]")) delete cell.dataset.fit;
    for (const zone of this.host.querySelectorAll(".is-target")) zone.classList.remove("is-target");
  }

  // --- Mudanças no plano ----------------------------------------------------------------

  /**
   * Uma regra só para todo movimento: quem chega ocupa o destino, e quem estava lá vai para a
   * origem de quem chegou. Campo com campo é troca de posição; campo com lista é entrada e
   * saída da escalação. Não há caso particular por par de listas.
   */
  private move(playerId: string, from: PlanSpot, to: PlanSpot): void {
    if (sameSpot(from, to)) return;
    const plan = this.source.plan();
    const changesLineup = (from.kind === "slot") !== (to.kind === "slot");
    if (this.source.benchLocked && changesLineup) return;

    if (to.kind === "slot") {
      const slot = findSlot(to.slotId);
      const player = this.source.squad().find(({ id }) => id === playerId);
      if (!slot || !player || positionFit(player, slot).level === "blocked") return;
      const occupant = plan.assignments.find((assignment) => assignment.slotId === slot.id)?.playerId ?? null;
      this.detach(plan, playerId);
      if (occupant) {
        this.detach(plan, occupant);
        this.attach(plan, occupant, from);
      }
      plan.assignments.push({ slotId: slot.id, playerId });
      this.selectedSlot = slot.id;
    } else {
      this.detach(plan, playerId);
      this.attach(plan, playerId, to);
    }

    plan.formationId = matchFormation(plan.assignments.map(({ slotId }) => slotId))?.id ?? null;
    this.commit(plan);
    this.render();
  }

  private detach(plan: TeamTacticalPlan, playerId: string): void {
    plan.assignments = plan.assignments.filter((assignment) => assignment.playerId !== playerId);
    plan.bench = plan.bench.filter((id) => id !== playerId);
  }

  private attach(plan: TeamTacticalPlan, playerId: string, spot: PlanSpot): void {
    if (spot.kind === "slot") plan.assignments.push({ slotId: spot.slotId, playerId });
    else if (spot.list === "bench") plan.bench.push(playerId);
    // "Disponível" é não estar em lugar nenhum: soltar ali é justamente não reatar.
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest("[data-action=\"auto\"]")) {
      this.autoPick();
      return;
    }
    const card = target.closest<HTMLElement>("[data-player]");
    if (!card) return;
    const spot = spotOf(card);
    // Só quem está em campo tem instrução: elas são do slot, não do atleta.
    this.selectedSlot = spot?.kind === "slot" && spot.slotId !== this.selectedSlot ? spot.slotId : null;
    this.render();
  }

  private onChange(event: Event): void {
    const target = event.target as HTMLElement;
    const plan = this.source.plan();

    const formation = target.closest<HTMLSelectElement>("[data-role=\"formation\"]");
    if (formation) {
      const preset = findFormation(formation.value) ?? defaultFormation();
      // Trocar o desenho preserva quem joga; reescalar do zero é o outro botão.
      Object.assign(plan, applyFormation(plan, preset, this.source.squad()));
      this.commit(plan);
      this.render();
      return;
    }

    const style = target.closest<HTMLSelectElement>("[data-style]");
    if (style) {
      if (style.dataset.style === "buildUpStyle") plan.buildUpStyle = style.value as BuildUpStyle | "auto";
      else plan.defensiveBlock = style.value as DefensiveBlock | "auto";
      this.commit(plan);
      return;
    }

    const trigger = target.closest<HTMLInputElement>("[data-trigger]");
    if (trigger) {
      const name = trigger.dataset.trigger as PressTrigger;
      // Reconstruído a partir da ordem canônica: a lista guardada não depende da ordem de clique.
      plan.pressTriggers = PRESS_TRIGGERS.filter((candidate) => candidate === name
        ? trigger.checked
        : plan.pressTriggers.includes(candidate));
      this.commit(plan);
      return;
    }

    const instruction = target.closest<HTMLSelectElement>("[data-instruction]");
    if (instruction && this.selectedSlot) {
      const field = instruction.dataset.instruction as keyof PlayerInstruction;
      const updated = { ...instructionFor(plan, this.selectedSlot), [field]: instruction.value as FreedomInstruction };
      // O plano só guarda quem foge do padrão: voltar ao padrão apaga a entrada em vez de gravar
      // uma cópia dele, e é o que mantém `instructions` legível.
      if (isDefaultInstruction(updated)) delete plan.instructions[this.selectedSlot];
      else plan.instructions[this.selectedSlot] = updated;
      this.commit(plan);
    }
  }

  /** Deslizar um eixo não repinta: repintar trocaria o input debaixo do dedo. */
  private onSlide(event: Event): void {
    const axis = (event.target as HTMLElement).closest<HTMLInputElement>("[data-axis]");
    if (!axis) return;
    const plan = this.source.plan();
    const key = axis.dataset.axis as keyof TacticalMentality;
    plan.mentality[key] = Number(axis.value);
    const readout = this.host.querySelector(`[data-axis-value="${key}"]`);
    if (readout) readout.textContent = axis.value;
    this.commit(plan);
  }

  private commit(plan: TeamTacticalPlan): void {
    this.source.changed(plan);
  }

  private autoPick(): void {
    const plan = this.source.plan();
    const formation = (plan.formationId ? findFormation(plan.formationId) : null) ?? defaultFormation();
    Object.assign(plan, autoPickPlan(this.source.squad(), formation, plan));
    this.commit(plan);
    this.render();
  }
}
