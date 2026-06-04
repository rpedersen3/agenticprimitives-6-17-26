// GET /api/directory — the public, privacy-projected directory of Needs + Offerings, with the same
// search/filter as the in-app DirectoryPanel (shared lib/directory.ts). Confidential anchors are
// coarsened, sensitive entries absent, contact never returned (enforced in the projection).
import { buildDirectory, directoryFacets, searchDirectory, type DirFilter } from '../../src/lib/directory';
import { publicNeeds, publicOfferings } from '../../src/lib/public-data';
import { json, preflight } from './_shared';

export const onRequestOptions = () => preflight();

export const onRequestGet = ({ request }: { request: Request }) => {
  const q = new URL(request.url).searchParams;
  const all = buildDirectory(publicNeeds(), publicOfferings());
  const kind = q.get('kind');
  const filter: DirFilter = {
    text: q.get('text') ?? undefined,
    kind: kind === 'need' || kind === 'offering' ? kind : 'all',
    categoryUri: q.get('category') ?? undefined,
    regionUri: q.get('region') ?? undefined,
    cause: q.get('cause') ?? undefined,
  };
  const results = searchDirectory(all, filter);
  return json({ count: results.length, results, facets: directoryFacets(all) });
};
