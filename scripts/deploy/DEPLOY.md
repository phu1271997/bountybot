# Deploy BountyBot to GenLayer studionet

## Prerequisites

- MetaMask installed and unlocked
- A funded wallet on GenLayer studionet (see README §1)

## A. Deploy via GenLayer Studio (recommended, no CLI needed)

1. Open <https://studio.genlayer.com/contracts>.
2. Click **New Contract** → **Blank Python**.
3. Delete the default template.
4. Copy the entire content of `contracts/bounty_bot.py` and paste it in.
   Important: the first line **must** be the `# { "Depends": ... }` pragma
   comment. Do not add any blank line above it.
5. Click **Deploy**. Wait for `Status: FINALIZED`.
6. Click the deployment transaction in the sidebar. Verify the sidebar shows
   `Result: SUCCESS`. If it shows `Result: ERROR`, read the traceback and cross-
   reference `~GEN_RULES/02-common-errors.md`.
7. Copy the new contract address.

## B. Deploy via GenLayer CLI (optional)

```bash
npm install -g @genlayer/cli
genlayer deploy contracts/bounty_bot.py \
  --network studionet \
  --from <your funded address>
```

Save the returned address.

## C. Record the address

Paste it into:

- `frontend/.env.local` as `VITE_CONTRACT_ADDRESS`
- `README.md` under the "Contract address" line
- Your submission notes on GenLayer Portal

## D. Post-deploy smoke test

1. Open `frontend` (`npm run dev`).
2. Connect MetaMask (must be funded on studionet).
3. Create a bounty with a tiny amount (e.g. `0.01 GEN`) against a public
   GitHub issue that already has a merged PR — quick sanity check.
4. Submit a claim with that PR URL.
5. Click **Adjudicate** and wait for the validator vote.
6. Confirm on the Explorer that the payout emit_transfer happened.

## Common deploy failures

| Symptom | Fix |
|---|---|
| `Could not load contract schema` | check the version pragma on line 1 is intact and matches Studio's template |
| `AssertionError: TreeMap <- TreeMap` on FINALIZED tx | ensure `__init__` does not reassign `TreeMap()` |
| `TypeError: use bigint or one of sized integers please` | you accidentally changed a `u256`/`bigint` field to bare `int` |
| Sidebar says `Result: ERROR` on a `payable` write | you probably forgot to send `value` on `create_bounty`, or the sender is not funded on studionet |
