# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

import json
import re

ALLOWED_QUALITY = ["LOW", "MID", "HIGH"]
STATUS_OPEN = "OPEN"
STATUS_CLAIMED = "CLAIMED"
STATUS_PAID_FULL = "PAID_FULL"
STATUS_PAID_PARTIAL = "PAID_PARTIAL"
STATUS_REJECTED = "REJECTED"
STATUS_EXPIRED = "EXPIRED"

QUALITY_PAYOUT_BPS = {
    "HIGH": 10000,
    "MID": 6000,
    "LOW": 0,
}

MAX_URL = 300
MAX_REASON = 700

# How long a CLAIMED bounty may sit before its escrow can be recovered.
# Until this elapses, only the claimer or the sponsor may trigger adjudication
# (so an unrelated wallet cannot prematurely close an in-progress claim). Once
# it elapses, the sponsor may reclaim the escrow and anyone may adjudicate.
CLAIM_TIMEOUT_SECONDS = 3 * 24 * 60 * 60  # 3 days

GITHUB_ISSUE_RE = r"^https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/issues/\d+/?$"
GITHUB_PR_RE = r"^https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/pull/\d+/?$"
GITHUB_REPO_RE = re.compile(
    r"^https://github\.com/([A-Za-z0-9_.\-]+)/([A-Za-z0-9_.\-]+)/(issues|pull)/\d+/?$"
)
SHA_HEADER_RE = re.compile(r"^From ([0-9a-fA-F]{40})\b", flags=re.MULTILINE)
SHA_LOOSE_RE = re.compile(r"\b([0-9a-fA-F]{40})\b")

# Prefer the sandboxed consensus API. In SDK v0.3.0 the safe variant was
# renamed `run_nondet_default` and bare `run_nondet` became the UNSAFE one, so
# resolve defensively: run_nondet_default (new safe) -> run_nondet (old safe)
# -> run_nondet_unsafe (last resort).
def _run_nondet(leader_fn, validator_fn):
    fn = (
        getattr(gl.vm, "run_nondet_default", None)
        or getattr(gl.vm, "run_nondet", None)
        or gl.vm.run_nondet_unsafe
    )
    return fn(leader_fn, validator_fn)


def _now_epoch() -> int:
    """Deterministic transaction timestamp in whole seconds. All validators
    see the same value in deterministic mode."""
    return int(gl.vm.get_timestamp().timestamp())


def _addr_str(addr: Address) -> str:
    try:
        return addr.as_hex
    except Exception:
        return str(addr)


def _clean_text(value, limit: int) -> str:
    text = str(value or "").strip()
    return re.sub(r"[\x00-\x1f\x7f]", "", text)[:limit]


def _validate_url(url: str, pattern: str, label: str) -> str:
    if not isinstance(url, str) or len(url) > MAX_URL:
        raise gl.vm.UserError("Invalid " + label + " URL length")
    if not re.match(pattern, url):
        raise gl.vm.UserError("Invalid " + label + " URL format")
    return url


def _extract_repo(url: str):
    match = GITHUB_REPO_RE.match(url)
    if not match:
        raise gl.vm.UserError("Cannot extract repo from URL")
    return (match.group(1).lower(), match.group(2).lower())


def _normalize_verdict(raw):
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raise gl.vm.UserError("LLM returned non-JSON")
    if not isinstance(raw, dict):
        raise gl.vm.UserError("LLM returned invalid shape")
    fixes = bool(raw.get("fixes_issue"))
    quality = str(raw.get("quality", "LOW")).upper()
    if quality not in ALLOWED_QUALITY:
        quality = "LOW"
    if not fixes:
        quality = "LOW"
    reason = _clean_text(raw.get("reason", ""), MAX_REASON)
    return {"fixes_issue": fixes, "quality": quality, "reason": reason}


