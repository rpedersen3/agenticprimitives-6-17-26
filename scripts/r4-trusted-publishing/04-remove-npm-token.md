# R4.8 — remove `NPM_TOKEN` from `release.yml`

Once R4.7 has configured `npm trust github` for every package, the
release workflow can drop the legacy token-based auth entirely. The
publish step then auths purely via the OIDC token GitHub Actions
generates from `permissions.id-token: write`.

## The patch

In `.github/workflows/release.yml`, find the `Publish via changesets`
step and remove the `NPM_TOKEN` line from its `env:` block:

```diff
      - name: Publish via changesets (with provenance)
        id: changesets
        uses: changesets/action@v1
        with:
          publish: pnpm changeset publish
          version: pnpm changeset version
          title: 'chore(release): version packages'
          commit: 'chore(release): version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
-         # NPM_TOKEN is the legacy auth path. After R4.7 configures
-         # `npm trust github` for every package, R4.8 removes this
-         # secret and the publish auths purely via OIDC Trusted
-         # Publishing. Kept here until that switch lands.
-         NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Also drop the comment block ahead of the line (it describes a state
we just left behind).

## How to apply

```
git checkout -b chore/release-remove-npm-token
# edit release.yml per the diff above
git commit -am "R4.8: release.yml — remove NPM_TOKEN; rely on OIDC Trusted Publishing"
git push -u origin chore/release-remove-npm-token
gh pr create --base master --head chore/release-remove-npm-token \
  --title "R4.8: release.yml — remove NPM_TOKEN; rely on OIDC" \
  --body "After R4.7 configured Trusted Publishing for every package, the publish auths via OIDC. The NPM_TOKEN secret is no longer needed and is removed from the workflow."
```

## Verification

After this PR merges, the next push to `master` containing a changeset
should trigger:

1. `validate` job (full CI gate) — ✓
2. `release` job (publish) — auth via OIDC; no NPM_TOKEN env entry in
   the workflow log; provenance attestations land in the Sigstore
   transparency log as before; SBOM attached to the GH Release.

If the publish step fails after this PR with `EOIDCREQUIRES_NPM_AUTH`
or similar, it means one of the 17 packages was missed by R4.7. Re-run
`03-configure-trusted-publishing.sh` to ensure every package is
listed under Trusted Publishers on npm.

## Cleanup

Once Trusted Publishing has been verified, delete the (now-unused)
`NPM_TOKEN` repo secret:

```
gh secret delete NPM_TOKEN -R agentictrustlabs/agenticprimitives
```

This is the actual "remove the long-lived token" moment — the workflow
change above takes the workflow off the path; this step removes the
secret value entirely.

## Next

`05-merge-version-packages.sh` — when the changesets/action opens the
Version Packages PR on master, merge it. That push triggers the
Release workflow → publishes the first public `alpha` cleanly via OIDC.
