# Walker keyed DUMP door (client)

Ticket: **walker-dump-door** · NONCE-WALKER-DUMP-DOOR-20260918 · Chief: APPROVE WITH EDITS · NO DEPLOY from agents

## Apply to root `index.html` (from this branch)

```bash
bash patches/apply_walker_door_client.sh
```

That script:
1. Concatenates `patches/walker-keyed-door.index.html.patch.gz.b64.part{0,1,2}`
2. `base64 -d | gunzip` → `patches/walker-keyed-door.index.html.patch`
3. `patch -p1` onto root `index.html`
4. Asserts `DOOR_URL`, `doorKeyBox`, and version `0.9.4`

Verified: applied to `main` `index.html` → sha256 `af5628ba38c40d244ce35644be68ccfcf5569d73457af8f50ecc9fe56ee56670` (matches Deep Scan box `index.html.patched`).

## Behavior

- Public door URL: Iris `/exec` Version 37 (do not mint a new deployment id)
- Door key in `localStorage` key `joeos.now.door_key`; STUCK → Raw door one-field setup
- DUMP POSTs JSON `{key,text,receipt_id,schema,origin_surface}` — **no key in URL**
- Door wraps RAW_SHAPE_v1 server-side (`writeRawCapture_` / `buildRawBody_`)
- Hold queue on phone if door fails; flush on next DUMP; reuse `receipt_id`
- `origin_surface: walker`

## Not in this PR

Apps Script additive lives on the Deep Scan box only (agents do not clasp):

- `/workspace/walker-door-ticket/Code.gs.walker_door_ADDITIVE.gs`
- `/workspace/walker-door-ticket/HANDOFF_CHIEF_DEPLOY.md`
- `/workspace/walker-door-ticket/TEST_PLAN_dummy.md`
- `/workspace/walker-door-ticket/walker_index_DUMP_PATCH.md`

## Do not merge until

- [ ] `bash patches/apply_walker_door_client.sh` succeeds on a clean `main` checkout
- [ ] STUCK → Raw door shows one-field door key
- [ ] After Chief door deploy + `KEY_CURRENT`: DUMP `TOKEN_L pickup school` → one raw file
- [ ] Iris `doGet` still loads
