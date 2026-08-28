"""BountyBot integration tests.

Run against a local GenLayer node:

    gltest tests/test_bounty_bot.py --network localnet

Or against studionet (slower, real inference):

    gltest tests/test_bounty_bot.py --network studionet

The tests install LLM + web mocks so the non-deterministic block resolves
deterministically. See rule R17 in ~GEN_RULES/02-common-errors.md.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from gltest import get_contract_factory

CONTRACT = Path(__file__).resolve().parent.parent / "contracts" / "bounty_bot.py"


def clear_known_contracts():
    for name, module in list(sys.modules.items()):
        if "genlayer" in name and hasattr(module, "__known_contract__"):
            setattr(module, "__known_contract__", None)


def _install_mocks(client, llm_response: dict, web_pages: dict[str, str]):
    llm_mocks = {".*": json.dumps(llm_response)}
    web_mocks = {}
    for pattern, body in web_pages.items():
        web_mocks[pattern] = {"status": 200, "body": body}
    client.provider.make_request(
        method="sim_installMocks",
        params={"llm_mocks": llm_mocks, "web_mocks": web_mocks},
    )


def _deploy():
    clear_known_contracts()
    factory = get_contract_factory(str(CONTRACT))
    contract = factory.deploy()
    return contract


def _addr_str(account) -> str:
    """Best-effort address string for a gltest account."""
    for attr in ("address", "as_hex"):
        val = getattr(account, attr, None)
        if val:
            return str(val)
    return str(account)


ISSUE_URL = "https://github.com/octocat/hello-world/issues/1"
PR_URL = "https://github.com/octocat/hello-world/pull/2"
CROSS_REPO_PR_URL = "https://github.com/other/repo/pull/9"
BOUNTY_AMOUNT = 1_000_000_000_000_000_000  # 1 GEN
HEAD_SHA = "abc123def4567890abc123def4567890abc12345"


def _pr_patch(head_sha: str, subject: str = "Fix the bug") -> str:
    """Simulate the `github.com/<owner>/<repo>/pull/<N>.patch` body — a git
    format-patch. Only the `From <sha>` header line matters for SHA
    extraction; the rest is filler so the contract can detect it as
    non-empty."""
    return (
        "From "
        + head_sha
        + " Mon Sep 17 00:00:00 2001\n"
        + "From: Contributor <dev@example.com>\n"
        + "Subject: [PATCH] "
        + subject
        + "\n\n"
        + "diff --git a/x.py b/x.py\n"
        + "+ pass\n"
    )


def _commit_patch(head_sha: str, wallet: str | None, subject: str = "Fix the bug", diff: str = "+ pass") -> str:
    """Simulate the immutable `commit/<sha>.patch` body. If `wallet` is
    provided, it lands in the commit message body — that's contributor-
    controlled and SHA-pinned content."""
    wallet_line = ("\nBounty claim by: " + wallet + "\n") if wallet else ""
    return (
        "From "
        + head_sha
        + " Mon Sep 17 00:00:00 2001\n"
        + "From: Contributor <dev@example.com>\n"
        + "Subject: [PATCH] "
        + subject
        + "\n"
        + wallet_line
        + "\ndiff --git a/x.py b/x.py\n"
        + diff
        + "\n"
    )


# ---------------------------------------------------------------------------
# Happy paths — wallet appears in the SHA-pinned commit patch
# ---------------------------------------------------------------------------


def test_high_quality_pr_full_payout(sponsor, contributor):
    contract = _deploy()
    claimer = _addr_str(contributor)
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "HIGH",
            "reason": "Addresses root cause, tests added.",
        },
        web_pages={
            r".*/issues/.*": "Bug: null pointer in login flow when email empty.",
            r".*/pull/.*": _pr_patch(HEAD_SHA, subject="Guard against empty email"),
            r".*/commit/.*": _commit_patch(
                HEAD_SHA,
                wallet=claimer,
                subject="Guard against empty email + regression test",
                diff="+ if not email: return 400\n+ # tests added",
            ),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "PAID_FULL"
    assert record["quality"] == "HIGH"
    assert record["wallet_bound"] is True
    assert record["head_sha"].lower() == HEAD_SHA.lower()
    assert int(record["payout"]) == BOUNTY_AMOUNT
    assert int(record["refund"]) == 0


def test_mid_quality_partial_payout(sponsor, contributor):
    contract = _deploy()
    claimer = _addr_str(contributor)
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "MID",
            "reason": "Minimal workaround, no tests.",
        },
        web_pages={
            r".*/issues/.*": "Bug: crash on empty input",
            r".*/pull/.*": _pr_patch(HEAD_SHA, subject="quick nil check"),
            r".*/commit/.*": _commit_patch(
                HEAD_SHA, wallet=claimer, subject="quick nil check"
            ),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "PAID_PARTIAL"
    assert record["quality"] == "MID"
    assert record["wallet_bound"] is True
    assert int(record["payout"]) == BOUNTY_AMOUNT * 6000 // 10000
    assert int(record["refund"]) == BOUNTY_AMOUNT - (BOUNTY_AMOUNT * 6000 // 10000)


def test_low_quality_full_refund(sponsor, contributor):
    contract = _deploy()
    claimer = _addr_str(contributor)
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": False,
            "quality": "LOW",
            "reason": "PR only edits README.",
        },
        web_pages={
            r".*/issues/.*": "Bug: SQL injection in login",
            r".*/pull/.*": _pr_patch(HEAD_SHA, subject="fix typo in README"),
            r".*/commit/.*": _commit_patch(
                HEAD_SHA, wallet=claimer, subject="fix typo in README"
            ),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "REJECTED"
    assert record["quality"] == "LOW"
    assert record["wallet_bound"] is True
    assert int(record["payout"]) == 0
    assert int(record["refund"]) == BOUNTY_AMOUNT


# ---------------------------------------------------------------------------
# Existing guards
# ---------------------------------------------------------------------------


def test_double_claim_rejected(sponsor, contributor):
    contract = _deploy()
    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    with pytest.raises(Exception, match="not open"):
        contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()


def test_zero_value_bounty_rejected(sponsor):
    contract = _deploy()
    with pytest.raises(Exception, match="positive"):
        contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=0)


def test_invalid_url_rejected(sponsor):
    contract = _deploy()
    with pytest.raises(Exception, match="format"):
        contract.connect(sponsor).create_bounty(
            args=["https://gitlab.com/foo/bar/issues/1"]
        ).transact(value=BOUNTY_AMOUNT)


def test_cancel_open_bounty_refunds_sponsor(sponsor):
    contract = _deploy()
    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(sponsor).cancel_open_bounty(args=["1"]).transact()
    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "REJECTED"
    assert int(record["refund"]) == BOUNTY_AMOUNT


# ---------------------------------------------------------------------------
# Judge feedback — same-repo requirement
# ---------------------------------------------------------------------------


def test_cross_repo_claim_rejected(sponsor, contributor):
    """PR URL from a repository other than the bounty's issue must be rejected
    at submit_claim, before any adjudication side effects can run."""
    contract = _deploy()
    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    with pytest.raises(Exception, match="same repository"):
        contract.connect(contributor).submit_claim(
            args=["1", CROSS_REPO_PR_URL]
        ).transact()
    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "OPEN"


# ---------------------------------------------------------------------------
# Judge feedback — wallet binding must come from contributor-controlled,
# SHA-pinned content, not from the rendered PR page.
# ---------------------------------------------------------------------------


def test_copied_pr_cannot_steal_bounty(sponsor, contributor):
    """Attacker copies a legit contributor's PR URL and submits a claim from
    their own wallet. The SHA-pinned commit patch does NOT contain the
    attacker's address (the commit was authored by the real contributor with
    their own wallet in the commit message), so adjudication must refund the
    sponsor 100% and yield zero payout — even if the LLM would rate the PR
    HIGH quality."""
    contract = _deploy()
    other_wallet = "0xDEADBEEFCAFE1234567890ABCDEFDEADBEEF1111"
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "HIGH",
            "reason": "Great fix, well tested.",
        },
        web_pages={
            r".*/issues/.*": "Bug: SQL injection in login",
            r".*/pull/.*": _pr_patch(HEAD_SHA, subject="Parameterize SQL queries"),
            # Immutable commit patch is authored by the real contributor.
            # The attacker's wallet is nowhere inside it.
            r".*/commit/.*": _commit_patch(
                HEAD_SHA,
                wallet=other_wallet,
                subject="Parameterize SQL queries in login handler",
                diff="+ cursor.execute(sql, params)",
            ),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "REJECTED"
    assert record["wallet_bound"] is False
    assert int(record["payout"]) == 0
    assert int(record["refund"]) == BOUNTY_AMOUNT


def test_copied_pr_cannot_lock_bounty(sponsor, contributor):
    """Same attack: the bounty must also NOT be permanently locked. After
    adjudication rejects the copied PR, total_locked must reflect the refund."""
    contract = _deploy()
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "MID",
            "reason": "Reasonable fix.",
        },
        web_pages={
            r".*/issues/.*": "Bug",
            r".*/pull/.*": _pr_patch(HEAD_SHA),
            # Immutable commit patch has no wallet reference at all.
            r".*/commit/.*": _commit_patch(HEAD_SHA, wallet=None, subject="Fix bug"),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "REJECTED"
    assert record["wallet_bound"] is False
    assert int(record["refund"]) == BOUNTY_AMOUNT
    assert int(contract.get_total_locked().call()) == 0


def test_wallet_only_in_pr_page_is_ignored(sponsor, contributor):
    """v0.3.0 previous review finding: the wallet appearing anywhere in the
    rendered PR page (e.g., in a comment planted by an attacker) is NOT
    sufficient. Only the SHA-pinned commit patch counts.

    Simulate that: the PR-level format-patch body contains the claimer's
    wallet (as would appear on the rendered PR page — a PR description or a
    third-party comment), but the immutable per-commit patch does not. The
    contract must reject regardless."""
    contract = _deploy()
    claimer = _addr_str(contributor)
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "HIGH",
            "reason": "Well done.",
        },
        web_pages={
            r".*/issues/.*": "Bug",
            # Mutable PR-level content mentions the claimer wallet, mimicking
            # a comment or PR-body reference. The contract must NOT trust
            # this for wallet binding.
            r".*/pull/.*": (
                _pr_patch(HEAD_SHA)
                + "\n\n[COMMENT] claimant says: bounty for "
                + claimer
                + "\n"
            ),
            # Immutable commit patch does NOT contain the claimer wallet.
            r".*/commit/.*": _commit_patch(HEAD_SHA, wallet=None),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "REJECTED"
    assert record["wallet_bound"] is False
    assert int(record["payout"]) == 0
    assert int(record["refund"]) == BOUNTY_AMOUNT


# ---------------------------------------------------------------------------
# Judge feedback — incomplete or mismatched evidence must not settle.
# ---------------------------------------------------------------------------


def test_adjudication_reverts_when_immutable_diff_missing(sponsor, contributor):
    """The SHA-pinned commit patch is the immutable diff. If it cannot be
    retrieved, adjudicate must revert (not silently settle on partial
    evidence). The bounty stays CLAIMED so it can be retried."""
    contract = _deploy()
    claimer = _addr_str(contributor)
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "HIGH",
            "reason": "unused — should never reach the LLM",
        },
        web_pages={
            r".*/issues/.*": "Bug: something",
            r".*/pull/.*": _pr_patch(HEAD_SHA),
            # Empty body simulates commit .patch URL 404 / unreachable.
            r".*/commit/.*": "",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    with pytest.raises(Exception, match="[Ii]mmutable"):
        contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "CLAIMED"
    assert int(record["payout"]) == 0
    assert int(record["refund"]) == 0


def test_adjudication_reverts_when_issue_missing(sponsor, contributor):
    contract = _deploy()
    claimer = _addr_str(contributor)
    _install_mocks(
        contract.client,
        llm_response={"fixes_issue": True, "quality": "HIGH", "reason": "n/a"},
        web_pages={
            r".*/issues/.*": "",
            r".*/pull/.*": _pr_patch(HEAD_SHA),
            r".*/commit/.*": _commit_patch(HEAD_SHA, wallet=claimer),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    with pytest.raises(Exception, match="Issue"):
        contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "CLAIMED"


def test_adjudication_reverts_when_pr_patch_missing(sponsor, contributor):
    contract = _deploy()
    claimer = _addr_str(contributor)
    _install_mocks(
        contract.client,
        llm_response={"fixes_issue": True, "quality": "HIGH", "reason": "n/a"},
        web_pages={
            r".*/issues/.*": "Bug",
            r".*/pull/.*": "",
            r".*/commit/.*": _commit_patch(HEAD_SHA, wallet=claimer),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    with pytest.raises(Exception, match="PR patch"):
        contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "CLAIMED"


def test_adjudication_reverts_when_no_sha_in_pr_patch(sponsor, contributor):
    """If the PR patch doesn't contain a parseable commit SHA, there is no
    immutable pin — adjudication must revert."""
    contract = _deploy()
    claimer = _addr_str(contributor)
    _install_mocks(
        contract.client,
        llm_response={"fixes_issue": True, "quality": "HIGH", "reason": "n/a"},
        web_pages={
            r".*/issues/.*": "Bug",
            # PR patch body without any 40-char hex SHA.
            r".*/pull/.*": "This is not a valid git format-patch payload.",
            r".*/commit/.*": _commit_patch(HEAD_SHA, wallet=claimer),
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    with pytest.raises(Exception, match="[Ss]ha|SHA|pin"):
        contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "CLAIMED"