class Contract(gl.Contract):
    owner: Address
    bounties: TreeMap[str, str]
    bounty_count: u256
    total_locked: u256

    def __init__(self):
        self.owner = gl.message.sender_address
        self.bounty_count = u256(0)
        self.total_locked = u256(0)

    @gl.public.view
    def get_bounty(self, bounty_id: str) -> str:
        return self.bounties.get(bounty_id, "")

    @gl.public.view
    def get_bounty_count(self) -> u256:
        return self.bounty_count

    @gl.public.view
    def get_total_locked(self) -> u256:
        return self.total_locked

    @gl.public.view
    def get_claim_timeout(self) -> u256:
        return u256(CLAIM_TIMEOUT_SECONDS)

    @gl.public.view
    def list_bounties(self, start: u256, limit: u256) -> str:
        start_i = int(start)
        limit_i = min(int(limit), 50)
        total = int(self.bounty_count)
        out = []
        for i in range(start_i, min(start_i + limit_i, total)):
            key = str(i + 1)
            raw = self.bounties.get(key, "")
            if raw:
                try:
                    out.append(json.loads(raw))
                except Exception:
                    continue
        return json.dumps({"items": out, "total": total})

    @gl.public.write.payable
    def create_bounty(self, issue_url: str, assignee: str) -> None:
        amount = int(gl.message.value)
        if amount <= 0:
            raise gl.vm.UserError("Bounty amount must be positive")
        issue_url = _validate_url(issue_url, GITHUB_ISSUE_RE, "issue")

        # Optional direct-assignment: if `assignee` is a 0x address, only that
        # wallet may submit_claim. Empty string keeps the bounty open to any
        # contributor (default behavior).
        assignee_norm = ""
        if assignee:
            candidate = assignee.strip()
            if not re.match(r"^0x[0-9a-fA-F]{40}$", candidate):
                raise gl.vm.UserError("Invalid assignee address")
            assignee_norm = candidate.lower()

        new_id = int(self.bounty_count) + 1
        bounty_id = str(new_id)
        record = {
            "id": bounty_id,
            "sponsor": _addr_str(gl.message.sender_address),
            "issue_url": issue_url,
            "amount": str(amount),
            "assignee": assignee_norm,
            "pr_url": "",
            "claimer": "",
            "status": STATUS_OPEN,
            "quality": "",
            "reason": "",
            "fixes_issue": None,
            "wallet_bound": None,
            "head_sha": "",
            "claimed_at": "0",
            "payout": "0",
            "refund": "0",
        }
        self.bounties[bounty_id] = json.dumps(record, sort_keys=True)
        self.bounty_count = u256(new_id)
        self.total_locked = u256(int(self.total_locked) + amount)

    @gl.public.write
    def submit_claim(self, bounty_id: str, pr_url: str) -> None:
        raw = self.bounties.get(bounty_id, "")
        if not raw:
            raise gl.vm.UserError("Bounty not found")
        record = json.loads(raw)
        if record["status"] != STATUS_OPEN:
            raise gl.vm.UserError("Bounty is not open")
        pr_url = _validate_url(pr_url, GITHUB_PR_RE, "PR")

        issue_repo = _extract_repo(record["issue_url"])
        pr_repo = _extract_repo(pr_url)
        if issue_repo != pr_repo:
            raise gl.vm.UserError(
                "Issue and PR must live in the same repository"
            )

        # Direct-assignment gate: if the sponsor pinned an assignee at
        # create-time, only that wallet may claim. Prevents anyone else from
        # racing in on a pre-negotiated bounty.
        claimer_addr = _addr_str(gl.message.sender_address)
        assignee = record.get("assignee", "") or ""
        if assignee and claimer_addr.lower() != assignee.lower():
            raise gl.vm.UserError("Bounty is assigned to another wallet")

        record["pr_url"] = pr_url
        record["claimer"] = claimer_addr
        record["status"] = STATUS_CLAIMED
        # Stamp the claim so the escrow can be recovered after a timeout and so
        # third parties cannot prematurely adjudicate an in-progress claim.
        record["claimed_at"] = str(_now_epoch())
        self.bounties[bounty_id] = json.dumps(record, sort_keys=True)

    @gl.public.write
    def adjudicate(self, bounty_id: str) -> None:
        raw = self.bounties.get(bounty_id, "")
        if not raw:
            raise gl.vm.UserError("Bounty not found")
        record = json.loads(raw)
        if record["status"] != STATUS_CLAIMED:
            raise gl.vm.UserError("Bounty is not awaiting adjudication")

        issue_url = record["issue_url"]
        pr_url = record["pr_url"]
        claimer_str = record["claimer"]
        sponsor_str = record["sponsor"]
        amount = int(record["amount"])
        claimed_at = int(record.get("claimed_at", "0") or "0")
        owner_repo = _extract_repo(pr_url)
        pr_patch_url = pr_url.rstrip("/") + ".patch"

        # --- Authorization: no premature close by an unrelated wallet ---
        # Only the claimer or the sponsor may settle a fresh claim. Anyone may
        # settle once the claim window has elapsed (so a stale claim never
        # blocks the bounty). This closes the "any wallet can prematurely
        # close an escrowed bounty" finding without making adjudication
        # permissioned forever.
        caller = _addr_str(gl.message.sender_address).lower()
        is_party = caller == claimer_str.lower() or caller == sponsor_str.lower()
        window_open = (_now_epoch() - claimed_at) < CLAIM_TIMEOUT_SECONDS
        if not is_party and window_open:
            raise gl.vm.UserError(
                "Only the claimer or sponsor can adjudicate before the claim "
                "window elapses"
            )

        def leader_fn():
            def fetch(url):
                try:
                    return gl.nondet.web.render(url, mode="text") or ""
                except Exception:
                    return ""

            # --- Evidence source 1: issue page ---
            issue_page = fetch(issue_url)
            if not issue_page:
                raise gl.vm.UserError("Issue page not retrievable")

            # --- Evidence source 2: the FULL PR change (all commits) ---
            # The `<pr>.patch` endpoint returns git format-patch for EVERY
            # commit in the PR, concatenated. This is the full, cumulative
            # change the reviewer asked us to evaluate. Judging only the head
            # commit (as v0.3.x did) let a contributor hide the real work
            # behind an empty marker commit — the head diff would be empty and
            # adjudication inspected the wrong thing. We judge the whole thing.
            pr_patch = fetch(pr_patch_url)
            if not pr_patch:
                raise gl.vm.UserError("PR patch not retrievable")

            sha_hits = SHA_HEADER_RE.findall(pr_patch)
            if not sha_hits:
                sha_hits = SHA_LOOSE_RE.findall(pr_patch)
            if not sha_hits:
                raise gl.vm.UserError(
                    "Cannot pin PR to an immutable commit SHA"
                )
            # The last `From <sha>` header is the PR head commit. Pinning to it
            # makes every validator agree on which snapshot is being judged; a
            # force-push mid-consensus changes the SHA and consensus fails safe
            # (the sponsor can then recover via reclaim_expired_claim).
            head_sha = sha_hits[-1].lower()

            # --- Evidence source 3: SHA-pinned immutable head commit patch ---
            # github.com/<owner>/<repo>/commit/<sha>.patch is cryptographically
            # bound to `sha` — its content cannot change without changing the
            # SHA. We use it ONLY to bind the claiming wallet (below); the code
            # quality itself is judged from the full PR patch above.
            owner, repo = owner_repo
            commit_url = (
                "https://github.com/"
                + owner
                + "/"
                + repo
                + "/commit/"
                + head_sha
                + ".patch"
            )
            commit_patch = fetch(commit_url)
            if not commit_patch:
                raise gl.vm.UserError(
                    "Immutable commit patch not retrievable"
                )

            # --- Deterministic wallet-identity binding ---
            # The claiming wallet must appear verbatim inside the SHA-pinned
            # head commit patch. That content is contributor-authored (commit
            # message / author metadata, not third-party PR comments) and
            # immutable (bound to head_sha). The documented claim workflow is
            # an empty marker commit `Bounty claim by: 0x...` pushed last, so
            # it lands here as the head commit. This binds identity securely
            # while the full-PR judgement above still sees the real work.
            wallet_bound = bool(claimer_str) and (
                claimer_str.lower() in commit_patch.lower()
            )

            prompt = (
                "You are judging whether a GitHub Pull Request actually fixes "
                "the linked GitHub issue. Judge the ENTIRE cumulative change "
                "of the PR (all commits below), not any single commit. Ignore "
                "empty or marker-only commits (e.g. a commit that only carries "
                "a 'Bounty claim by: 0x...' line) — they are identity markers, "
                "not the fix. Be strict: reject trivial changes (whitespace, "
                "comment-only, unrelated file edits) even if a commit subject "
                "claims a fix. Reward substantive code that addresses the root "
                "cause described in the issue, especially when tests are "
                "added.\n\n"
                "ISSUE PAGE (text, truncated):\n"
                + issue_page[:3500]
                + "\n\nFULL PR PATCH — all commits, head pinned to SHA "
                + head_sha
                + " (truncated):\n"
                + pr_patch[:8000]
                + "\n\nReturn JSON ONLY with keys:\n"
                + '  "fixes_issue": boolean,\n'
                + '  "quality": "LOW"|"MID"|"HIGH",\n'
                + '  "reason": short string (<=500 chars).\n'
                + "Quality rubric:\n"
                + " HIGH: substantial code change addressing root cause, tests included.\n"
                + " MID:  fixes the issue but minimal or workaround-style.\n"
                + " LOW:  trivial, comment-only, or does not clearly fix.\n"
                + "If fixes_issue is false, quality must be LOW."
            )
            raw_out = gl.nondet.exec_prompt(prompt, response_format="json")
            verdict = _normalize_verdict(raw_out)
            verdict["wallet_bound"] = wallet_bound
            verdict["head_sha"] = head_sha
            return verdict

        def validator_fn(leader_res):
            if not isinstance(leader_res, gl.vm.Return):
                return False
            proposed = leader_res.calldata
            if not isinstance(proposed, dict):
                return False
            try:
                mine = leader_fn()
            except Exception:
                return False
            if bool(mine.get("fixes_issue")) != bool(proposed.get("fixes_issue")):
                return False
            if str(mine.get("quality", "")).upper() != str(proposed.get("quality", "")).upper():
                return False
            if bool(mine.get("wallet_bound")) != bool(proposed.get("wallet_bound")):
                return False
            if str(mine.get("head_sha", "")).lower() != str(proposed.get("head_sha", "")).lower():
                return False
            return True

        verdict = _run_nondet(leader_fn, validator_fn)

        wallet_bound = bool(verdict.get("wallet_bound"))
        quality = verdict["quality"]
        head_sha = str(verdict.get("head_sha", ""))

        # If the commit patch does not bind the claiming wallet, the claim
        # cannot be attributed to the caller — refund the sponsor in full and
        # reject. This neutralizes copy-PR attacks: an attacker who submits
        # someone else's PR URL cannot steal payout, and cannot lock the
        # bounty either — anyone can trigger adjudication and the sponsor is
        # refunded.
        if not wallet_bound:
            payout = 0
            refund = amount
            final_status = STATUS_REJECTED
            final_reason = (
                "Claiming wallet not found in the immutable commit patch — "
                "identity not bound to contributor-controlled PR content. "
                + verdict.get("reason", "")
            )[:MAX_REASON]
        else:
            bps = QUALITY_PAYOUT_BPS.get(quality, 0)
            payout = (amount * bps) // 10000
            refund = amount - payout
            final_status = (
                STATUS_PAID_FULL
                if bps == 10000
                else (STATUS_PAID_PARTIAL if bps > 0 else STATUS_REJECTED)
            )
            final_reason = verdict.get("reason", "")

        if payout > 0:
            gl.get_contract_at(Address(claimer_str)).emit_transfer(value=u256(payout))
        if refund > 0:
            gl.get_contract_at(Address(sponsor_str)).emit_transfer(value=u256(refund))

        record["status"] = final_status
        record["quality"] = quality if wallet_bound else "LOW"
        record["fixes_issue"] = verdict["fixes_issue"] if wallet_bound else False
        record["wallet_bound"] = wallet_bound
        record["head_sha"] = head_sha
        record["reason"] = final_reason
        record["payout"] = str(payout)
        record["refund"] = str(refund)
        self.bounties[bounty_id] = json.dumps(record, sort_keys=True)
        self.total_locked = u256(int(self.total_locked) - amount)

    @gl.public.write
    def reclaim_expired_claim(self, bounty_id: str) -> None:
        """Authorized recovery path for a stalled claim.

        Once a bounty has sat in CLAIMED for longer than CLAIM_TIMEOUT_SECONDS
        without settling (e.g. the PR or issue page became unreachable so
        adjudication keeps reverting), the sponsor — and only the sponsor —
        can recover their escrow in full. This removes the "any wallet can
        strand an escrowed bounty" failure mode: escrow can never be locked
        forever, and only the party that funded it can pull it back."""
        raw = self.bounties.get(bounty_id, "")
        if not raw:
            raise gl.vm.UserError("Bounty not found")
        record = json.loads(raw)
        if record["status"] != STATUS_CLAIMED:
            raise gl.vm.UserError("Only a claimed bounty can be reclaimed")

        sponsor_str = record["sponsor"]
        if _addr_str(gl.message.sender_address).lower() != sponsor_str.lower():
            raise gl.vm.UserError("Only the sponsor can reclaim")

        claimed_at = int(record.get("claimed_at", "0") or "0")
        if (_now_epoch() - claimed_at) < CLAIM_TIMEOUT_SECONDS:
            raise gl.vm.UserError("Claim window has not elapsed yet")

        amount = int(record["amount"])
        gl.get_contract_at(Address(sponsor_str)).emit_transfer(value=u256(amount))
        record["status"] = STATUS_EXPIRED
        record["reason"] = (
            "Claim expired without settling — escrow recovered by sponsor "
            "after the claim window."
        )
        record["refund"] = str(amount)
        self.bounties[bounty_id] = json.dumps(record, sort_keys=True)
        self.total_locked = u256(int(self.total_locked) - amount)

    @gl.public.write
    def cancel_open_bounty(self, bounty_id: str) -> None:
        raw = self.bounties.get(bounty_id, "")
        if not raw:
            raise gl.vm.UserError("Bounty not found")
        record = json.loads(raw)
        if record["status"] != STATUS_OPEN:
            raise gl.vm.UserError("Only open bounties can be cancelled")
        sponsor_str = record["sponsor"]
        if _addr_str(gl.message.sender_address) != sponsor_str:
            raise gl.vm.UserError("Only sponsor can cancel")
        amount = int(record["amount"])
        gl.get_contract_at(Address(sponsor_str)).emit_transfer(value=u256(amount))
        record["status"] = STATUS_REJECTED
        record["refund"] = str(amount)
        self.bounties[bounty_id] = json.dumps(record, sort_keys=True)
        self.total_locked = u256(int(self.total_locked) - amount)
