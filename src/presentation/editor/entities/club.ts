import type { GameApplication } from "../../../application/game-application";
import type { PageQuery } from "../../../application/ports/catalog";
import { COUNTRIES, countryName } from "../../../content/countries";
import type { Club } from "../../../domain/club/model";
import { FOUNDED_YEAR_RANGE } from "../../../domain/club/rules";
import type { Contract, ContractStatus } from "../../../domain/contract/model";
import { nextFreeShirtNumber } from "../../../domain/contract/queries";
import type { PlayerProfile } from "../../../domain/roster/model";
import { playerOverall } from "../../../domain/roster/rating";
import { NEUTRAL_MENTALITY } from "../../../domain/tactics/model";
import { createEmptyPlan } from "../../../domain/tactics/rules";
import { PRESS_TRIGGERS } from "../../../domain/tactics/vocabulary";
import { html } from "../../app/html";
import { icon } from "../../app/icons";
import { POSITION_SHORT_LABELS } from "../../app/labels";
import type { EntityDescriptor } from "../entity";
import { colorField, numberField, readNumber, readText, selectField, textField } from "../fields";

const STATUS_LABELS: Record<ContractStatus, string> = {
  active: "Ativo",
  loan: "Empréstimo",
  expired: "Encerrado",
};

export interface ClubRow {
  club: Club;
  squadSize: number;
}

/**
 * Rascunho do clube. Não é um `Club`: a aba de elenco edita vínculos, então o que o modal
 * carrega é o agregado. Cancelar descarta os três juntos; Salvar comita numa transação só.
 */
interface ClubDraft {
  club: Club;
  contracts: Contract[];
  squad: PlayerProfile[];
  removedContractIds: string[];
  /** Jogadores livres oferecidos na busca de contratação. */
  candidates: PlayerProfile[];
  candidateQuery: string;
  /** Clube que ainda não existe no banco: gerar elenco precisa dele gravado antes. */
  creating: boolean;
}

const blankClub = (): Club => ({
  id: crypto.randomUUID?.() ?? `club-${Date.now()}`,
  name: "",
  shortName: "",
  nickname: "",
  nationality: "BR",
  city: "",
  colors: { primary: "#1d4ed8", secondary: "#f8fafc", text: "#ffffff" },
  founded: 1950,
  reputation: 50,
  defaultPlan: { ...createEmptyPlan(), mentality: { ...NEUTRAL_MENTALITY }, pressTriggers: [...PRESS_TRIGGERS] },
});

