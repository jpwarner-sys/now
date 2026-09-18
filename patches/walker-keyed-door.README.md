# walker-keyed-door

Ticket: **walker-dump-door** · NONCE-WALKER-DUMP-DOOR-20260918  
Ruling: APPROVE WITH EDITS · Deep Scan does **not** deploy Apps Script

## Apply client change

```bash
git checkout feat/walker-keyed-door-v2
patch -p1 < patches/walker-keyed-door.index.html.patch
# or copy from Deep Scan box:
#   /workspace/walker-door-ticket/index.html.patched  →  index.html
```

## Behavior

- Public `DOOR_URL` = Iris `/exec` Version 37 (do not mint)
- Door key in `localStorage` `joeos.now.door_key` (STUCK → Raw door, one field)
- DUMP POSTs JSON `{key,text,receipt_id,schema,origin_surface:"walker"}` — server wraps RAW_SHAPE_v1
- Hold queue reuses `receipt_id`
- Apps Script additive: `/workspace/walker-door-ticket/Code.gs.walker_door_ADDITIVE.gs` (Chief paste + deploy)

## Branch note

`feat/walker-keyed-door` had a stub `index.html` from an oversized MCP push attempt — prefer **this** branch (`-v2`) from `main`, then apply the patch.
