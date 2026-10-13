// Adopted from shadcn-dashboard-landing-template (vite-version) `eslint.config.js`,
// Copyright (c) 2025 ShadcnStore, MIT License.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    // Generated client files are not linted; hand-written runtime.ts is.
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
  // Keep admin (Refine) and workshop pages isolated so the board's initial bundle excludes admin code.
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
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
