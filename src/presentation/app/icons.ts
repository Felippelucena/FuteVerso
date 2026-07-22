import {
  createIcons,
  Dices,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide";

const UI_ICONS = { Dices, Pause, Pencil, Play, Plus, RotateCcw, Save, SlidersHorizontal, Trash2, Users, X };

export const hydrateIcons = (): void => createIcons({ icons: UI_ICONS });
