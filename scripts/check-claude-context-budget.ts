// TODO: implement per specs/102-manifest-and-claude-md-template.md §5
//
// Verifies word counts vs each package's manifest.contextBudget:
//   - CLAUDE.md ≤ claudeMdMaxWords (default 900)
//   - README.md ≤ readmeMaxWords (default 1800)
//   - docs/architecture.md ≤ architectureMaxWords (default 3000)
//
// Reports oversize files with line-by-line trim suggestions.

throw new Error('check-claude-context-budget: not implemented (stub)');
