module.exports = {
  env: {
    node: true,
    es6: true
  },
  extends: '@guardian/eslint-config-typescript',
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 12,
    tsconfigRootDir: __dirname,
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  root: true,
  ignorePatterns: ['**/*.js', 'node_modules']
}
