---
"@agenticprimitives/contracts": patch
---

R12 — restore `forge coverage`. `forge coverage --ir-minimum` instruments every contract with viaIR at minimum optimization, and the new `SkillDefinitionRegistry`/`GeoFeatureRegistry` `publish` functions' in-memory struct literal (+ a dynamic `string`) overflowed solc's stack by one slot, producing zero coverage rows. Split the record write + event emit into a field-by-field `_storeAndEmit` helper so `publish`'s frame stays shallow — behaviour, ABI, and storage layout are identical. Added geo revert-branch tests (branch coverage 27% → 100%); the `check:forge-coverage` gate is strict again.
