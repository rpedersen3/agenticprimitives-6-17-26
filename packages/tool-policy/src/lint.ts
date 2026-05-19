// lintClassification — scan a source tree for tool definitions and verify
// each carries the required JSDoc @sa-* tags.
//
// v0 implementation: regex-based scan of the source tree. JSDoc parsing
// proper happens in v0.1; for the demo we focus on tag presence on
// function/object definitions that look like tools.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { LintResult } from './types';

const DEFAULT_PATTERN = /\/\*\*([\s\S]*?)\*\//g;
const TOOL_HEURISTIC = /(?:export\s+(?:const|function)\s+\w+Tool|name:\s*['"`])/;

interface LintOpts {
  srcDir: string;
  requiredTags: string[];
  optionalTags?: string[];
  tagBlockPattern?: RegExp;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      yield* walk(p);
    } else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry))) {
      yield p;
    }
  }
}

export async function lintClassification(opts: LintOpts): Promise<LintResult> {
  const required = new Set(opts.requiredTags);
  const result: LintResult = { passed: true, errors: [] };
  const blockRe = opts.tagBlockPattern ?? DEFAULT_PATTERN;

  for (const file of walk(opts.srcDir)) {
    const text = readFileSync(file, 'utf8');
    blockRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(text)) !== null) {
      const block = m[0];
      const after = text.slice(m.index + block.length, m.index + block.length + 200);
      if (!TOOL_HEURISTIC.test(after)) continue;

      const present = new Set<string>();
      for (const tag of [...required, ...(opts.optionalTags ?? [])]) {
        const tagRe = new RegExp(`@${tag.replace(/^@/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&')}\\b`);
        if (tagRe.test(block)) present.add(tag);
      }
      const missing = [...required].filter((t) => !present.has(t));
      if (missing.length > 0) {
        const line = text.slice(0, m.index).split('\n').length;
        result.passed = false;
        result.errors.push({ file, line, missing });
      }
    }
  }
  return result;
}
