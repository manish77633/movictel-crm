import tseslint from 'typescript-eslint'
export default [
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/next-env.d.ts'] },
  {
    files: ['frontend/src/**/*.{ts,tsx}', 'backend/src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }]
    }
  }
]