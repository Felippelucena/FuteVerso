import type { MatchEvent, MatchEventData, MatchState } from "../model";

export const emitMatchEvent = (state: MatchState, data: MatchEventData): void => {
  const event = { ...data, id: ++state.eventCounter, time: state.elapsed } as MatchEvent;
  state.events.unshift(event);
  state.events = state.events.slice(0, 7);
};
