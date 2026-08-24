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
from gltest.helpers import load_fixtures

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


ISSUE_URL = "https://github.com/octocat/hello-world/issues/1"
PR_URL = "https://github.com/octocat/hello-world/pull/2"
BOUNTY_AMOUNT = 1_000_000_000_000_000_000  # 1 GEN


def test_high_quality_pr_full_payout(sponsor, contributor):
    contract = _deploy()
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "HIGH",
            "reason": "Addresses root cause, tests added.",
        },
        web_pages={
            ".*issues.*": "Bug: null pointer in login flow when email empty.",
            ".*pull.*": "PR: Guard against empty email + regression test.",
            ".*\\.diff": "diff --git a/login.py b/login.py\n@@ +if not email: return 400\n",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "PAID_FULL"
    assert record["quality"] == "HIGH"
    assert int(record["payout"]) == BOUNTY_AMOUNT
    assert int(record["refund"]) == 0


def test_mid_quality_partial_payout(sponsor, contributor):
    contract = _deploy()
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": True,
            "quality": "MID",
            "reason": "Minimal workaround, no tests.",
        },
        web_pages={
            ".*issues.*": "Bug: crash on empty input",
            ".*pull.*": "PR: quick nil check",
            ".*\\.diff": "diff --git a/x.py\n+if not x: return\n",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "PAID_PARTIAL"
    assert record["quality"] == "MID"
    assert int(record["payout"]) == BOUNTY_AMOUNT * 6000 // 10000
    assert int(record["refund"]) == BOUNTY_AMOUNT - (BOUNTY_AMOUNT * 6000 // 10000)


def test_low_quality_full_refund(sponsor, contributor):
    contract = _deploy()
    _install_mocks(
        contract.client,
        llm_response={
            "fixes_issue": False,
            "quality": "LOW",
            "reason": "PR only edits README.",
        },
        web_pages={
            ".*issues.*": "Bug: SQL injection in login",
            ".*pull.*": "PR: fix typo in README",
            ".*\\.diff": "diff --git a/README.md\n-old\n+new\n",
        },
    )

    contract.connect(sponsor).create_bounty(args=[ISSUE_URL]).transact(value=BOUNTY_AMOUNT)
    contract.connect(contributor).submit_claim(args=["1", PR_URL]).transact()
    contract.connect(contributor).adjudicate(args=["1"]).transact()

    record = json.loads(contract.get_bounty(args=["1"]).call())
    assert record["status"] == "REJECTED"
    assert record["quality"] == "LOW"
    assert int(record["payout"]) == 0
    assert int(record["refund"]) == BOUNTY_AMOUNT


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
