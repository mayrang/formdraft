import type { SchemaValidator } from '../types';

type ZodLike<T> = {
  parse(input: unknown): T;
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues?: unknown } };
};

export function zodAdapter<T>(zodSchema: ZodLike<T>): SchemaValidator<T> {
  return {
    parse: (input) => zodSchema.parse(input),
    safeParse: (input) => {
      const result = zodSchema.safeParse(input);
      if (result.success) return { success: true, data: result.data };
      const err = new Error('Schema validation failed');
      (err as Error & { cause?: unknown }).cause = result.error;
      return { success: false, error: err };
    },
  };
}

export function validateOrDiscard<T>(
  stored: unknown,
  validator: SchemaValidator<T>,
  draftKey: string,
): T | null {
  if (stored === null || stored === undefined) return null;
  const result = validator.safeParse(stored);
  if (result.success) return result.data;
  // eslint-disable-next-line no-console
  console.warn(
    `[formdraft] Stored draft for key "${draftKey}" failed schema validation. Discarding. Reason:`,
    result.error,
  );
  return null;
}
