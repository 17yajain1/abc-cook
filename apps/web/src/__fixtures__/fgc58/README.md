# FGC-58 fixtures (R6b)

Frozen, web-only. Built in code from `apps/api/tests/fixtures/import/kadhi-pakora.original.json` with one
extra step (`origin: 'added'`) inserted before the last step, then run through `reprocess()`
(R6b W0 item 4, `notes/r6b/w0/report.md` section 3). No LLM, no network.

| files | what it is |
|---|---|
| `added.*` | the added step is a node (`step_wipe_the_pan_with_a_thin`, node 10 of 13); provenance marks it `origin: 'added'` |
| `dropped.*` | same text, but the step names an ingredient the source does not list, so it is dropped (12 nodes, no `added` provenance) |
| `dropped-time.*` | dropped for an ungrounded time ("rest it for 37 minutes") |

`*.plan-response.json` is the 4-key payload the app stores. `*.provenance.json` is `import_meta.provenance`,
which `derive.ts` reads for the "Added by ABC Cook" label. They live in this sub-folder so the
`__fixtures__/*.plan-response.json` globs (quantityLine golden, servings identity) do not pick them up.
