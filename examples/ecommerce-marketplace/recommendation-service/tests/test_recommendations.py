"""Tests for the recommendation boundary."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from recommendations import get_related


# @id TEST-MARKETPLACE-004
# @verifies REQ-MARKETPLACE-004
def test_marketplace_004_returns_related_skus_excluding_query():
    related = get_related("SKU-1")
    assert "SKU-1" not in related
    assert related == ["SKU-2", "SKU-3"]
