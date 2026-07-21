/**
 * Jest config for the mobile app's PURE TypeScript logic.
 *
 * We deliberately use ts-jest (NOT jest-expo) for this first suite: the modules
 * under test import no React Native or expo native modules, so a plain
 * Node + ts-jest runner needs ZERO native mocking and runs fast and green.
 * When a future suite needs to render RN components or touch native modules,
 * add a separate jest-expo project rather than widening this one.
 *
 * Tests live in __tests__/ and are excluded from the app tsconfig (see
 * tsconfig.json "exclude"), so the app `tsc --noEmit` never depends on
 * @types/jest. ts-jest here supplies its own compiler options + jest types.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Inline compiler options: compile the pure TS to CommonJS for Node.
        // This bypasses the app tsconfig's bundler/react-native settings, which
        // are meant for Metro, not the Jest/Node runtime.
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'ES2019',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
}
