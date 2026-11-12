import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    pool: 'forks', // cada arquivo num processo: o banco em memória e o require cache não vazam entre arquivos
    poolOptions: { forks: { singleFork: false } },
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
