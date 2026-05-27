export type Debounced<A extends unknown[]> = ((...args: A) => void) & {
  cancel(): void;
  flush(): void;
};

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const debounced = (...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const a = lastArgs;
      lastArgs = null;
      if (a) fn(...a);
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (lastArgs) {
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    }
  };

  return debounced as Debounced<A>;
}
