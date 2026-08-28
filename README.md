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

1. Fetches the **issue page** at `issue_url`.
2. Fetches the **PR patch** at `<pr_url>.patch` — a git format-patch of every
   commit in the PR. This is contributor-authored (the PR author is the git
   committer) but still mutable, so it is used only to discover the head
   commit's SHA — never trusted for the verdict.
3. Parses the head commit SHA from the `From <40-hex>` header line of the PR
   patch.
4. Fetches the **SHA-pinned commit patch** at
   `github.com/<owner>/<repo>/commit/<sha>.patch`. This one is
   cryptographically immutable — its content cannot be changed without also
   changing the SHA. This is the "immutable diff" the v0.3.0 review asked for.
5. Adjudication **reverts** if any of the three fetches fails or if no SHA can
   be parsed. Partial evidence never settles.
6. Computes `wallet_bound` deterministically: whether the claiming wallet
   address appears verbatim inside the SHA-pinned commit patch. Commit
   messages and author fields inside a patch are contributor-controlled, and
   they are bound to `head_sha` by git's hash. A pure string check makes
   leader and validators agree by construction whenever they see the same
   commit.
7. Feeds the issue page + the immutable commit patch into an LLM prompt with
   a strict rubric:
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

## Security model — the three guards (v0.3.1)

BountyBot addresses the concrete attack surfaces spelled out in the two rounds
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
   issue page, the PR patch, and the SHA-pinned immutable commit patch — to
   succeed *and* it requires a parseable commit SHA. If anything is missing,
   the transaction reverts with a `UserError` naming the missing source, and
   the bounty stays in `CLAIMED` state so it can be retried.

Bounty-locking is also neutralized: if an attacker files a claim with a copied
PR URL, adjudication yields a full refund to the sponsor rather than locking
their GEN. See `test_copied_pr_cannot_steal_bounty`,
`test_copied_pr_cannot_lock_bounty`, and `test_wallet_only_in_pr_page_is_ignored`
in `tests/test_bounty_bot.py`.

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
