import type { PageQuery, SortDirection } from "../../application/ports/catalog";
import { find, render } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon } from "../app/icons";
import type { Column, EntityDescriptor } from "./entity";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 220;

export interface DataTableHandlers {
  onEdit(id: string): void;
  onRemove(id: string): void;
}

const template = (descriptor: EntityDescriptor<unknown, unknown>): Html => html`
  <div class="data-table">
    <div class="data-table-bar">
      ${descriptor.searchField
        ? html`<input class="data-search" type="search" data-role="search" placeholder="${descriptor.searchPlaceholder ?? "Buscar"}" aria-label="Buscar ${descriptor.label}" />`
        : ""}
      <span class="data-total" data-role="total"></span>
    </div>
    <div class="data-head" data-role="head" role="row"></div>
    <div class="data-body" data-role="body"></div>
    <div class="pager">
      <button class="secondary-button" data-role="previous" type="button">${icon("ChevronLeft")}Anterior</button>
      <span data-role="page-label"></span>
      <button class="secondary-button" data-role="next" type="button">Próxima${icon("ChevronRight")}</button>
    </div>
  </div>`;

/**
 * Tabela paginada e ordenável. Não conhece entidade nenhuma: recebe as colunas e a função que
 * carrega uma página. Ordenar e filtrar acontecem no banco, então o custo de exibir não cresce
 * com o tamanho do catálogo — só a página atravessa.
 */
export class DataTable<TRow> {
  private sort: string;
  private direction: SortDirection;
  private page = 0;
  private search = "";
  private searchTimer: number | null = null;
  /** Descarta a resposta de uma consulta que já não é a atual. */
  private request = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly descriptor: EntityDescriptor<TRow, unknown>,
    private readonly handlers: DataTableHandlers,
  ) {
    render(root, template(descriptor as EntityDescriptor<unknown, unknown>));
    this.sort = descriptor.defaultSort.field;
    this.direction = descriptor.defaultSort.direction;
    this.bind();
    this.renderHead();
  }

  reload(): void {
    void this.load();
  }

  /** Volta ao início — depois de criar algo, a linha nova pode estar em qualquer página. */
  reset(): void {
    this.page = 0;
    this.reload();
  }

  private bind(): void {
    this.at("head").addEventListener("click", (event) => {
      const header = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sort]");
      if (header) this.toggleSort(header.dataset.sort!);
    });
    this.at("body").addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const edit = target.closest<HTMLButtonElement>("[data-edit]");
      if (edit) this.handlers.onEdit(edit.dataset.edit!);
      const remove = target.closest<HTMLButtonElement>("[data-remove]");
      if (remove) this.handlers.onRemove(remove.dataset.remove!);
    });
    this.at("previous").addEventListener("click", () => this.turn(-1));
    this.at("next").addEventListener("click", () => this.turn(1));
    if (!this.descriptor.searchField) return;
    this.at("search").addEventListener("input", (event) => {
      const value = (event.currentTarget as HTMLInputElement).value.trim();
      // Espera o usuário parar de digitar: cada tecla dispararia uma consulta ao banco.
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.search = value;
        this.page = 0;
        this.reload();
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  private toggleSort(field: string): void {
    if (this.sort === field) this.direction = this.direction === "asc" ? "desc" : "asc";
    else {
      this.sort = field;
      this.direction = "asc";
    }
    this.page = 0;
    this.renderHead();
    this.reload();
  }

  private renderHead(): void {
    const columns = this.descriptor.columns;
    this.root.style.setProperty("--columns", `${columns.map((column) => column.width).join(" ")} auto`);
    render(this.at("head"), html`
      ${columns.map((column) => {
        if (!column.sort) return html`<span class="${column.align === "end" ? "is-end" : ""}">${column.label}</span>`;
        const active = column.sort === this.sort;
        return html`<button type="button" data-sort="${column.sort}"
          class="${active ? "is-sorted" : ""} ${column.align === "end" ? "is-end" : ""}"
          aria-sort="${active ? (this.direction === "asc" ? "ascending" : "descending") : "none"}"
        >${column.label}${active ? html`<em>${this.direction === "asc" ? "▲" : "▼"}</em>` : ""}</button>`;
      })}
      <span></span>`);
  }

  private async load(): Promise<void> {
    const token = ++this.request;
    this.root.classList.add("is-loading");
    const column = this.descriptor.columns.find(({ sort }) => sort === this.sort);
    const query: PageQuery = {
      sort: this.sort,
      // A coluna manda inverter quando o campo gravado cresce ao contrário do que ela mostra.
      direction: column?.invert ? (this.direction === "asc" ? "desc" : "asc") : this.direction,
      offset: this.page * PAGE_SIZE,
      limit: PAGE_SIZE,
      filter: this.search && this.descriptor.searchField
        ? { field: this.descriptor.searchField, value: this.search, match: "prefix" }
        : undefined,
    };
    const { rows, total } = await this.descriptor.page(query);
    if (token !== this.request) return;
    this.root.classList.remove("is-loading");

    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    this.at("total").textContent = `${total} ${total === 1 ? this.descriptor.singular.toLowerCase() : this.descriptor.label.toLowerCase()}`;
    this.at("page-label").textContent = `${this.page + 1} / ${pages}`;
    this.at<HTMLButtonElement>("previous").disabled = this.page === 0;
    this.at<HTMLButtonElement>("next").disabled = this.page + 1 >= pages;
    this.renderRows(rows as TRow[]);
  }

  private renderRows(rows: readonly TRow[]): void {
    if (rows.length === 0) {
      render(this.at("body"), html`<p class="data-empty">Nada por aqui ainda.</p>`);
      return;
    }
    render(this.at("body"), html`${rows.map((row) => {
      const id = this.descriptor.idOf(row);
      const label = this.descriptor.labelOf(row);
      return html`<div class="data-row" role="row">
        ${this.descriptor.columns.map((column: Column<TRow>) =>
          html`<span class="${column.align === "end" ? "is-end" : ""}">${column.render(row)}</span>`)}
        <span class="row-actions">
          <button class="icon-button" type="button" data-edit="${id}" aria-label="Editar ${label}" title="Editar">${icon("Pencil")}</button>
          <button class="icon-button icon-button--danger" type="button" data-remove="${id}" aria-label="Excluir ${label}" title="Excluir">${icon("Trash2")}</button>
        </span>
      </div>`;
    })}`);
  }

  private turn(delta: number): void {
    this.page = Math.max(0, this.page + delta);
    this.reload();
  }

  private at<T extends HTMLElement>(role: string): T {
    return find<T>(this.root, `[data-role="${role}"]`);
  }
}
