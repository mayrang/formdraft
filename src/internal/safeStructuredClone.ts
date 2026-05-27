const SAFE_PROTOTYPES = new Set<unknown>([
  Object.prototype,
  Array.prototype,
  Date.prototype,
  RegExp.prototype,
  Map.prototype,
  Set.prototype,
  null,
]);

function findCustomPrototype(value: unknown, seen: WeakSet<object>): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  const proto = Object.getPrototypeOf(value);
  if (!SAFE_PROTOTYPES.has(proto)) return true;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (findCustomPrototype(item, seen)) return true;
    }
    return false;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (findCustomPrototype(v, seen)) return true;
  }
  return false;
}

export function safeStructuredClone<T>(value: T): T {
  if (process.env.NODE_ENV !== 'production') {
    if (findCustomPrototype(value, new WeakSet())) {
      // eslint-disable-next-line no-console
      console.warn(
        '[formdraft] safeStructuredClone: value contains a class instance. structuredClone will drop its prototype (e.g., class methods will be lost in other tabs). Use plain objects in form values.',
      );
    }
  }
  return structuredClone(value);
}
