import { html, type Html } from "../app/html";

/** Campos de formulário do editor. Compartilhados porque toda entidade usa os mesmos. */

export const textField = (name: string, label: string, value: string, attributes: Html = html``): Html => html`
  <label class="field"><span>${label}</span><input name="${name}" value="${value}"${attributes} /></label>`;

export const numberField = (
  name: string,
  label: string,
  value: number,
  range: { minimum: number; maximum: number },
): Html => html`
  <label class="field"><span>${label}</span>
    <input name="${name}" type="number" min="${range.minimum}" max="${range.maximum}" value="${value}" required />
  </label>`;

export const selectField = (
  name: string,
  label: string,
  value: string,
  options: readonly { value: string; label: string }[],
): Html => html`
  <label class="field"><span>${label}</span>
    <select name="${name}">${options.map((option) => html`
      <option value="${option.value}" ${option.value === value ? html`selected` : ""}>${option.label}</option>`)}
    </select>
  </label>`;

export const colorField = (name: string, label: string, value: string): Html => html`
  <label class="field field--color"><span>${label}</span>
    <input name="${name}" type="color" value="${value}" />
  </label>`;

/** Lê um número do formulário, caindo no padrão quando o campo está vazio ou inválido. */
export const readNumber = (data: FormData, name: string, fallback: number): number => {
  const value = Number(data.get(name));
  return Number.isFinite(value) ? value : fallback;
};

export const readText = (data: FormData, name: string, fallback = ""): string => {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : fallback;
};
