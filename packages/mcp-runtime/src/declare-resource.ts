import type { ResourceDefinition } from './types';
import type { ToolClassification } from '@agenticprimitives/tool-policy';

export function declareResource(
  def: ResourceDefinition,
  classification: ToolClassification,
): ResourceDefinition & { _classification: ToolClassification } {
  return Object.assign({}, def, { _classification: classification });
}
