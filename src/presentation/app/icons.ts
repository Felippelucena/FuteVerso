import {
  Dices,
  Goal,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
  type IconNode,
  type SVGProps,
} from "lucide";
import { html, type Html } from "./html";

const UI_ICONS = { Dices, Goal, Pause, Pencil, Play, Plus, Radio, RotateCcw, Save, SlidersHorizontal, Trash2, Users, X };

export type IconName = keyof typeof UI_ICONS;

const attributes = (values: SVGProps): Html =>
  html`${Object.entries(values).map(([name, value]) => html` ${name}="${String(value)}"`)}`;

const toMarkup = ([tag, values, children = []]: IconNode): Html =>
  html`<${tag}${attributes(values)}>${children.map(toMarkup)}</${tag}>`;

const cache = new Map<IconName, Html>();

/**
 * O ícone entra como SVG na própria marcação, em vez de um marcador hidratado depois:
 * `createIcons` varre o documento inteiro a cada chamada, e o painel repinta várias vezes por
 * segundo. Assim também é o compilador que garante que o ícone existe. Serializa uma vez só.
 */
export const icon = (name: IconName): Html => {
  const cached = cache.get(name);
  if (cached) return cached;
  const rendered = toMarkup(UI_ICONS[name]);
  cache.set(name, rendered);
  return rendered;
};
