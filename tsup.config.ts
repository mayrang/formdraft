import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'rhf/index': 'src/rhf/index.ts',
    'formik/index': 'src/formik/index.ts',
    'tanstack-form/index': 'src/tanstack-form/index.ts',
    'storage/indexedDB': 'src/storage/indexedDB.ts',
    'storage/sessionStorage': 'src/storage/sessionStorage.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', 'react-hook-form', 'formik', '@tanstack/react-form', 'zod'],
  target: 'es2020',
  splitting: false,
});
