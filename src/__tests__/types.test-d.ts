// Type-level regression tests. Compiled by tsc but not executed at runtime
// (no test runner picks these up — vitest config excludes *.test-d.ts).
// They exist purely so a future change that breaks the public TS contract
// surfaces as a tsc error in CI.
//
// Add // @ts-expect-error on lines that MUST fail to compile; if the type
// system is too loose and the line starts compiling, tsc errors with
// "Unused @ts-expect-error directive" — which is exactly the signal we want.

import { z } from 'zod';
import type { FormDraftResult, SchemaValidator } from '../types';
import { zodAdapter } from '../internal/schemaValidation';

declare const draft: FormDraftResult<{ name: string; age: number }>;

// values must be readonly — direct mutation bypasses persist pipeline.
// @ts-expect-error reassign top-level
draft.values = { name: 'X', age: 1 };
// @ts-expect-error mutate property
draft.values.name = 'X';

// set/patch with unknown key must error.
// @ts-expect-error wrong key
draft.set('nope', 'x');
// @ts-expect-error wrong type for known key
draft.set('age', 'not-a-number');
// @ts-expect-error wrong key via patch
draft.patch({ nope: 1 });

// SchemaValidator brand: zodAdapter output satisfies it.
const Schema = z.object({ name: z.string() });
const wrapped: SchemaValidator<{ name: string }> = zodAdapter(Schema);
void wrapped;

// Raw Zod schema (without zodAdapter) must NOT satisfy SchemaValidator.
// @ts-expect-error missing __formdraft brand
const bare: SchemaValidator<{ name: string }> = Schema;
void bare;
