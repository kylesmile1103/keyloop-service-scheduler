// Adopted from shadcn-dashboard-landing-template (vite-version) `eslint.config.js`,
// Copyright (c) 2025 ShadcnStore, MIT License (the full notice is in the README's licence section).
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    // HeyAPI output (`pnpm generate:api`, Task 15b) is generated, never hand-edited, so it is not linted.
    // The hand-written client runtime configuration next to it is.
    'src/api/**/*',
    '!src/api/runtime.ts',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // One app, two areas (ARCHITECTURE §15, ADR-027): the admin area (Refine and the resources pages) and the workshop pages
  // never import each other, so the board's first load never downloads Refine or admin code. Both may use components,
  // hooks, lib and api. src/module-boundaries.test.ts pins these patterns.
  {
    files: ['src/app/admin/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^(@/app/|(\\.\\./)+(app/)?)(dispatch|calendar|overview|appointments)(/|$)',
          message: 'The admin area may not import a workshop page\'s code: move what both need to components, hooks, lib or api.',
        }],
      }],
    },
  },
  {
    files: ['src/app/{dispatch,calendar,overview,appointments}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^(@/app/|(\\.\\./)+(app/)?)admin(/|$)',
          message: 'The workshop pages may not import the admin area: it would put Refine and admin code in the board\'s first load. Move what both need to components, hooks, lib or api.',
        }],
      }],
    },
  },
  {
    // shadcn/ui files export variants and hooks next to their components by design
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
