import type { AnimationDef } from './animations';

export interface StateMachine {
  play(state: string, opts?: { force?: boolean }): boolean;
  onChange(l: (s: string, d: AnimationDef) => void): () => void;
  readonly current: string;
  notifyFinished(): void;
}

export function createStateMachine(
  defs: Record<string, AnimationDef>,
  opts: { fallback: string; priority?: Record<string, number> },
): StateMachine {
  const listeners = new Set<(s: string, d: AnimationDef) => void>();
  let current = opts.fallback;

  function notify(state: string): void {
    const def = defs[state];
    for (const l of listeners) l(state, def);
  }

  return {
    play(state, playOpts) {
      const def = defs[state];
      if (!def) return false;

      const priority = opts.priority ?? {};
      const currentPrio = priority[current] ?? 0;
      const nextPrio = priority[state] ?? 0;
      if (!playOpts?.force && nextPrio < currentPrio) return false;

      current = state;
      notify(state);
      return true;
    },

    onChange(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },

    get current() {
      return current;
    },

    notifyFinished() {
      const def = defs[current];
      if (def && !def.loop && current !== opts.fallback) {
        current = opts.fallback;
        notify(current);
      }
    },
  };
}
