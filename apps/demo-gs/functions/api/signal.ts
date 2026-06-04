// GET /api/signal — the aggregate public skill-gap signal (shared lib/signal.ts). Counts only; never
// a specific expert↔need match. Sensitive regions collapse to one coarse bucket.
import { computeSignal } from '../../src/lib/signal';
import { publicNeeds, publicOfferings } from '../../src/lib/public-data';
import { json, preflight } from './_shared';

export const onRequestOptions = () => preflight();

export const onRequestGet = () => json(computeSignal(publicNeeds(), publicOfferings()));
