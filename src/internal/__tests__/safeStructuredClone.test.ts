import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeStructuredClone } from '../safeStructuredClone';

describe('safeStructuredClone', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('clones primitives', () => {
    expect(safeStructuredClone(1)).toBe(1);
    expect(safeStructuredClone('x')).toBe('x');
    expect(safeStructuredClone(null)).toBe(null);
  });

  it('clones plain objects deeply', () => {
    const src = { a: 1, b: { c: 2 } };
    const out = safeStructuredClone(src) as typeof src;
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(out.b).not.toBe(src.b);
  });

  it('clones Dates without warning (Date is structured-cloneable)', () => {
    const d = new Date(1735689600000);
    const out = safeStructuredClone(d) as Date;
    expect(out instanceof Date).toBe(true);
    expect(out.getTime()).toBe(d.getTime());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns when value contains class instance (prototype loss risk)', () => {
    class User { constructor(public name: string) {} }
    const src = { user: new User('Alice') };
    safeStructuredClone(src);
    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls[0]?.[0] as string;
    expect(msg).toMatch(/formdraft/i);
    expect(msg).toMatch(/class instance|prototype/i);
  });

  it('does not warn for plain object with Date inside', () => {
    safeStructuredClone({ when: new Date() });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
