import "../env";
import { TakeshiPolicy } from "laplace-engine";
import type { Agent, TurnInput } from "../types";

/**
 * The product's team-aware alpha-beta minimax, used verbatim as the
 * baseline opponent. `depth` overrides its internal dynamic search depth
 * via a runtime patch (the method is private but reachable in JS).
 */
export function takeshiAgent(depth?: number): Agent {
  const policy = new TakeshiPolicy();
  if (depth !== undefined) {
    (policy as any).getSearchDepth = () => depth;
  }
  return {
    name: depth === undefined ? "takeshi" : `takeshi-d${depth}`,
    act(input: TurnInput) {
      const action = policy.getBestMove(input.state);
      if (!action) return { move: null };
      return {
        move: {
          from: { row: action.from[0], col: action.from[1] },
          to: { row: action.to[0], col: action.to[1] },
        },
      };
    },
  };
}
