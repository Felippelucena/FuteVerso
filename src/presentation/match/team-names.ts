import type { GameApplication } from "../../application/game-application";
import type { TeamNames } from "../app/labels";

/** Sigla dos clubes em campo. Sempre relida, porque a partida pode trocar de times. */
export const teamNamesOf = (application: GameApplication): TeamNames => ({
  blue: application.clubOf("blue")?.shortName ?? "CASA",
  coral: application.clubOf("coral")?.shortName ?? "VISITANTE",
});
