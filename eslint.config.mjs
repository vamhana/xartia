// eslint.config.mjs — flat config для ESLint 9
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'mobile/**',
      'terraform/**',
      'helm/**',
      'k8s/**',
      'infra/**',
      'monitoring/**',
      'docs/**',
      'legacy/**',
      '**/*.js',
      '!eslint.config.mjs',
    ],
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...(importPlugin.configs.flat?.recommended?.rules ??
        importPlugin.configs.recommended.rules),
      ...(importPlugin.configs.flat?.typescript?.rules ??
        importPlugin.configs.typescript.rules),
      ...prettier.rules,

      'no-undef': 'off',
      'import/no-unresolved': 'off',
      'import/default': 'off',        // ложное для CJS-пакетов с esModuleInterop

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      curly: 'error',
      eqeqeq: ['error', 'always'],
      'no-magic-numbers': 'off',

      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },

  // 3 «монолитных» файла — import/order отключён, чтобы не тонуть в ручной
  // сортировке сотен импортов. Вернёмся к ним отдельным пунктом.
  {
    files: [
      'src/server.ts',
      'src/web/App.tsx',
      'src/core/constructor/data-loaders.ts',
    ],
    rules: { 'import/order': 'off' },
  },

  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      'scripts/**/*.ts',
      'tests/**/*.ts',
    ],
    rules: {
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
];