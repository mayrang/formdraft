import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { zodAdapter, validateOrDiscard } from '../schemaValidation';

describe('zodAdapter', () => {
  const Schema = z.object({ name: z.string(), age: z.number() });

  it('wraps a Zod schema to SchemaValidator interface', () => {
    const v = zodAdapter(Schema);
    const result = v.safeParse({ name: 'Alice', age: 30 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: 'Alice', age: 30 });
  });

  it('safeParse returns error for invalid input', () => {
    const v = zodAdapter(Schema);
    const result = v.safeParse({ name: 'Alice' });
    expect(result.success).toBe(false);
  });

  it('parse throws on invalid input', () => {
    const v = zodAdapter(Schema);
    expect(() => v.parse({ name: 'Alice' })).toThrow();
  });
});

describe('validateOrDiscard', () => {
  const Schema = z.object({ x: z.number() });
  const validator = zodAdapter(Schema);

  it('returns validated data when input is valid', () => {
    expect(validateOrDiscard({ x: 1 }, validator, 'k')).toEqual({ x: 1 });
  });

  it('returns null when input is invalid and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateOrDiscard({ x: 'bad' }, validator, 'k')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null when input is null', () => {
    expect(validateOrDiscard(null, validator, 'k')).toBeNull();
  });
});
