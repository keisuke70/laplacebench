import { rng, type Agent, type TurnInput } from "../types";

/**
 * Failure-policy exerciser: sometimes returns garbage (format failure),
 * sometimes an illegal move (legality failure), otherwise a legal random
 * move. Used to test the referee's repair/retry/pass/elimination paths
 * without an API key.
 */
export function chaosAgent(seed: number): Agent {
  const rand = rng(seed);
  return {
    name: "chaos",
    act(input: TurnInput) {
      const roll = rand();
      if (roll < 0.15) {
        return { move: null, raw: "I refuse to emit JSON today." };
      }
      if (roll < 0.35) {
        return {
          move: {
            from: { row: Math.floor(rand() * 8), col: Math.floor(rand() * 8) },
            to: { row: Math.floor(rand() * 8), col: Math.floor(rand() * 8) },
          },
        };
      }
      const move = input.legal[Math.floor(rand() * input.legal.length)];
      return { move };
    },
  };
}
