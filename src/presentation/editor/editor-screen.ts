import type { GameApplication } from "../../application/game-application";
import { find, findAll } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon } from "../app/icons";
import type { Navigation, Screen, ScreenDefinition } from "../app/screen";
import { clubDescriptor } from "./entities/club";
import { playerDescriptor } from "./entities/player";
import type { EntityDescriptor } from "./entity";
import { EntityScreen } from "./entity-screen";

/**
 * Entidades editáveis. Acrescentar Estádio ou Competição é acrescentar um descritor a esta
 * lista — a tela, a tabela e o modal não conhecem nenhuma pelo nome.
 */
const descriptors = (application: GameApplication): EntityDescriptor<never, never>[] => [
  clubDescriptor(application),
  playerDescriptor(application),
] as unknown as EntityDescriptor<never, never>[];

const editorTemplate = (entities: readonly EntityDescriptor<never, never>[]) => (): Html => html`
  <section data-screen="editor" class="editor-view">
    <nav class="entity-tabs" aria-label="Entidades do editor">
      ${entities.map((entity) => html`<button type="button" data-entity="${entity.id}">${icon(entity.icon)}${entity.label}</button>`)}
    </nav>
    <div class="entity-host" id="entity-host"></div>
  </section>`;

export const editorScreenDefinition = (application: GameApplication): ScreenDefinition => {
  const entities = descriptors(application);
  return {
    id: "editor",
    label: "Editor",
    icon: "Pencil",
    template: editorTemplate(entities),
    mount: ({ root, params, navigation }) => new EditorScreen(root, params, navigation, entities),
  };
};

export class EditorScreen implements Screen {
  private readonly entityScreen: Screen;

  constructor(
    root: HTMLElement,
    params: Readonly<Record<string, string>>,
    navigation: Navigation,
    entities: readonly EntityDescriptor<never, never>[],
  ) {
    const active = entities.find(({ id }) => id === params.entity) ?? entities[0];
    for (const tab of findAll<HTMLButtonElement>(root, "[data-entity]")) {
      const entityId = tab.dataset.entity!;
      tab.classList.toggle("is-active", entityId === active.id);
      // `replace`, não `push`: trocar de aba não é descer um nível, e voltar deve ir ao menu.
      tab.addEventListener("click", () => navigation.replace({ screenId: "editor", params: { entity: entityId } }));
    }
    this.entityScreen = new EntityScreen(find<HTMLElement>(root, "#entity-host"), active);
  }

  render(): void {
    this.entityScreen.render();
  }
}
