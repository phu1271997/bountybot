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


def _bound_pr_page(claimer_addr: str, body: str) -> str:
    """PR page that binds the claimer wallet in the description."""
    return (
        body
        + "\n\nBounty claim by: "
        + claimer_addr
        + "\nThis PR is submitted for on-chain bounty settlement.\n"
    )


# ---------------------------------------------------------------------------
# Happy paths — with wallet binding
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
            ".*issues.*": "Bug: null pointer in login flow when email empty.",
            ".*pull.*": _bound_pr_page(
                claimer, "PR: Guard against empty email + regression test."
            ),
            ".*\\.diff": "diff --git a/login.py b/login.py\n@@ +if not email: return 400\n",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "PAID_FULL"
    assert record["quality"] == "HIGH"
    assert record["wallet_bound"] is True
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
            ".*issues.*": "Bug: crash on empty input",
            ".*pull.*": _bound_pr_page(claimer, "PR: quick nil check"),
            ".*\\.diff": "diff --git a/x.py\n+if not x: return\n",
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
            ".*issues.*": "Bug: SQL injection in login",
            ".*pull.*": _bound_pr_page(claimer, "PR: fix typo in README"),
            ".*\\.diff": "diff --git a/README.md\n-old\n+new\n",
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
# Judge feedback: security guards
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
    # Bounty must remain OPEN — a rejected claim cannot lock it.
    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "OPEN"


def test_copied_pr_cannot_steal_bounty(sponsor, contributor):
    """Attacker copies someone else's PR URL and files a claim with their own
    wallet. The PR body does NOT contain the attacker's address, so adjudication
    must refund the sponsor 100% and yield zero payout."""
    contract = _deploy()
    _install_mocks(
        contract.client,
        llm_response={
            # Even if the LLM would rate the PR HIGH quality, the wallet-binding
            # guard must veto payout because the identity is not bound.
            "fixes_issue": True,
            "quality": "HIGH",
            "reason": "Great fix, well tested.",
        },
        web_pages={
            ".*issues.*": "Bug: SQL injection in login",
            # PR page belongs to a legitimate contributor — no attacker address.
            ".*pull.*": (
                "PR: Parameterize SQL queries in login handler.\n"
                "Bounty claim by: 0xDEADBEEFCAFE1234567890ABCDEFDEADBEEF1111\n"
                "Adds regression tests."
            ),
            ".*\\.diff": "diff --git a/auth.py\n+cursor.execute(sql, params)\n",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    # The attacker (contributor fixture) copies the URL — their address is NOT
    # inside the PR body above.
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "REJECTED"
    assert record["wallet_bound"] is False
    assert int(record["payout"]) == 0
    assert int(record["refund"]) == BOUNTY_AMOUNT


def test_copied_pr_cannot_lock_bounty(sponsor, contributor):
    """Same attack as above — the bounty must also NOT be permanently locked.
    After adjudication rejects the copied PR, the sponsor must have their GEN
    back and total_locked must reflect that."""
    contract = _deploy()
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "MID",
            "reason": "Reasonable fix.",
        },
        web_pages={
            ".*issues.*": "Bug",
            ".*pull.*": "Legitimate PR body, no attacker wallet.",
            ".*\\.diff": "diff --git a/x.py\n+fix\n",
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


def test_adjudication_reverts_when_diff_missing(sponsor, contributor):
    """The immutable .diff is one of three required evidence pieces. If it
    cannot be retrieved, adjudicate must revert (not silently settle on partial
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
            ".*issues.*": "Bug: something",
            ".*pull.*": _bound_pr_page(claimer, "PR body"),
            # Empty body simulates diff.github URL 404 / unreachable.
            ".*\\.diff": "",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    with pytest.raises(Exception, match="diff"):
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
            ".*issues.*": "",
            ".*pull.*": _bound_pr_page(claimer, "PR body"),
            ".*\\.diff": "diff content",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    with pytest.raises(Exception, match="Issue"):
        contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "CLAIMED"


def test_adjudication_reverts_when_pr_page_missing(sponsor, contributor):
    contract = _deploy()
    _install_mocks(
        contract.client,
        llm_response={"fixes_issue": True, "quality": "HIGH", "reason": "n/a"},
        web_pages={
            ".*issues.*": "Bug",
            ".*pull.*": "",
            ".*\\.diff": "diff content",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    with pytest.raises(Exception, match="PR"):
        contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "CLAIMED"
