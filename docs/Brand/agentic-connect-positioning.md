# Agentic Connect Brand Positioning

## The Big Idea

Agentic Connect is **passkey SSO for Smart Agents**.

It gives people the familiar ease of signing in with a name and a device prompt,
but adds something ordinary SSO does not have: apps only get the authority the
person explicitly grants.

```text
Sign in as rpedersen.agent.
Approve what the app can do.
Revoke it anytime.
```

The simple split:

```text
OIDC answers: who is this?
Delegation answers: what may this app do?
```

That is the brand story.

## The Core Difference

Most identity products stop at login.

They answer:

> Did this person sign in?

Agentic Connect answers more:

> Which Smart Agent signed in, which app is connected, what can that app do, and
> who is accountable for the action?

The result is SSO that feels familiar, but behaves like an agent-native authority
system.

## Custody vs Authority

Agentic Connect makes one distinction very clear.

**Custody** is control of the Smart Agent itself.

Custody means:

- protecting the person’s Smart Agent,
- adding or removing trusted credentials,
- recovering access,
- approving high-risk account changes.

Custody stays with the person.

**Authority** is permission for an app or agent to do a job.

Authority means:

- read a profile,
- create a workspace,
- launch a service agent,
- call a tool,
- perform a task within approved limits.

Authority can be granted to apps.

User-facing version:

> Your Smart Agent is yours. Apps only get the permissions you approve.

Developer-facing version:

> Root credentials hold custody. Connected apps receive scoped delegation.

## The User Experience

The user starts with a memorable agent name:

```text
rpedersen.agent
```

That name is the portable identity. It points to the person’s Smart Agent.

The person signs in with a passkey. The app receives a standard sign-in proof.
Then the app asks for permission to do its job.

```text
Connect this app to rpedersen.agent?

This app can:
✓ Read your approved profile
✓ Perform the task you selected
✓ Act only within this app

This app cannot:
✗ Change your passkeys
✗ Recover your Smart Agent
✗ Move funds without approval
✗ Act outside its permission

[ Approve with your device ]
```

The user does not need to understand keys, contracts, or caveats. The user sees a
connected app with clear access.

## The Product Promise

Agentic Connect combines three ideas users already understand:

```text
Name
Device confirmation
Connected apps
```

And turns them into a stronger identity model:

```text
Agent name
Passkey-controlled Smart Agent
Scoped app authority
```

The experience is simple:

```text
Type rpedersen.agent.
Confirm with your device.
Approve the app.
```

The control model is much stronger:

```text
The app gets permission, not ownership.
```

## How It Works, Without the Jargon

| User-facing idea | What it means underneath |
| --- | --- |
| **Agent name** | A memorable name like `rpedersen.agent` |
| **Secure device confirmation** | A passkey prompt from Windows Hello, Face ID, Android, or a hardware key |
| **Smart Agent** | The durable identity and control point behind the name |
| **Sign-in receipt** | An OIDC-style token that tells an app who signed in |
| **Connected app** | An app with limited permission to act for the Smart Agent |
| **Permission limits** | Safety rules: what the app can do, for how long, and where |
| **Revoke** | Turn off an app’s permission without changing the identity |

Technical terms like `credentialIdDigest`, RP ID, ERC-4337, ERC-7710, caveats,
and validators belong in developer documentation. The product language is:

```text
agent name, secure home, connected app, permission, revoke.
```

## Why It Is Different

### Beyond classic SSO

Classic SSO signs a user into apps.

Agentic Connect signs a Smart Agent into apps and lets the person decide what
authority each app receives.

```text
Classic SSO: This user signed in.
Agentic Connect: This Smart Agent signed in, and this app may do these things.
```

### Beyond passkey login

Passkeys make sign-in safer and easier. Agentic Connect uses passkeys as the
front door, then adds Smart Agent authority behind it.

```text
Passkey login proves presence.
Smart Agent authority defines permission.
```

### Beyond wallet connect

Wallet connect often feels like a raw signing session.

Agentic Connect gives the user a named identity, clear app permissions, and an
audit trail.

```text
Wallet connect asks: which wallet signed?
Agentic Connect asks: which agent acted, for whom, with what permission?
```

