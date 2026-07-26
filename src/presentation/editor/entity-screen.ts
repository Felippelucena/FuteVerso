import { find, render } from "../app/dom";
import { html } from "../app/html";
import { icon } from "../app/icons";
import type { Screen } from "../app/screen";
import { DataTable } from "./data-table";
import type { EntityDescriptor } from "./entity";
import { EntityModal } from "./entity-modal";

/** Lista mais modal, para qualquer entidade. Montada uma vez por descritor. */
export class EntityScreen<TRow, TDraft> implements Screen {
  private readonly table: DataTable<TRow>;
  private readonly modal: EntityModal<TRow, TDraft>;

  constructor(
    private readonly host: HTMLElement,
    private readonly descriptor: EntityDescriptor<TRow, TDraft>,
  ) {
    render(host, html`
      <div class="entity-view">
        <div class="manager-heading">
          <div><span class="eyebrow">CATÁLOGO</span><h2>${descriptor.label}</h2></div>
          <button class="primary-button" type="button" data-role="create">${icon("Plus")}Novo ${descriptor.singular.toLowerCase()}</button>
        </div>
        <p class="manager-message" data-role="message" aria-live="polite"></p>
        <div data-role="table"></div>
      </div>`);

    this.modal = new EntityModal(host, descriptor, () => {
      this.setMessage(`${descriptor.singular} salvo.`);
      this.table.reset();
    });
    this.table = new DataTable(find<HTMLElement>(host, "[data-role=\"table\"]"), descriptor, {
      onEdit: (id) => void this.modal.open(id),
      onRemove: (id) => this.remove(id),
    });
    find(host, "[data-role=\"create\"]").addEventListener("click", () => void this.modal.open(null));
  }

  render(): void {
    this.table.reload();
  }

  private remove(id: string): void {
    void this.descriptor.remove(id).then((result) => {
      if (!result.ok) {
        this.setMessage("Não foi possível excluir.", true);
        return;
      }
      this.setMessage(`${this.descriptor.singular} excluído.`);
      this.table.reload();
    });
  }

  private setMessage(message: string, error = false): void {
    const element = find<HTMLElement>(this.host, "[data-role=\"message\"]");
    element.textContent = message;
    element.classList.toggle("is-error", error);
  }
}
