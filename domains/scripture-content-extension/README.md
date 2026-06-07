# @agenticprimitives/scripture-content-extension

The scripture vertical for [`@agenticprimitives/content-primitives`](../../packages/content-primitives).
It maps human scripture references to **one scheme-independent canonical locus**,
so every surface grammar for the same verse resolves to the same `canonicalId`.

It lives in the **`domains/` tier** (NOT `packages/`) — a reusable, named package
that legitimately carries scripture vocabulary, kept out of the pure-substrate
`packages/` tree. It carries **no rendering text and no specific translation**
(ADR-0033 R1/R3): editions + text live in the app's off-platform store; this
package only addresses + selects.

```ts
import { parseScriptureAlias } from '@agenticprimitives/scripture-content-extension';

const r = parseScriptureAlias('John 3:16');
r.reference.id;        // canonicalId — same for 'scripture:john.3.16', 'Jn 3.16', OSIS, USFM…
r.selector;            // { kind:'scripture', work:'bible/John', book:'John', chapter:3, verse:16, versification:'protestant-66-v1' }
r.canonicalForm;       // the scheme-independent structured locus the core hashes
```

The `versification` is the **governance seam**: it is part of the canonical form,
so changing the verse-numbering model is a deliberate new namespace, never an
accidental break. Translation/edition is **never** part of the public name — it
is descriptor metadata (spec 267). Phase-1 aliases are US-ASCII only (confusable
defense). See [spec 267](../../specs/267-scripture-demo-vertical.md).
