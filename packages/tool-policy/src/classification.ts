// declareTool: attach a classification at runtime so non-JSDoc consumers
// surface the same metadata that the lint script reads from JSDoc tags.

import type { ToolClassification } from './types';

export function declareTool<T>(
  def: T,
  classification: ToolClassification,
): T & { _classification: ToolClassification } {
  return Object.assign(def as object, { _classification: classification }) as T & {
    _classification: ToolClassification;
  };
}
