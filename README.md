# BountyBot

**Trustless GitHub bounties, adjudicated by AI validator consensus on GenLayer studionet.**

- **Live app:** <https://bountybot-rho.vercel.app> (primary) · <https://phu1271997.github.io/bountybot/> (GH Pages fallback)
- **Contract:** [`0x3b5E1058d60fE6Ae7b50Dc84bf048679FEB6df99`](https://genlayer-explorer.vercel.app/address/0x3b5E1058d60fE6Ae7b50Dc84bf048679FEB6df99) on GenLayer studionet
- **Repo:** <https://github.com/phu1271997/bountybot>

Sponsors lock GEN against a public GitHub issue. Contributors claim a bounty by
submitting a Pull Request. The GenLayer Intelligent Contract then reads the
issue page and the **full PR patch** (every commit) **directly on-chain** (no
oracle, no relayer), pins the head commit SHA, binds the claiming wallet to the
immutable `commit/<sha>.patch`, lets a set of validator LLMs judge whether the
PR actually fixes the issue, and pays out — no maintainer approval needed.

**v0.4.0 adds (round-3 review fixes):**
- **Full-PR adjudication** — the LLM judges the entire cumulative PR diff, not
  just the head commit. A documented empty "marker" commit can no longer make
  adjudication inspect the wrong (empty) diff. Identity is still bound to the
  immutable SHA-pinned commit patch.
- **Authorized timeout recovery** — a claimed bounty can never be stranded. The
  sponsor can reclaim the full escrow via `reclaim_expired_claim` once the
  3-day claim window elapses (`get_claim_timeout` exposes it on-chain).
- **No premature close** — during the claim window only the claimer or the
  sponsor may trigger `adjudicate`; an unrelated wallet cannot force a verdict
  on an in-progress claim. After the window, anyone may settle it.
- **Case Explorer** — a read-only `/explorer` (alias `/history`) route that
  surfaces every resolved case: verdict, quality tier, pinned SHA, and payout.

**Earlier (v0.3.2):**
- **Direct assignment** — sponsor can pin a bounty to a specific contributor
  wallet at create-time, so nobody else can race in.
- **Split UI** — separate routes for the dashboard (`/app`), posting
  (`/create`), and each bounty (`/bounty/:id`) with a proper stage-flow view.
- **Landing page** with problem statement, security model, comparison table,
  use-cases, and FAQ.

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

The contract runs consensus through `gl.vm.run_nondet_default` (the sandboxed
variant — SDK v0.3.0 renamed the safe API, so we resolve it defensively). The
leader:

1. Fetches the **issue page** at `issue_url`.
2. Fetches the **full PR patch** at `<pr_url>.patch` — a git format-patch of
   *every* commit in the PR. This is the complete cumulative change and is what
   the LLM judges. Judging only the head commit (as v0.3.x did) let a
   contributor hide the real work behind an empty marker commit; judging the
   whole patch closes that.
3. Parses the head commit SHA from the last `From <40-hex>` header of the PR
   patch and pins the verdict to it. A force-push mid-consensus changes the SHA,
   so validators disagree and consensus fails safe (the sponsor can then recover
   via `reclaim_expired_claim`).
4. Fetches the **SHA-pinned head commit patch** at
   `github.com/<owner>/<repo>/commit/<sha>.patch`. This one is cryptographically
   immutable — its content cannot change without changing the SHA — and is used
   to bind the claiming wallet (below).
5. Adjudication **reverts** if any of the three fetches fails or if no SHA can
   be parsed. Partial evidence never settles.
6. Computes `wallet_bound` deterministically: whether the claiming wallet
   address appears verbatim inside the SHA-pinned commit patch. Commit messages
   and author fields inside a patch are contributor-controlled, and they are
   bound to `head_sha` by git's hash. A pure string check makes leader and
   validators agree by construction whenever they see the same commit. (The
   documented claim workflow pushes an empty `Bounty claim by: 0x…` commit last,
   so it lands here as the head commit — identity binds, while step 2 still sees
   the real work.)
7. Feeds the issue page + the **full PR patch** into an LLM prompt with a strict
   rubric (empty/marker commits explicitly ignored):
   - `HIGH` — substantial change addressing root cause, tests included → 100% payout.
   - `MID`  — fixes the issue but minimal / workaround → 60% payout.
   - `LOW`  — trivial, unrelated, or doesn't fix → 0% payout (full refund).
8. Returns `{ fixes_issue, quality, wallet_bound, head_sha, reason }`.

The validator re-runs the same fetch + LLM + wallet check independently and
**only compares the four verdicts** (`fixes_issue`, `quality`, `wallet_bound`,
`head_sha`). It ignores the free-text `reason` — two validators that phrase
their justification differently still pass consensus. Two validators that
disagree on the verdict do not.

That single design decision is why the contract can score high on Trục 2
("validators check meaning, not shape") in the Builder rubric.

## Security model — the guards (v0.4.0)

BountyBot addresses the concrete attack surfaces spelled out across three rounds
of reviewer feedback:

1. **Wallet-to-commit identity binding (SHA-pinned, contributor-authored).**
   `submit_claim` records the caller's wallet address. At adjudication, the
   contract fetches the PR patch, parses the head commit SHA, then fetches
   `github.com/<owner>/<repo>/commit/<sha>.patch` — which is
   contributor-authored (the git commit message) *and* cryptographically
   pinned to the SHA. The claiming wallet must appear inside that patch. A
   wallet mentioned only in the rendered PR page or in a third-party comment
   is deliberately ignored — anyone can leave a comment on any PR, so the
   rendered page is not contributor-controlled content. If the wallet is not
   in the commit patch, the sponsor is refunded 100% and the bounty is
   marked `REJECTED`.

   Contributors get an exact line to paste from the UI (`Bounty claim by:
   0x…`) plus a one-liner:

   ```bash
   git commit --allow-empty -m "Bounty claim by: 0xYOUR_WALLET"
   git push
   ```

2. **Same-repository requirement.** `submit_claim` extracts `{owner}/{repo}`
   from both the bounty's issue URL and the submitted PR URL and rejects the
   claim if they differ. A PR from `org/other-repo` cannot settle a bounty
   posted against `org/repo`.

3. **All-evidence-or-revert.** `adjudicate` requires all three fetches — the
   issue page, the full PR patch, and the SHA-pinned immutable commit patch — to
   succeed *and* it requires a parseable commit SHA. If anything is missing,
   the transaction reverts with a `UserError` naming the missing source, and
   the bounty stays in `CLAIMED` state so it can be retried.

4. **Full-PR evaluation, not a single commit.** The LLM judges the entire
   cumulative PR patch. An empty marker commit (or any single trivial commit)
   can no longer make adjudication inspect the wrong diff. Identity binding
   still uses the immutable SHA-pinned head commit patch. See
   `test_empty_marker_head_commit_still_judges_full_pr`.

5. **No stranded escrow — authorized timeout recovery.** A claimed bounty can
   never be locked forever. `submit_claim` stamps `claimed_at`; after
   `CLAIM_TIMEOUT_SECONDS` (3 days, readable via `get_claim_timeout`) the
   **sponsor** — and only the sponsor — can call `reclaim_expired_claim` for a
   full refund. See `test_reclaim_before_timeout_rejected`,
   `test_reclaim_requires_sponsor`.

6. **No premature close.** During the claim window only the claimer or the
   sponsor may `adjudicate`; an unrelated wallet cannot force a verdict on an
   in-progress claim. Once the window elapses, anyone may settle it, so a stale
   claim never blocks the board. See `test_stranger_cannot_adjudicate_before_window`.

Bounty-locking is also neutralized: if an attacker files a claim with a copied
PR URL, adjudication yields a full refund to the sponsor rather than locking
their GEN. See `test_copied_pr_cannot_steal_bounty`,
`test_copied_pr_cannot_lock_bounty`, and `test_wallet_only_in_pr_page_is_ignored`
in `tests/test_bounty_bot.py`.

## Repository layout

```
BountyBot/
├── contracts/
│   └── bounty_bot.py             # The Intelligent Contract (v0.4.0)
├── tests/
│   ├── conftest.py
│   └── test_bounty_bot.py        # gltest suite (mocks LLM + web)
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # router: /, /app, /create, /explorer, /bounty/:id
│   │   ├── client.js             # genlayer-js + MetaMask chain switching
│   │   ├── main.jsx
│   │   ├── styles.css
│   │   ├── components/
│   │   │   ├── TopNav.jsx
│   │   │   ├── BountyCard.jsx
│   │   │   └── Footer.jsx
│   │   ├── hooks/
│   │   │   ├── useWallet.js
│   │   │   └── useBounties.js
│   │   └── pages/
│   │       ├── LandingPage.jsx   # /  — pitch, security, compare, FAQ
│   │       ├── DashboardPage.jsx # /app — stats + filterable board
│   │       ├── CreateBountyPage.jsx # /create — form w/ direct-assign
│   │       ├── ExplorerPage.jsx  # /explorer — resolved cases + payouts
│   │       └── BountyDetailPage.jsx # /bounty/:id — staged flow + reclaim
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example              # paste deployed address here
├── scripts/
│   ├── deploy.py                 # genlayer-py studionet deploy (reads env key)
│   └── deploy/
│       └── DEPLOY.md             # step-by-step studionet deploy
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

### 2. Deploy the contract

**Option A — scripted (genlayer-py):**

```bash
source ~/.genlayer/env.sh          # exports GENLAYER_PRIVATE_KEY (funded on studionet)
python3 scripts/deploy.py --chain studionet
```

The script pre-checks the schema, deploys, waits for `FINALIZED`, and prints the
contract address + explorer link.

**Option B — GenLayer Studio (no CLI):**

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
   and one of its **commit messages** must contain your wallet address
   verbatim (the UI provides a copy-button and a `git commit --allow-empty`
   one-liner). Comments and the PR description are ignored — only the
   SHA-pinned commit patch counts.
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
| HIGH-quality PR, wallet in SHA-pinned commit | `PAID_FULL`, contributor receives full amount |
| MID-quality PR, wallet in SHA-pinned commit | `PAID_PARTIAL`, 60% to contributor, 40% refund |
| LOW-quality PR, wallet in SHA-pinned commit | `REJECTED`, sponsor refunded fully |
| Double claim on same bounty | rejected with `Bounty is not open` |
| Zero-value bounty | rejected with `positive` |
| Non-github URL | rejected with `format` |
| PR URL from a different repository | rejected with `same repository` at `submit_claim` |
| Copied PR (wallet not in commit) — **cannot steal** | `REJECTED`, sponsor refunded 100% |
| Copied PR (wallet not in commit) — **cannot lock** | `total_locked == 0` after adjudication |
| Wallet appears in mutable PR patch but NOT in SHA-pinned commit patch | `REJECTED` — rendered-page wallet is deliberately ignored |
| Adjudication with unreachable SHA-pinned commit patch | reverts, bounty stays `CLAIMED` |
| Adjudication with unreachable issue page | reverts, bounty stays `CLAIMED` |
| Adjudication with unreachable PR patch | reverts, bounty stays `CLAIMED` |
| PR patch has no parseable commit SHA | reverts, bounty stays `CLAIMED` |
| Sponsor cancels open bounty | full refund |
| Empty marker commit as PR head | judged from **full** PR patch → `PAID_FULL` (not an empty diff) |
| Unrelated wallet adjudicates a fresh claim | rejected with `claim window` |
| Sponsor reclaims before the timeout | rejected with `window has not elapsed` |
| Non-sponsor calls `reclaim_expired_claim` | rejected with `Only the sponsor` |
| `reclaim_expired_claim` on an open bounty | rejected with `claimed bounty` |
| `submit_claim` stamps `claimed_at` | non-zero claim timestamp recorded |

---

## Deployed contract

- **Network:** GenLayer studionet (chainId `61999`)
- **Contract address:** [`0x3b5E1058d60fE6Ae7b50Dc84bf048679FEB6df99`](https://genlayer-explorer.vercel.app/address/0x3b5E1058d60fE6Ae7b50Dc84bf048679FEB6df99)

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
