/**
 * A cadeia de decisão individual, em trilhas independentes: o despachante escolhe a trilha, e
 * cada trilha resolve um jeito de estar em campo. Era um arquivo só de 945 linhas com sete
 * responsabilidades — quem mexia numa mexia em todas.
 *
 * Esta é a superfície: `decideAll` para quem quer a decisão crua, `planAll`/`resolvePlanDecision`
 * para quem vive no ciclo de cognição.
 */
export { decideAll, decideFor, readFrame, readTeam, type FrameContext, type TeamContext } from "./decide";
export { planAll, planFor, resolvePlanDecision, thinkingInterval } from "./plan";
export { choosePass, PASS_VARIANTS, type PassOption } from "./pass";
