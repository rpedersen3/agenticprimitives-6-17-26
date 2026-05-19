// TODO: implement per specs/102-manifest-and-claude-md-template.md §5
//
// Verifies:
//   - every packages/*/capability.manifest.json matches the JSON schema
//   - every package's publicExports actually exists in src/index.ts
//   - manifest.name matches package.json name
//   - manifest.imports matches package.json dependencies + peerDependencies
//
// Exit codes:
//   0 = all manifests valid
//   1 = validation failures (printed)
//   2 = internal error

throw new Error('check-capability-manifests: not implemented (stub)');
