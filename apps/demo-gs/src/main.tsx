import { createRoot } from 'react-dom/client';
import { App } from './App';
import { runStorageCleanup } from './lib/storage-cleanup';

// One-time sweep of obsolete fixture-era storage blobs before the app mounts (see lib/storage-cleanup.ts
// + docs/storage-ledger.md). Idempotent + safe on refresh; never touches active session/redirect/role
// state. Operational source-of-truth lives in MCP vaults, not the browser.
runStorageCleanup();

createRoot(document.getElementById('root')!).render(<App />);
