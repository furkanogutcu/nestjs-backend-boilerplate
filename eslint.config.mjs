// @ts-check
import eslint from '@eslint/js'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

import entityTableNamePlural from './eslint-rules/entity-table-name-plural.mjs'

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // Functions/methods with 2+ parameters must accept a single named-parameter object.
      // Constructors are exempt because NestJS dependency injection relies on positional
      // constructor parameters (it cannot inject into a destructured object).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'FunctionDeclaration[params.length>1]',
          message:
            'Functions with 2+ parameters must accept a single named-parameter object (e.g. fn({ a, b })).',
        },
        {
          selector: 'ArrowFunctionExpression[params.length>1]',
          message:
            'Arrow functions with 2+ parameters must accept a single named-parameter object (e.g. (params) => ...).',
        },
        {
          selector:
            'FunctionExpression[params.length>1]:not(MethodDefinition[kind="constructor"] > FunctionExpression)',
          message:
            'Methods with 2+ parameters must accept a single named-parameter object (e.g. method({ a, b })).',
        },
      ],
      '@typescript-eslint/no-unsafe-argument': 'off',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^\\u0000'],
            ['^node:'],
            ['^@?\\w'],
            ['^@(config|shared|infrastructure|modules|database|test)(/|$)'],
            ['^\\.'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: true } },
        { selector: 'class', modifiers: ['abstract'], format: ['PascalCase'], custom: { regex: '^Base[A-Z]', match: true } },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          vars: 'all',
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-unused-private-class-members': ['error'],
      '@typescript-eslint/prefer-readonly': 'error',
      'no-return-await': 'off',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['**/entities/*.entity.ts'],
    plugins: {
      local: {
        rules: {
          'entity-table-name-plural': entityTableNamePlural,
        },
      },
    },
    rules: {
      'local/entity-table-name-plural': 'error',
    },
  },
)