export const clubDescriptor = (application: GameApplication): EntityDescriptor<ClubRow, ClubDraft> => {
  const loadSquad = async (clubId: string) => application.squadOfClub(clubId);

  const CANDIDATES = 12;
  const SCAN_PAGE = 40;
  const SCAN_LIMIT = 5;

  /**
   * Agentes livres oferecidos para contratação. "Livre" não é indexável — depende de não haver
   * contrato —, então o catálogo é varrido por páginas até juntar o suficiente. O teto existe
   * para não percorrer um mundo grande inteiro; quem procura alguém específico usa a busca.
   */
  const refreshCandidates = async (draft: ClubDraft): Promise<void> => {
    const inDraft = new Set(draft.contracts.map((contract) => contract.playerId));
    const released = new Set(draft.removedContractIds);
    const found: PlayerProfile[] = [];

    for (let scan = 0; scan < SCAN_LIMIT && found.length < CANDIDATES; scan += 1) {
      const { rows, total } = await application.queries.players.page({
        sort: "name",
        offset: scan * SCAN_PAGE,
        limit: SCAN_PAGE,
        filter: draft.candidateQuery ? { field: "name", value: draft.candidateQuery, match: "prefix" } : undefined,
      });
      if (rows.length === 0) break;
      const contracts = await Promise.all(rows.map(async (player) => {
        const result = await application.queries.contracts.page({ filter: { field: "playerId", value: player.id } });
        return result.rows;
      }));
      rows.forEach((player, index) => {
        if (found.length >= CANDIDATES || inDraft.has(player.id)) return;
        // Dispensado neste rascunho conta como livre: o vínculo ainda está no banco, mas o
        // usuário já o desfez na tela, e recontratar sem salvar antes precisa funcionar.
        const bound = contracts[index].some((contract) => contract.status !== "expired" && !released.has(contract.id));
        if (!bound) found.push(player);
      });
      if ((scan + 1) * SCAN_PAGE >= total) break;
    }
    draft.candidates = found;
  };

  return {
    id: "clubs",
    label: "Clubes",
    singular: "Clube",
    icon: "Shield",
    defaultSort: { field: "name", direction: "asc" },
    searchField: "name",
    searchPlaceholder: "Buscar por nome",

    columns: [
      {
        label: "", width: "30px",
        render: ({ club }) => html`<span class="club-crest" style="--crest:${club.colors.primary};--crest-alt:${club.colors.secondary}"></span>`,
      },
      { label: "Sigla", width: "58px", render: ({ club }) => html`<strong>${club.shortName}</strong>` },
      { label: "Nome", sort: "name", width: "minmax(0, 2fr)", render: ({ club }) => html`${club.name}` },
      { label: "Cidade", width: "minmax(0, 1fr)", render: ({ club }) => html`${club.city}` },
      { label: "País", sort: "nationality", width: "104px", render: ({ club }) => html`${countryName(club.nationality)}` },
      { label: "Rep.", sort: "reputation", width: "58px", align: "end", render: ({ club }) => html`${club.reputation}` },
      { label: "Elenco", width: "68px", align: "end", render: ({ squadSize }) => html`${squadSize}` },
    ],

    async page(query: PageQuery) {
      const { rows, total } = await application.queries.clubs.page(query);
      const sizes = await Promise.all(rows.map(async (club) => {
        const found = await application.queries.contracts.page({ filter: { field: "clubId", value: club.id } });
        return found.rows.filter((contract) => contract.status !== "expired").length;
      }));
      return { total, rows: rows.map((club, index) => ({ club, squadSize: sizes[index] })) };
    },

    async draft(id) {
      const club = id === null ? blankClub() : (await application.queries.clubs.get(id)) ?? blankClub();
      const squad = id === null ? { players: [], contracts: [] } : await loadSquad(club.id);
      const draft: ClubDraft = {
        club,
        contracts: squad.contracts,
        squad: squad.players,
        removedContractIds: [],
        candidates: [],
        candidateQuery: "",
        creating: id === null,
      };
      await refreshCandidates(draft);
      return draft;
    },

    tabs: [
      {
        id: "identity",
        label: "Dados",
        render: ({ club }) => html`
          <div class="field-grid field-grid--identity">
            ${textField("name", "Nome", club.name, html` maxlength="40" required`)}
            ${textField("shortName", "Sigla", club.shortName, html` maxlength="3" minlength="3" required`)}
            ${textField("city", "Cidade", club.city, html` maxlength="32"`)}
            ${selectField("nationality", "Nacionalidade", club.nationality,
              COUNTRIES.map((country) => ({ value: country.code, label: country.name })))}
          </div>
          <div class="field-grid field-grid--identity">
            ${textField("nickname", "Apelido", club.nickname, html` maxlength="32"`)}
            ${numberField("founded", "Fundação", club.founded, FOUNDED_YEAR_RANGE)}
            ${numberField("reputation", "Reputação", club.reputation, { minimum: 1, maximum: 100 })}
          </div>
          <div class="field-heading"><strong>Uniforme</strong><span>dominante, secundária e texto</span></div>
          <div class="field-grid field-grid--colors">
            ${colorField("primary", "Dominante", club.colors.primary)}
            ${colorField("secondary", "Secundária", club.colors.secondary)}
            ${colorField("text", "Texto", club.colors.text)}
          </div>`,
        collect: ({ draft, data }) => {
          draft.club = {
            ...draft.club,
            name: readText(data, "name"),
            shortName: readText(data, "shortName").toUpperCase(),
            nickname: readText(data, "nickname"),
            city: readText(data, "city"),
            nationality: readText(data, "nationality", "BR"),
            founded: readNumber(data, "founded", 1950),
            reputation: readNumber(data, "reputation", 50),
            colors: {
              primary: readText(data, "primary", "#1d4ed8"),
              secondary: readText(data, "secondary", "#f8fafc"),
              text: readText(data, "text", "#ffffff"),
            },
          };
        },
      },
      {
        id: "squad",
        label: "Elenco",
        render: (draft) => {
          const byId = new Map(draft.squad.map((player) => [player.id, player]));
          return html`
            <div class="field-heading">
              <strong>Elenco</strong>
              ${draft.creating
                ? html`<span>salve o clube para poder gerar um elenco</span>`
                : html`<button type="button" class="secondary-button" data-action="generate">${icon("Wand2")}Gerar elenco</button>`}
            </div>
            <div class="squad-list">
              ${draft.contracts.length === 0
                ? html`<p class="data-empty">Sem vínculos. Contrate ou gere um elenco.</p>`
                : html`<div class="squad-head"><span>#</span><span>Jogador</span><span>Vínculo</span><span>Início</span><span>Fim</span><span>Salário</span><span></span></div>`}
              ${draft.contracts.map((contract) => {
                const player = byId.get(contract.playerId);
                const name = player?.name ?? "—";
                // Campos sem rótulo próprio: quem nomeia a coluna é o cabeçalho, uma vez só.
                const field = (kind: string, label: string, value: number) => html`
                  <input name="${kind}-${contract.id}" type="number" min="0" value="${value}" aria-label="${label} de ${name}" />`;
                return html`<div class="squad-row" data-contract="${contract.id}">
                  <input class="squad-shirt" name="shirt-${contract.id}" type="number" min="1" max="99" value="${contract.shirtNumber}" aria-label="Camisa de ${name}" />
                  <span class="squad-name"><strong>${name}</strong>
                    <em>${player ? POSITION_SHORT_LABELS[player.position] : ""} · GER ${player ? playerOverall(player) : "—"}</em></span>
                  <select name="status-${contract.id}" aria-label="Vínculo de ${name}">
                    ${Object.entries(STATUS_LABELS).map(([value, label]) => html`
                      <option value="${value}" ${value === contract.status ? html`selected` : ""}>${label}</option>`)}
                  </select>
                  ${field("start", "Início", contract.startYear)}
                  ${field("end", "Fim", contract.endYear)}
                  ${field("wage", "Salário", contract.wage)}
                  <button type="button" class="icon-button icon-button--danger" data-release="${contract.id}"
                    aria-label="Dispensar ${name}" title="Dispensar">${icon("Trash2")}</button>
                </div>`;
              })}
            </div>
            <div class="field-heading"><strong>Contratar</strong><span>agentes livres</span></div>
            <input class="data-search" data-action="candidate-search" type="search" value="${draft.candidateQuery}" placeholder="Buscar jogador livre" aria-label="Buscar jogador livre" />
            <div class="candidate-list">
              ${draft.candidates.length === 0 ? html`<p class="data-empty">Nenhum agente livre encontrado.</p>` : ""}
              ${draft.candidates.map((player) => html`
                <button type="button" class="candidate" data-sign="${player.id}">
                  ${icon("Plus")}<strong>${player.name}</strong>
                  <em>${POSITION_SHORT_LABELS[player.position]} · GER ${playerOverall(player)} · ${countryName(player.nationality)}</em>
                </button>`)}
            </div>`;
        },
        bind: ({ panel, draft: currentDraft, refresh }) => {
          panel.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const draft = currentDraft();

            const release = target.closest<HTMLButtonElement>("[data-release]");
            if (release) {
              const id = release.dataset.release!;
              // Vínculo que nunca chegou ao banco não precisa de remoção lá.
              if (!id.startsWith("draft-")) draft.removedContractIds.push(id);
              draft.contracts = draft.contracts.filter((contract) => contract.id !== id);
              refresh();
              void refreshCandidates(draft).then(refresh);
              return;
            }

            const sign = target.closest<HTMLButtonElement>("[data-sign]");
            if (sign) {
              const player = draft.candidates.find(({ id }) => id === sign.dataset.sign);
              if (!player) return;
              draft.contracts = [...draft.contracts, {
                id: `draft-${player.id}`,
                playerId: player.id,
                clubId: draft.club.id,
                shirtNumber: nextFreeShirtNumber(draft.contracts, draft.club.id),
                startYear: application.settings.currentYear,
                endYear: application.settings.currentYear + 2,
                wage: 1000,
                status: "active",
              }];
              draft.squad = [...draft.squad, player];
              draft.candidates = draft.candidates.filter(({ id }) => id !== player.id);
              refresh();
              return;
            }

            if (target.closest("[data-action=\"generate\"]")) {
              // Gerar mexe no catálogo direto: é criação em massa, não edição de rascunho.
              void application.generateSquadFor(draft.club.id, application.settings.randomSeed)
                .then(() => loadSquad(draft.club.id))
                .then((squad) => {
                  draft.contracts = squad.contracts;
                  draft.squad = squad.players;
                  draft.removedContractIds = [];
                  refresh();
                });
            }
          });

          panel.addEventListener("input", (event) => {
            const search = (event.target as HTMLElement).closest<HTMLInputElement>("[data-action=\"candidate-search\"]");
            if (!search) return;
            const draft = currentDraft();
            draft.candidateQuery = search.value.trim();
            void refreshCandidates(draft).then(refresh);
          });
        },
        collect: ({ panel, draft }) => {
          draft.contracts = draft.contracts.map((contract) => {
            const row = panel.querySelector<HTMLElement>(`[data-contract="${contract.id}"]`);
            if (!row) return contract;
            const value = (name: string, fallback: number): number => {
              const input = row.querySelector<HTMLInputElement>(`[name="${name}-${contract.id}"]`);
              const parsed = Number(input?.value);
              return Number.isFinite(parsed) ? parsed : fallback;
            };
            const status = row.querySelector<HTMLSelectElement>(`[name="status-${contract.id}"]`)?.value;
            return {
              ...contract,
              shirtNumber: value("shirt", contract.shirtNumber),
              startYear: value("start", contract.startYear),
              endYear: value("end", contract.endYear),
              wage: value("wage", contract.wage),
              status: (status as ContractStatus) ?? contract.status,
            };
          });
          // Só agora o vínculo de rascunho ganha identidade definitiva.
          draft.contracts = draft.contracts.map((contract) => contract.id.startsWith("draft-")
            ? { ...contract, id: `contract-${contract.playerId}` }
            : contract);
        },
      },
    ],

    save: (draft) => application.saveClub(draft.club, draft.contracts, draft.removedContractIds),
    remove: (id) => application.deleteClub(id),
    labelOf: ({ club }) => club.name,
    idOf: ({ club }) => club.id,
  };
};
