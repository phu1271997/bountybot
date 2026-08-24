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

QUALITY_PAYOUT_BPS = {
    "HIGH": 10000,
    "MID": 6000,
    "LOW": 0,
}

MAX_URL = 300
MAX_REASON = 700
GITHUB_ISSUE_RE = r"^https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/issues/\d+/?$"
GITHUB_PR_RE = r"^https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/pull/\d+/?$"


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
    def create_bounty(self, issue_url: str) -> None:
        amount = int(gl.message.value)
        if amount <= 0:
            raise gl.vm.UserError("Bounty amount must be positive")
        issue_url = _validate_url(issue_url, GITHUB_ISSUE_RE, "issue")

        new_id = int(self.bounty_count) + 1
        bounty_id = str(new_id)
        record = {
            "id": bounty_id,
            "sponsor": _addr_str(gl.message.sender_address),
            "issue_url": issue_url,
            "amount": str(amount),
            "pr_url": "",
            "claimer": "",
            "status": STATUS_OPEN,
            "quality": "",
            "reason": "",
            "fixes_issue": None,
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
        record["pr_url"] = pr_url
        record["claimer"] = _addr_str(gl.message.sender_address)
        record["status"] = STATUS_CLAIMED
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
        diff_url = pr_url.rstrip("/") + ".diff"
        patch_url = pr_url.rstrip("/") + ".patch"

        def leader_fn():
            def fetch(url, mode):
                try:
                    return gl.nondet.web.render(url, mode=mode) or ""
                except Exception:
                    return ""

            issue_page = fetch(issue_url, "text")
            pr_page = fetch(pr_url, "text")
            diff_page = fetch(diff_url, "text")
            if not diff_page:
                diff_page = fetch(patch_url, "text")

            if not issue_page and not pr_page and not diff_page:
                raise gl.vm.UserError("All GitHub sources unreachable")

            prompt = (
                "You are judging whether a GitHub Pull Request actually fixes the "
                "linked GitHub issue. Be strict. Reject trivial changes (whitespace, "
                "comment-only, unrelated file edits) even if the PR title claims a "
                "fix. Reward substantive code changes that address the root cause "
                "described in the issue, especially when tests are added.\n\n"
                "ISSUE PAGE (text, truncated):\n"
                + issue_page[:3500]
                + "\n\nPR PAGE (text, truncated):\n"
                + pr_page[:3500]
                + "\n\nPR DIFF (truncated):\n"
                + diff_page[:6000]
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
            return _normalize_verdict(raw_out)

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
            return True

        run_nondet = getattr(gl.vm, "run_nondet", gl.vm.run_nondet_unsafe)
        verdict = run_nondet(leader_fn, validator_fn)

        quality = verdict["quality"]
        bps = QUALITY_PAYOUT_BPS.get(quality, 0)
        payout = (amount * bps) // 10000
        refund = amount - payout

        if payout > 0:
            gl.get_contract_at(Address(claimer_str)).emit_transfer(value=u256(payout))
        if refund > 0:
            gl.get_contract_at(Address(sponsor_str)).emit_transfer(value=u256(refund))

        record["status"] = (
            STATUS_PAID_FULL
            if bps == 10000
            else (STATUS_PAID_PARTIAL if bps > 0 else STATUS_REJECTED)
        )
        record["quality"] = quality
        record["fixes_issue"] = verdict["fixes_issue"]
        record["reason"] = verdict["reason"]
        record["payout"] = str(payout)
        record["refund"] = str(refund)
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
