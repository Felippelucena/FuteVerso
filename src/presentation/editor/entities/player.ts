import type { GameApplication } from "../../../application/game-application";
import type { PageQuery } from "../../../application/ports/catalog";
import { COUNTRIES, countryName } from "../../../content/countries";
import { activeContractOf } from "../../../domain/contract/queries";
import type {
  PlayerMentalAttributes, PlayerPosition, PlayerProfile, PlayerRole, PlayerSkills,
} from "../../../domain/roster/model";
import {
  createMentalAttributes, dominantMentalTraits, MENTAL_PRESET_LABELS, MENTAL_PRESETS, type MentalPreset,
} from "../../../domain/roster/personality";
import { PLAYER_POSITIONS } from "../../../domain/roster/positions";
import { playerOverall } from "../../../domain/roster/rating";
import { playerAge } from "../../../domain/roster/rules";
import { findAll } from "../../app/dom";
import { html } from "../../app/html";
import { POSITION_LABELS, POSITION_SHORT_LABELS, ROLE_LABELS } from "../../app/labels";
import type { EntityDescriptor } from "../entity";
import { numberField, readNumber, readText, selectField, textField } from "../fields";

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

const SCALE = { minimum: 1, maximum: 100 } as const;
const DEFAULT_AGE = 24;
export const FREE_AGENT_LABEL = "Sem clube";

export interface PlayerRow {
  player: PlayerProfile;
  shirtNumber: number | null;
  clubName: string;
  age: number;
  overall: number;
}

interface PlayerDraft {
  player: PlayerProfile;
  creating: boolean;
}

const blankPlayer = (currentYear: number): PlayerProfile => ({
  id: crypto.randomUUID?.() ?? `player-${Date.now()}`,
  name: "",
  nationality: "BR",
  birthYear: currentYear - DEFAULT_AGE,
  position: "centerMid",
  secondaryPositions: [],
  role: "playmaker",
  skills: Object.fromEntries(SKILL_FIELDS.map(({ key }) => [key, 65])) as unknown as PlayerSkills,
  mental: createMentalAttributes("balanced"),
});