### Beyond smart wallets

Smart wallets make accounts programmable.

Agentic Connect makes app access programmable.

The root passkey protects the Smart Agent. Apps are not made into master keys.
Apps become connected services with limited authority.

### Beyond hosted wallet infrastructure

Hosted wallet platforms often manage policy inside their service.

Agentic Connect moves the authority anchor to the Smart Agent itself.

```text
The identity is not trapped in an app database.
The authority lives with the Smart Agent.
```

## The Blend of Leading Patterns

Agentic Connect combines the best ideas already emerging in the market:

- **Passkey-first SSO** from modern identity products.
- **OIDC-style interoperability** for apps that need standard sign-in.
- **P-256/WebAuthn smart-account signing** from smart wallet infrastructure.
- **Scoped delegation** from advanced permission and session-key systems.
- **Connected-app UX** from familiar account settings and enterprise access tools.

The differentiated blend:

```text
human-readable agent name
  + passkey confirmation
  + OIDC-compatible sign-in
  + Smart Agent custody
  + scoped connected-app authority
  + accountable actions
```

No single piece is the whole story. The power is in the combination.

## Personal Secure Home

Every person can have a secure home for their Smart Agent.

For `rpedersen.agent`, that secure home is where the root passkey lives and where
apps go when they need approval.

The secure home is not a conventional account portal. It is the control surface
for a person’s Smart Agent.

It lets the person:

- confirm sign-in,
- approve a connected app,
- review app permissions,
- revoke access,
- manage recovery,
- see what has acted on their behalf.

This creates an SSI-wallet-like experience without making every app handle
custody directly.

## OIDC + Delegation

The login layer should be familiar and standards-friendly.

```text
OIDC-style sign-in:
  This is rpedersen.agent.
```

The authority layer should be agent-native.

```text
Delegation:
  This connected app may perform these approved actions.
```

OIDC is the receipt. Delegation is the permission.

That split keeps the system simple for apps and safe for users.

## Connected Apps

The user-facing control surface is **Connected Apps**.

Example:

```text
Connected Apps

Workspace Builder
Access: Create and manage approved workspaces
Status: Active
Expires: 30 days

[ Revoke ]
```

Advanced details can reveal the underlying agent, issuer, and permission limits,
but the default experience should stay human.

## Brand Vocabulary

Use:

- Smart Agent
- Agent name
- Secure home
- Connected app
- Permission
- Access
- Revoke
- Confirm with your device
- Limited authority
- Acting on behalf of

Avoid in marketing copy:

- custodian,
- caveat,
- delegate key,
- credential role,
- RP ID,
- `credentialIdDigest`,
- ERC-7710,
- ERC-4337,
- validator module.

Those are implementation details, not the story.

## Canonical UX Copy

### Sign in

```text
Connect to Smart Agent

[ rpedersen____________ ]

Continue as rpedersen.agent
```

### First app connection

```text
This app is not connected yet.

Connect this app to rpedersen.agent?
```

### Consent

```text
Allow this app to work with rpedersen.agent?

This app can:
✓ Perform the task you selected
✓ Use only approved permissions
✓ Be revoked at any time

This app cannot:
✗ Change your passkeys
✗ Recover your Smart Agent
✗ Move funds without approval
✗ Act outside its permission
```

### Settings

```text
Connected Apps

Workspace Builder
Access: Approved workspace actions
Status: Active
Expires: 30 days

[ Revoke ]
```

## Short Positioning Variants

For users:

> Your agent name is your portable identity. Apps connect to it with your
> approval.

For developers:

> Add OIDC-compatible sign-in backed by passkeys, Smart Agents, and scoped app
> permissions.

For security reviewers:

> Apps are delegates, never custodians. Sign-in proves identity; delegation
> constrains authority.

For enterprise buyers:

> Give every person, organization, and service a passkey-controlled Smart Agent
> with connected-app permissions and accountable audit trails.

## Final Brand Line

Agentic Connect blends the familiarity of passkey SSO with the control of Smart
Agents: sign in with a name, confirm with your device, and grant apps only the
authority they need.
