# demo-gs browser-storage ledger

Audit artifact (Demo GS storage cleanup). It enumerates **every** `localStorage` / `sessionStorage` key
the app reads or writes, and proves that **no source-of-truth / operational data lives in the browser**.

## Doctrine

Operational / source-of-truth data — needs, offerings, matches, agreements, the member registry,
contact releases, the broker board, bridge imports, durable org/person relationships — lives ONLY in
per-agent **MCP vaults**, read/written through `src/lib/vault-client.ts` → the demo-a2a
`/a2a/mcp/vault/*` proxy → demo-mcp vault tools (spec 247 / spec 252 Wave 2). The in-memory entitled
view in `src/lib/store.ts` is a transient cache, rebuilt from the vault on every load and **never
persisted to the browser**.

Browser storage is therefore limited to **non-authoritative** state: the login session credential,
redirect stashes, UI hints/preferences, the Pete/Jane demo-shortcut selection, and a non-authoritative
deploy display cache. Every retained key below is `authoritative? = NO`.

## Retained keys

All keys are namespaced `agenticprimitives:demo-gs:*`.

| Key | Store | Owner module | Purpose | Authoritative? | Cleanup behavior |
| --- | --- | --- | --- | --- | --- |
| `…:session:<kind>` (`kc` \| `gco`) | local | `src/lib/session.ts` | Login CREDENTIAL: who's connected + the scoped grant the app reads/writes the member's OWN vault through. Versioned + TTL'd envelope. NOT operational data. | NO (credential + grant pointer; the data is in the vault) | Cleared on sign-out (`clearSession`, which also clears the dependent active-role pref). Purged by the loader if version-skewed / malformed / past `SESSION_TTL_MS` (fail-closed, ADR-0013). |
| `…:connect` | session | `src/lib/connect-launch.ts` (read in `App.tsx`) | In-flight site-login PKCE stash (state / authOrigin / codeVerifier / nonce) across the redirect to the home. | NO | Removed by the App connect-return handler once consumed; sessionStorage clears on tab close. |
| `…:org-create` | session | `src/App.tsx` (`ORG_KEY`) | In-flight GCO org-create PKCE stash across the redirect to the home (step 2). | NO | Removed by the App org-create return handler once consumed; sessionStorage clears on tab close. |
| `…:active-role:<personKey>` | local | `src/lib/active-role.ts` | Pure UI preference: the connected person's last-chosen workspace (`gco` \| `kc`). Never identity/authz; the resolver decides what's openable. | NO | Set on workspace open; cleared with the session on sign-out (`clearSession` → `clearActiveRole`). |
| `…:last-name` | local | `src/lib/connect-launch.ts` (read in `ConnectScreen` / `OnboardPanel`) | Last-typed Global.Church name — prefill convenience only. | NO | Overwritten on next connect; harmless if stale. |
| `…:persona` | local | `src/lib/personas.ts` | The Pete/Jane demo-shortcut selection. TESTNET/DEMO ONLY (mirrors demo-jp's accepted AUDIT C-1 hole) — never production authorization; the operator's authority is its deterministic key, not this pref. | NO | Overwritten on next selection. |
| `…:switchboard-sa` | local | `src/lib/onchain.ts` | Non-authoritative DISPLAY cache of the predicted/deployed Switchboard org SA, to avoid re-deriving on every panel mount. The chain is authoritative (`isContractDeployed`); this is re-verified before a write. | NO | Adopted/re-derived on load; never trusted without an on-chain check. |

## Removed (obsolete fixture-era blobs) — swept once by `src/lib/storage-cleanup.ts`

These keys held **source-of-truth** data in the pre-Wave-2 (spec 250 Phase 0/1) localStorage-store era.
Wave 2 (spec 252) re-homed that data into MCP vaults, so any surviving copy is a stale, confusing
shadow of the vault and is deleted once per browser by the versioned one-time sweep
(`agenticprimitives:demo-gs:storage-cleanup:v1` marker). The sweep removes ONLY these exact keys and
never touches any retained key above.

| Key | Was | Re-homed to |
| --- | --- | --- |
| `…:db:v1` | The shared operational store (needs / offerings / matches / agreements). | Per-agent MCP vaults: member-owned records (`gs:offering`, `gs:needs`) in each member's vault; agreements + bridge (`gs:broker:*`) in Jane's broker vault. |
| `…:members:v1` | The local member registry. | Jane's broker vault, `gs:member:<sa>` records (`src/lib/member-vault.ts`). |

## Notes

- No operational/source-of-truth data was found persisted to localStorage in the current code (Wave 2
  already re-homed it). The two `…:db:v1` / `…:members:v1` keys above are dead artifacts only old bundles
  could have written; the sweep removes them defensively.
- Connect/OIDC calls (site-login, org-create, related-orgs, token exchange) go DIRECT to the person's
  Global.Church home — NOT through the MCP vault proxy. Every vault read/write goes through
  `vault-client.ts` to `/a2a/mcp/vault/*`. This ledger does not change that routing.
- spec-248 caveats stand: a grant carries its intended program scope; record-level scope is owner-keyed,
  not cryptographically enforced; the Pete/Jane demo admin runs on deterministic demo keys, not
  production authorization. Nothing here claims production-data readiness.