export const playerDescriptor = (application: GameApplication): EntityDescriptor<PlayerRow, PlayerDraft> => ({
  id: "players",
  label: "Jogadores",
  singular: "Jogador",
  icon: "Users",
  defaultSort: { field: "name", direction: "asc" },
  searchField: "name",
  searchPlaceholder: "Buscar por nome",

  columns: [
    { label: "#", width: "38px", render: ({ shirtNumber }) => html`<span class="shirt shirt--neutral">${shirtNumber ?? "–"}</span>` },
    { label: "Nome", sort: "name", width: "minmax(0, 2fr)", render: ({ player }) => html`<strong>${player.name}</strong>` },
    { label: "Clube", width: "minmax(0, 1.4fr)", render: ({ clubName }) => html`${clubName}` },
    {
      label: "Pos.", sort: "position", width: "92px",
      render: ({ player }) => {
        const secondary = player.secondaryPositions.map((position) => POSITION_SHORT_LABELS[position]).join("/");
        return html`${POSITION_SHORT_LABELS[player.position]}${secondary ? html` <em>(${secondary})</em>` : ""}`;
      },
    },
    { label: "Função", width: "94px", render: ({ player }) => html`${ROLE_LABELS[player.role]}` },
    // Idade cresce quando o ano de nascimento diminui; a coluna inverte para que "crescente"
    // signifique o que o cabeçalho mostra.
    { label: "Idade", sort: "birthYear", invert: true, width: "62px", align: "end", render: ({ age }) => html`${age}` },
    { label: "País", sort: "nationality", width: "104px", render: ({ player }) => html`${countryName(player.nationality)}` },
    { label: "GER", sort: "overall", width: "56px", align: "end", render: ({ overall }) => html`<strong>${overall}</strong>` },
  ],

  async page(query: PageQuery) {
    const { queries, settings } = application;
    const { rows, total } = await queries.players.page(query);
    // A junção com o contrato acontece sobre a página — dezenas de registros, não o catálogo.
    const contracts = await Promise.all(rows.map(async (player) => {
      const found = await queries.contracts.page({ filter: { field: "playerId", value: player.id } });
      return activeContractOf([...found.rows], player.id);
    }));
    const clubIds = [...new Set(contracts.flatMap((contract) => contract ? [contract.clubId] : []))];
    const clubsById = new Map((await queries.clubs.getMany(clubIds)).map((club) => [club.id, club]));
    return {
      total,
      rows: rows.map((player, index) => ({
        player,
        shirtNumber: contracts[index]?.shirtNumber ?? null,
        clubName: contracts[index] ? clubsById.get(contracts[index]!.clubId)?.name ?? FREE_AGENT_LABEL : FREE_AGENT_LABEL,
        age: playerAge(player, settings.currentYear),
        overall: playerOverall(player),
      })),
    };
  },

  async draft(id) {
    if (id === null) return { player: blankPlayer(application.settings.currentYear), creating: true };
    const player = await application.queries.players.get(id);
    return { player: player ?? blankPlayer(application.settings.currentYear), creating: player === null };
  },

  tabs: [
    {
      id: "identity",
      label: "Dados",
      render: ({ player }) => {
        const currentYear = application.settings.currentYear;
        return html`
          <div class="field-grid field-grid--identity">
            ${textField("name", "Nome", player.name, html` maxlength="32" required`)}
            ${numberField("age", "Idade", currentYear - player.birthYear, { minimum: 15, maximum: 45 })}
            ${selectField("nationality", "Nacionalidade", player.nationality,
              COUNTRIES.map((country) => ({ value: country.code, label: country.name })))}
            ${selectField("position", "Posição", player.position, PLAYER_POSITIONS
              .map((position) => ({ value: position, label: `${POSITION_SHORT_LABELS[position]} · ${POSITION_LABELS[position]}` })))}
            ${selectField("role", "Função", player.role,
              Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })))}
          </div>
          <div class="field-heading"><strong>Posições secundárias</strong><span>onde atua sem improviso</span></div>
          <div class="checkbox-grid">
            ${PLAYER_POSITIONS.filter((position) => position !== "goalkeeper").map((position) => html`
              <label class="checkbox-chip">
                <input type="checkbox" name="secondary" value="${position}"
                  ${player.secondaryPositions.includes(position) ? html`checked` : ""}
                  ${position === player.position ? html`disabled` : ""} />
                <span>${POSITION_SHORT_LABELS[position]}</span>
              </label>`)}
          </div>`;
      },
      bind: ({ panel, refresh }) => {
        // Trocar a posição principal muda quem pode ser secundária e trava a função do goleiro.
        panel.addEventListener("change", (event) => {
          if ((event.target as HTMLElement).getAttribute("name") === "position") refresh();
        });
      },
      collect: ({ panel, draft, data }) => {
        const position = String(data.get("position")) as PlayerPosition;
        const age = readNumber(data, "age", DEFAULT_AGE);
        draft.player = {
          ...draft.player,
          name: readText(data, "name"),
          nationality: readText(data, "nationality", "BR"),
          birthYear: application.settings.currentYear - age,
          position,
          // Goleiro não acumula posição de linha, e ninguém é secundário na própria posição.
          secondaryPositions: position === "goalkeeper" ? [] : findAll<HTMLInputElement>(panel, "[name=\"secondary\"]")
            .filter((input) => input.checked)
            .map((input) => input.value as PlayerPosition)
            .filter((secondary) => secondary !== position),
          role: position === "goalkeeper" ? "defender" : String(data.get("role")) as PlayerRole,
        };
      },
    },
    {
      id: "skills",
      label: "Atributos",
      render: ({ player }) => html`
        <div class="field-heading"><strong>Atributos</strong><span>1–100</span></div>
        <div class="field-grid field-grid--scale">
          ${SKILL_FIELDS.map(({ key, label }) => numberField(key, label, player.skills[key], SCALE))}
        </div>`,
      collect: ({ draft, data }) => {
        draft.player = {
          ...draft.player,
          skills: Object.fromEntries(SKILL_FIELDS
            .map(({ key }) => [key, readNumber(data, key, 65)])) as unknown as PlayerSkills,
        };
      },
    },
    {
      id: "mental",
      label: "Personalidade",
      render: ({ player }) => html`
        <div class="field-heading"><strong>Personalidade</strong><span>${dominantMentalTraits(player.mental).join(" / ")}</span></div>
        ${selectField("mentalPreset", "Preset mental", "custom", [
          ...Object.entries(MENTAL_PRESET_LABELS).map(([value, label]) => ({ value, label })),
          { value: "custom", label: "Personalizado" },
        ])}
        <div class="field-grid field-grid--scale">
          ${MENTAL_FIELDS.map(({ key, label }) => numberField(`mental-${key}`, label, player.mental[key], SCALE))}
        </div>`,
      bind: ({ panel }) => {
        // Escreve nos campos em vez de mexer no rascunho e repintar: `refresh` recolhe o
        // formulário antes de redesenhar, e o preset recém-aplicado seria sobrescrito.
        panel.addEventListener("change", (event) => {
          const target = event.target as HTMLSelectElement;
          if (target.getAttribute("name") !== "mentalPreset" || target.value === "custom") return;
          const values = MENTAL_PRESETS[target.value as MentalPreset];
          for (const { key } of MENTAL_FIELDS) {
            const input = panel.querySelector<HTMLInputElement>(`[name="mental-${key}"]`);
            if (input) input.value = String(values[key]);
          }
        });
      },
      collect: ({ draft, data }) => {
        draft.player = {
          ...draft.player,
          mental: Object.fromEntries(MENTAL_FIELDS
            .map(({ key }) => [key, readNumber(data, `mental-${key}`, 65)])) as unknown as PlayerMentalAttributes,
        };
      },
    },
  ],

  save: ({ player }) => application.savePlayer(player),
  remove: (id) => application.deletePlayer(id),
  labelOf: ({ player }) => player.name,
  idOf: ({ player }) => player.id,
});
