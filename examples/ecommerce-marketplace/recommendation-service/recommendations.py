"""Recommendation boundary of the ecommerce-marketplace example."""

CO_PURCHASE_TABLE: dict[str, list[str]] = {
    "SKU-1": ["SKU-2", "SKU-3"],
    "SKU-2": ["SKU-1"],
    "SKU-3": ["SKU-1", "SKU-4"],
    "SKU-4": [],
}


# @id CODE-MARKETPLACE-004
# @implements REQ-MARKETPLACE-004
# @design DES-MARKETPLACE-004
def get_related(sku: str) -> list[str]:
    """Return up to 3 related SKUs for sku, excluding sku itself."""
    related = [item for item in CO_PURCHASE_TABLE.get(sku, []) if item != sku]
    return related[:3]
