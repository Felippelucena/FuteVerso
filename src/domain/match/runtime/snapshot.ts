import type { MatchState, PlayerRuntime } from "../model";
import type { PlayerProfile } from "../../roster/model";

/**
 * Foto de um instante da partida, para o rebobinar reconstruir o passado a partir dela.
 *
 * O corpo é clonado; o `profile` dos jogadores vai por REFERÊNCIA. Ele é dado de elenco — nome,
 * nacionalidade, habilidades, mental — e nenhum sistema do motor o escreve durante o jogo: o que
 * muda no atleta (estamina, posição, plano) mora no `PlayerRuntime` ao lado dele. Clonar o perfil
 * a cada keyframe duplicava o elenco inteiro umas centenas de vezes por partida sem que um único
 * campo pudesse diferir.
 *
 * O corte é por destacar o campo antes de clonar, e não por listar o que copiar: assim um campo
 * novo em `MatchState` entra no snapshot sozinho, em vez de sumir do rebobinar em silêncio.
 */
type DetachedPlayer = Omit<PlayerRuntime, "profile">;
type MatchBody = Omit<MatchState, "players"> & { players: DetachedPlayer[] };

export interface MatchSnapshot {
  readonly body: MatchBody;
  readonly profiles: readonly PlayerProfile[];
}

const detachProfile = ({ profile: _profile, ...runtime }: PlayerRuntime): DetachedPlayer => runtime;

export const captureMatchSnapshot = (state: MatchState): MatchSnapshot => ({
  body: structuredClone({ ...state, players: state.players.map(detachProfile) }),
  profiles: state.players.map((player) => player.profile),
});

/** Devolve um estado independente: cada restauração pode ser simulada sem tocar no snapshot. */
export const restoreMatchSnapshot = ({ body, profiles }: MatchSnapshot): MatchState => {
  const restored = structuredClone(body);
  return {
    ...restored,
    players: restored.players.map((player, index) => ({ ...player, profile: profiles[index] })),
  };
};
