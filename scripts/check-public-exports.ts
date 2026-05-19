// TODO: implement per specs/102-manifest-and-claude-md-template.md §5
//
// Verifies for every packages/*/:
//   - package.json:exports paths exist (or will after build)
//   - capability.manifest.json:publicExports symbols are exported from src/index.ts
//   - no accidental named exports outside the publicExports list

throw new Error('check-public-exports: not implemented (stub)');
