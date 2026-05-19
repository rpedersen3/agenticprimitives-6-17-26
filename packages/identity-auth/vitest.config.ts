import { defineConfig, mergeConfig } from 'vitest/config';
import root from '../../vitest.config';

export default mergeConfig(
  root,
  defineConfig({
    test: {
      name: '@agenticprimitives/identity-auth',
    },
  }),
);
