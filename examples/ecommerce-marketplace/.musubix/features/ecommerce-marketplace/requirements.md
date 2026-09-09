---
schemaVersion: 1
feature: ecommerce-marketplace
---
# Requirements / 要求

## REQ-MARKETPLACE-001: Reserve inventory on order creation
Priority: must
Type: functional
Pattern: event-driven
Statement: When a reservation request is submitted for a SKU, the inventory service shall reserve the requested quantity only if stock is sufficient.
Acceptance: A test creates an order for a SKU with enough stock and asserts the
reservation succeeds and remaining stock decreases by the requested quantity; a
second test requests more than available stock and asserts the reservation is
rejected with no stock mutation.

## REQ-MARKETPLACE-002: Score order risk before acceptance
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The risk service shall classify every submitted order as `approve`,
`review`, or `reject` from its amount and the customer's prior order count.
Acceptance: Tests assert a low-amount order from a returning customer is
`approve`, a high-amount order from a first-time customer is `reject`, and a
mid-range case is `review`.

## REQ-MARKETPLACE-003: Orchestrate order creation across services
Priority: must
Type: functional
Pattern: event-driven
Statement: When the order service receives a create-order request, the order service shall call inventory reservation and risk scoring before accepting the order.
Acceptance: A test with a stubbed reserved inventory and `approve` risk asserts
the order is accepted; a test with a `reject` risk result asserts the order is
rejected and inventory reservation is rolled back.

## REQ-MARKETPLACE-004: Recommend related products
Priority: should
Type: functional
Pattern: ubiquitous
Statement: The recommendation service shall return up to 3 related SKUs for a
given SKU from a static co-purchase table, excluding the queried SKU itself.
Acceptance: A test queries a known SKU and asserts the response excludes the
queried SKU and contains only SKUs listed as related in the co-purchase table.

## REQ-MARKETPLACE-005: Aggregate order submission for the client
Priority: must
Type: functional
Pattern: event-driven
Statement: When the BFF receives a client order submission, the BFF shall forward the decision and status code returned by the order service to the caller.
Acceptance: A test with a mocked order-service client returning "accepted"
asserts the BFF response contains that decision; a test with a mocked
"rejected" response asserts the BFF forwards that decision without altering it.

## REQ-MARKETPLACE-006: Display order result to the shopper
Priority: should
Type: functional
Pattern: ubiquitous
Statement: The storefront shall render the order decision text returned by the
BFF response without modification.
Acceptance: A test renders the summary function with an "accepted" decision and
asserts the exact decision text appears in the rendered output.
