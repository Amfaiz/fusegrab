//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

export default [
    ...tanstackConfig,
    {
        rules: {
            '@typescript-eslint/no-unnecessary-condition': 'off',
            'import/no-cycle': 'off',
            '@typescript-eslint/array-type': 'off',
            '@typescript-eslint/require-await': 'off',
            'pnpm/json-enforce-catalog': 'off',
            'no-shadow': 'off',
        },
    },
    {
        // *.mjs: the shared config only registers its plugins for js/ts/tsx,
        // so the rule overrides below crash eslint on plain .mjs scripts.
        // .vite: build output. tsconfig excludes it, so linting it fails with
        // "TSConfig does not include this file" after any `pnpm package`.
        ignores: [
            'eslint.config.js',
            'prettier.config.js',
            '**/*.mjs',
            '.vite/**',
        ],
    },
    {
        plugins: {
            'simple-import-sort': simpleImportSort,
        },
        rules: {
            'sort-imports': 'off',
            'import/order': 'off',
            'simple-import-sort/imports': [
                'error',
                {
                    groups: [
                        // Side effect imports.
                        ['^\\u0000'],
                        // Type imports
                        ['^.+\\u0000$'],
                        // Node.js builtins prefixed with `node:`.
                        ['^expo', '^@expo/*', '^react', '^react-native'],
                        // Packages.
                        // Things that start with a letter (or digit or underscore), or `@` followed by a letter.
                        ['^@?\\w'],
                        // Absolute imports and other imports such as Vue-style `@/foo`.
                        // Anything not matched in another group.
                        ['^@/lib', '^'],
                        // Relative imports.
                        // Anything that starts with a dot.
                        ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
                        // Other relative imports. Put same-folder imports and `.` last.
                        ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
                    ],
                },
            ],
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    args: 'all',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ],
        },
    },
]
