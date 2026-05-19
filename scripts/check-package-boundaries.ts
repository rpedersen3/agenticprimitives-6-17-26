// TODO: implement per specs/102-manifest-and-claude-md-template.md §5
//
// Verifies for every packages/*/src/**/*.ts:
//   - no imports outside the package's manifest.allowedImports
//   - no deep imports across packages (e.g. '@agenticprimitives/delegation/internal/foo')
//   - no imports matching manifest.forbiddenImports
//   - no apps/* imports
//
// This is the cycle / boundary enforcer.

throw new Error('check-package-boundaries: not implemented (stub)');
