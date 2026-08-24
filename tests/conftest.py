"""Shared fixtures for BountyBot tests."""

import pytest
from gltest import create_account


@pytest.fixture
def sponsor():
    return create_account()


@pytest.fixture
def contributor():
    return create_account()
