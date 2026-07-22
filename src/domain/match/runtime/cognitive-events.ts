import { FIELD } from "../config";
import { distance } from "../../shared/math";
import type { CognitiveEvent, CognitiveEventType, MatchState, Vec2 } from "../model";

export const relevantPlayersNear = (state: MatchState, point: Vec2, radius = FIELD.width * 0.22): string[] =>
  state.players.filter((player) => distance(player.position, point) <= radius).map((player) => player.profile.id);

export const emitCognitiveEvent = (
  state: MatchState,
  type: CognitiveEventType,
  playerIds: string[] | null,
  detail: Omit<Partial<CognitiveEvent>, "id" | "time" | "type" | "playerIds"> = {},
): CognitiveEvent => {
  const event: CognitiveEvent = {
    id: ++state.cognitiveEventCounter,
    time: state.elapsed,
    type,
    playerIds: playerIds ? [...new Set(playerIds)].sort() : null,
    ...detail,
  };
  state.cognitiveEvents.push(event);
  state.nextCognitionAt = Math.min(state.nextCognitionAt, state.elapsed);
  return event;
};

export const cognitiveEventAffects = (event: CognitiveEvent, playerId: string): boolean =>
  event.playerIds === null || event.playerIds.includes(playerId);
