# walker-keyed-door

Ticket: walker-dump-door · NONCE-WALKER-DUMP-DOOR-20260918

## Apply

```bash
# from repo root, on branch feat/walker-keyed-door
patch -p1 < patches/walker-keyed-door.index.html.patch
```

Or replace `index.html` with the Deep Scan box file:
`/workspace/walker-door-ticket/index.html.patched`

## Behavior

- Public `DOOR_URL` = Iris /exec Version 37 (no new deployment id)
- Door key in `localStorage` key `joeos.now.door_key` (STUCK → Raw door, one field)
- DUMP POSTs JSON `{key,text,receipt_id,schema,origin_surface:"walker"}` — door wraps RAW_SHAPE_v1
- Hold queue reuses `receipt_id` across retries
- Apps Script additive paste is NOT in this repo — see Chief handoff

## Note on branch tip

If `index.html` on this branch is still a stub, apply the patch above before merge.
