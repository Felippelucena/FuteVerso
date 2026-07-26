import type { GameApplication } from "../../application/game-application";
import { find, findAll } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon, type IconName } from "../app/icons";
import type { Navigation, Screen, ScreenDefinition } from "../app/screen";

/**
 * Entidades editáveis. Cada uma vira uma aba; acrescentar Estádio ou Competição é acrescentar
 * uma entrada aqui e o descritor correspondente — o editor não conhece nenhuma pelo nome.
 */
export interface EditorEntity {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly mount: (root: HTMLElement, application: GameApplication) => Screen;
}

const editorTemplate = (entities: readonly EditorEntity[]) => (): Html => html`
  <section data-screen="editor" class="editor-view">
    <nav class="entity-tabs" aria-label="Entidades do editor">
      ${entities.map((entity) => html`<button type="button" data-entity="${entity.id}">${icon(entity.icon)}${entity.label}</button>`)}
    </nav>
    <div class="entity-host" id="entity-host"></div>
  </section>`;

export const editorScreenDefinition = (
  application: GameApplication,
  entities: readonly EditorEntity[],
): ScreenDefinition => ({
  id: "editor",
  label: "Editor",
  icon: "Pencil",
  template: editorTemplate(entities),
  mount: ({ root, params, navigation }) => new EditorScreen(root, params, navigation, application, entities),
});

export class EditorScreen implements Screen {
  private readonly active: EditorEntity;
  private readonly entityScreen: Screen;

  constructor(
    root: HTMLElement,
    params: Readonly<Record<string, string>>,
    navigation: Navigation,
    application: GameApplication,
    entities: readonly EditorEntity[],
  ) {
    this.active = entities.find(({ id }) => id === params.entity) ?? entities[0];
    for (const tab of findAll<HTMLButtonElement>(root, "[data-entity]")) {
      const entityId = tab.dataset.entity!;
      tab.classList.toggle("is-active", entityId === this.active.id);
      // `replace`, não `push`: trocar de aba não é descer um nível, e voltar deve ir ao menu.
      tab.addEventListener("click", () => navigation.replace({ screenId: "editor", params: { entity: entityId } }));
    }
    this.entityScreen = this.active.mount(find<HTMLElement>(root, "#entity-host"), application);
  }

  render(): void {
    this.entityScreen.render();
  }
}
