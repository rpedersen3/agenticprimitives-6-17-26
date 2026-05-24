import { InvalidNameError } from './errors';

/**
 * Normalize an agent name to canonical form.
 *
 * Phase 1 normalization (US-ASCII subset; spec § 4 normalization
 * rules; matches `smart-agent/packages/sdk/src/naming.ts:normalize`
 * with stricter label validation):
 *
 *   1. NFC normalize the input.
 *   2. Trim outer whitespace.
 *   3. Lowercase (`String.prototype.toLowerCase` — note Turkish-i
 *      edge case; acceptable in Phase 1 since labels are ASCII-only).
 *   4. Split on `.`. For each label:
 *      - Reject empty.
 *      - Reject leading or trailing `-`.
 *      - Reject characters outside `[a-z 0-9 -]`.
 *      - Reject length > 63.
 *   5. Return joined.
 *
 * Throws `InvalidNameError` on any rule violation. Use this BEFORE
 * `namehash` so the namehash is computed against the canonical form.
 */
export function normalizeAgentName(name: string): string {
  if (typeof name !== 'string') {
    throw new InvalidNameError(String(name), 'must be a string');
  }
  const trimmed = name.normalize('NFC').trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new InvalidNameError(name, 'empty');
  }
  const labels = trimmed.split('.');
  for (const label of labels) {
    validateLabel(name, label);
  }
  return labels.join('.');
}

const LABEL_RE = /^[a-z0-9-]+$/;

function validateLabel(fullName: string, label: string): void {
  if (label.length === 0) {
    throw new InvalidNameError(fullName, 'empty label (consecutive dots or leading/trailing dot)');
  }
  if (label.length > 63) {
    throw new InvalidNameError(fullName, `label "${label}" exceeds 63 chars`);
  }
  if (label.startsWith('-')) {
    throw new InvalidNameError(fullName, `label "${label}" starts with hyphen`);
  }
  if (label.endsWith('-')) {
    throw new InvalidNameError(fullName, `label "${label}" ends with hyphen`);
  }
  if (!LABEL_RE.test(label)) {
    throw new InvalidNameError(
      fullName,
      `label "${label}" contains characters outside [a-z 0-9 -]`,
    );
  }
}

/**
 * Predicate variant — returns true / false instead of throwing.
 * Useful for UI input validation.
 */
export function isValidAgentName(name: string): boolean {
  try {
    normalizeAgentName(name);
    return true;
  } catch {
    return false;
  }
}
