import {configDefaults,defineConfig} from 'vitest/config';

export default defineConfig({
 test:{
  exclude:[
   ...configDefaults.exclude,
   '**/.out/**',
   '**/.worktrees/**',
   '**/worktrees/**',
   '**/build/**',
   '**/dist/**',
   '**/.git/**',
   '**/node_modules/**',
  ],
 },
});
