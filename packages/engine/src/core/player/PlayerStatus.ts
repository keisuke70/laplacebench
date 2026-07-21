import { GameState } from "../types";

export function updatePlayerStatus(
  state: GameState,
  capturedPositions: [number, number][]
): void {
  const capturedPlayerInfo = capturedPositions
    .map(([r, c]) => ({ position: [r, c] as [number, number], player: state.board[r][c]?.player }))
    .filter((info) => info.player !== undefined);

  const playersToEliminate = new Set<number>();
  const remainingPiecePositions: [number, number][] = [];

  capturedPlayerInfo.forEach(({ player }) => {
    if (player) {
      state.capturedPieces[player - 1]++;
      if (state.capturedPieces[player - 1] >= state.eliminationThreshold) {
        playersToEliminate.add(player);
      }
    }
  });

  capturedPositions.forEach(([r, c]) => {
    state.board[r][c] = null;
  });

  if (state.lastMove) {
    state.lastMove.capturedPiecesMeta = capturedPlayerInfo.map(({ position, player }) => ({
      position,
      player: player!,
    }));
  }

  playersToEliminate.forEach((player) => {
    for (let r = 0; r < state.boardSize; r++) {
      for (let c = 0; c < state.boardSize; c++) {
        if (state.board[r][c]?.player === player) {
          remainingPiecePositions.push([r, c]);
        }
      }
    }
    state.eliminatedPlayers[player - 1] = true;
    for (let r = 0; r < state.boardSize; r++) {
      for (let c = 0; c < state.boardSize; c++) {
        if (state.board[r][c]?.player === player) {
          state.board[r][c] = { player: state.board[r][c]!.player, isDead: true };
        }
      }
    }
  });

  if (playersToEliminate.size > 0 && state.lastMove) {
    state.lastMove.remainingPiecePositions = remainingPiecePositions;
  }
}
