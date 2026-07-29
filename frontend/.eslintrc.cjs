module.exports = {
  root: true,
  env: { browser: true, es2021: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: { react: { version: 'detect' } },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'react/prop-types': 'off',
  },
  overrides: [
    {
      // Build/tooling configs run in Node, not the browser.
      files: [
        'vite.config.js',
        'playwright.config.js',
        'tailwind.config.js',
        'postcss.config.js',
        '.eslintrc.cjs',
      ],
      env: { node: true },
    },
  ],
}
