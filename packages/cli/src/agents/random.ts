import { rng, type Agent, type TurnInput } from "../types";

export function randomAgent(seed: number): Agent {
  const rand = rng(seed);
  return {
    name: "random",
    act(input: TurnInput) {
      const move = input.legal[Math.floor(rand() * input.legal.length)];
      return { move };
    },
  };
}
