# BountyBot

**Trustless GitHub bounties, adjudicated by AI validator consensus on GenLayer studionet.**

- **Live app:** <https://bountybot-genlayer.vercel.app>
- **Contract:** [`0xB310782fD5C93C67be9f78Fedb34B4E53532fbf0`](https://genlayer-explorer.vercel.app/address/0xB310782fD5C93C67be9f78Fedb34B4E53532fbf0) on GenLayer studionet
- **Repo:** <https://github.com/phu1271997/bountybot>

Sponsors lock GEN against a public GitHub issue. Contributors claim a bounty by
submitting a Pull Request. The GenLayer Intelligent Contract then reads the
issue page, the PR page, and the raw PR diff **directly on-chain** (no oracle,
no relayer), lets a set of validator LLMs judge whether the PR actually fixes
the issue, and pays out — no maintainer approval needed.

- **Track:** Agentic Economy + Future of Work
- **Network:** GenLayer studionet only (`https://studio.genlayer.com`)
- **Submit through:** [GenLayer Portal · Builders track](https://portal.genlayer.foundation/#/builders/contributions)

---

## Why it dies without GenLayer

- The "does this PR fix that issue?" call is **subjective** and reads
  **unstructured prose** (issue description) plus **code** (PR diff). Solidity
  cannot do either.
- A regular AI service running off-chain would need a trusted operator that
  everyone accepts. The whole point of the bounty is to remove that trusted
  operator.
- GenLayer runs the judgement across many independent validator LLMs and
  reaches consensus. Payout is deterministic once the vote settles.
- Chain data is read on-chain via `gl.nondet.web.render` — no third-party oracle
  is in the loop.

## Consensus design (what the validator checks)

The contract uses `gl.vm.run_nondet(leader_fn, validator_fn)`. The leader:

1. Fetches `issue_url`, `pr_url`, and `<pr_url>.diff` via `gl.nondet.web.render`.
   Adjudication **reverts** if any of the three cannot be retrieved — partial
   evidence never settles.
2. Computes `wallet_bound` deterministically: whether the claiming wallet
   address appears verbatim inside the PR page. This is a pure string check
   run inside the non-deterministic block, so leader and validators agree by
   construction whenever they see the same page.
3. Feeds all three into an LLM prompt with a strict rubric:
   - `HIGH` — substantial change addressing root cause, tests included → 100% payout.
   - `MID`  — fixes the issue but minimal / workaround → 60% payout.
   - `LOW`  — trivial, unrelated, or doesn't fix → 0% payout (full refund).
4. Returns `{ fixes_issue: bool, quality: str, wallet_bound: bool, reason: str }`.

The validator re-runs the same fetch + LLM + wallet check independently and
**only compares the three verdicts** (`fixes_issue`, `quality`, `wallet_bound`).
It ignores the free-text `reason` — two validators that phrase their
justification differently still pass consensus. Two validators that disagree
on the verdict do not.

That single design decision is why the contract can score high on Trục 2
("validators check meaning, not shape") in the Builder rubric.

## Security model — the three guards

BountyBot addresses three concrete attack surfaces spelled out in the reviewer
feedback for v0.2.0:

1. **Wallet-to-PR identity binding.** `submit_claim` records the caller's
   wallet address. At adjudication, the contract fetches the PR page from
   `github.com` and requires that the claimer's address appear verbatim in the
   PR body. If it does not, the sponsor is refunded 100% and the bounty is
   marked `REJECTED` — copied PR URLs cannot steal payout. Contributors are
   instructed by the UI to paste `Bounty claim by: 0x…` into their PR
   description; the copy-button in the app produces the exact line.
2. **Same-repository requirement.** `submit_claim` extracts `{owner}/{repo}`
   from both the bounty's issue URL and the submitted PR URL and rejects the
   claim if they differ. A PR from `org/other-repo` cannot settle a bounty
   posted against `org/repo`.
3. **All-evidence-or-revert.** `adjudicate` requires all three fetches — the
   issue page, the PR page, and the immutable `.diff` — to succeed. If any one
   is unreachable, the transaction reverts with a `UserError` naming the
   missing source, and the bounty stays in `CLAIMED` state so it can be retried.

Bounty-locking is also neutralized: if an attacker files a claim with a copied
PR URL, adjudication yields a full refund to the sponsor rather than locking
their GEN. See `test_copied_pr_cannot_steal_bounty` and
`test_copied_pr_cannot_lock_bounty` in `tests/test_bounty_bot.py`.

## Repository layout

```
BountyBot/
├── contracts/
│   └── bounty_bot.py       # The Intelligent Contract
├── tests/
│   ├── conftest.py
│   └── test_bounty_bot.py  # gltest suite (mocks LLM + web)
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # UI: create / claim / adjudicate + list
│   │   ├── client.js       # genlayer-js + MetaMask chain switching
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example        # copy → .env.local, paste deployed address
├── scripts/
│   └── deploy/
│       └── DEPLOY.md       # step-by-step studionet deploy
└── README.md
```

---

## Deployment on GenLayer studionet

### 1. Prepare a funded wallet

Add the GenLayer studionet to MetaMask (the frontend does this automatically on
Connect, or add it manually):

| Field | Value |
|---|---|
| Chain ID | `61999` (hex `0xF1EF`) |
| RPC | `https://studio.genlayer.com/api` |
| Symbol | `GEN` |
| Explorer | `https://genlayer-explorer.vercel.app` |

Then, in [GenLayer Studio](https://studio.genlayer.com), open the **Accounts**
panel and transfer GEN from one of the pre-funded studio accounts to your
MetaMask address. **Do NOT use the testnet faucet — testnet and studionet are
separate networks.**

### 2. Deploy the contract via GenLayer Studio (recommended)

1. Open `https://studio.genlayer.com/contracts`.
2. New contract → paste the contents of `contracts/bounty_bot.py`.
3. Deploy. Once the transaction shows `Status: FINALIZED`, click it and confirm
   the sidebar shows **`Result: SUCCESS`** — a finalized status alone is not
   enough (see `~GEN_RULES/02-common-errors.md`).
4. Copy the contract address that appears in the deployment record.

### 3. Wire the frontend

```bash
cd frontend
cp .env.example .env.local
# paste the deployed contract address into VITE_CONTRACT_ADDRESS
npm install
npm run dev
```

Open http://localhost:5173. Connect MetaMask, funded on studionet, and try the
flow:

1. **Create bounty** — paste a real GitHub issue URL and lock some GEN.
2. **Claim a bounty** — the PR must live in the same repository as the issue,
   and its description must contain your wallet address verbatim (the UI
   provides a copy-button that produces the exact line to paste).
3. **Adjudicate** — hit the button, wait ~30–90s for validator consensus,
   watch the AI verdict and payout appear.

### 4. Deploy the frontend

```bash
cd frontend
npm run build
# Deploy /dist to Vercel or Netlify, or run `vercel deploy`
```

Set the same `VITE_CONTRACT_ADDRESS` on your hosting provider.

---

## Local test loop

The tests install LLM + web mocks so validator consensus resolves deterministically.

```bash
pip install genlayer-test
gltest tests/ --network localnet   # fast loop
gltest tests/ --network studionet  # optional real-inference run
```

The tests cover:

| Case | Expectation |
|---|---|
| HIGH-quality PR, wallet bound | `PAID_FULL`, contributor receives full amount |
| MID-quality PR, wallet bound | `PAID_PARTIAL`, 60% to contributor, 40% refund |
| LOW-quality PR, wallet bound | `REJECTED`, sponsor refunded fully |
| Double claim on same bounty | rejected with `Bounty is not open` |
| Zero-value bounty | rejected with `positive` |
| Non-github URL | rejected with `format` |
| PR URL from a different repository | rejected with `same repository` at `submit_claim` |
| Copied PR (wallet not bound) — **cannot steal** | `REJECTED`, sponsor refunded 100% |
| Copied PR (wallet not bound) — **cannot lock** | `total_locked == 0` after adjudication |
| Adjudication with unreachable `.diff` | reverts, bounty stays `CLAIMED` |
| Adjudication with unreachable issue page | reverts, bounty stays `CLAIMED` |
| Adjudication with unreachable PR page | reverts, bounty stays `CLAIMED` |
| Sponsor cancels open bounty | full refund |

---

## Deployed contract

- **Network:** GenLayer studionet (chainId `61999`)
- **Contract address:** [`0xB310782fD5C93C67be9f78Fedb34B4E53532fbf0`](https://genlayer-explorer.vercel.app/address/0xB310782fD5C93C67be9f78Fedb34B4E53532fbf0)

---

## What is not in scope

- The contract only judges GitHub issues + PRs. GitLab and other hosts are
  explicitly rejected.
- Payout tiers are fixed at 100 / 60 / 0 percent. A production version would
  let the sponsor pick a curve.
- Cross-chain claims and off-chain KYC are not attempted.

## References

- GenLayer docs: https://docs.genlayer.com
- GenLayer SDK API: https://sdk.genlayer.com/main/_static/ai/api.txt
- Storage rules: https://docs.genlayer.com/developers/intelligent-contracts/storage
