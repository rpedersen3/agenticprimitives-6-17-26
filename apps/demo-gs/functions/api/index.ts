// GET /api — discovery doc for the demo-gs public read API.
import { json, preflight } from './_shared';

export const onRequestOptions = () => preflight();

export const onRequestGet = () =>
  json({
    name: 'Global Switchboard public read API (demo)',
    spec: 'spec 250 §16 — the public skill-gap read surface; privacy tiers enforced in the projection.',
    taxonomy: 'https://registry.global.church/skills/switchboard/ (the shared 22-category / 193-skill SKOS vocabulary)',
    endpoints: {
      'GET /api/directory': {
        description: 'Browsable public directory of open Needs + active Offerings (privacy-projected).',
        query: { text: 'free text', kind: 'need | offering | all', category: 'skill category URI', region: 'region URI (or "sensitive")', cause: 'cause label' },
        returns: '{ count, results[], facets }',
      },
      'GET /api/signal': {
        description: 'Aggregate skill-gap signal — counts only, no specific match. Sensitive regions coarsened.',
        returns: '{ openCount, bySkill[], byCategory[], byRegion[], unmet[] }',
      },
    },
    notes: [
      'Read-only + identity-free. Confidential Needs appear coarsened; sensitive entries are absent; contact is never returned.',
      'Demand includes Pattern-A bridged Global Switchboard roles, joined on concept identity.',
    ],
  });
