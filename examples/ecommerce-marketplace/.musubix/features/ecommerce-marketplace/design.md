---
schemaVersion: 1
feature: ecommerce-marketplace
---
# Design / 設計

## DES-MARKETPLACE-001: Inventory reservation service
Responsibilities: Track per-SKU stock and reserve quantity atomically, rejecting
reservations that would drive stock negative.
Interfaces: `ReserveStock(sku string, qty int) (Reservation, error)`; HTTP
`POST /reservations`.
Constraints: Reservation must never leave stock negative; language is Go.
Requirements: REQ-MARKETPLACE-001
ADRs: ADR-0001

## DES-MARKETPLACE-002: Risk scoring service
Responsibilities: Classify an order's risk from its amount and the customer's
prior order count using fixed thresholds.
Interfaces: `evaluate_risk(order_amount: f64, prior_orders: u32) -> RiskDecision`;
HTTP `POST /risk-scores`.
Constraints: Must return exactly one of approve/review/reject; language is Rust.
Requirements: REQ-MARKETPLACE-002
ADRs: ADR-0001

## DES-MARKETPLACE-003: Order orchestration service
Responsibilities: Receive create-order requests, call inventory reservation and
risk scoring, and accept or reject the order from their combined result.
Interfaces: `OrderService.createOrder(OrderRequest)`; HTTP `POST /orders`.
Constraints: Must roll back a reservation when risk is `reject`; language is
Java.
Requirements: REQ-MARKETPLACE-003
ADRs: ADR-0001
Depends-On: DES-MARKETPLACE-001, DES-MARKETPLACE-002

## DES-MARKETPLACE-004: Recommendation service
Responsibilities: Return related SKUs for a queried SKU from a static
co-purchase table.
Interfaces: `get_related(sku: str) -> list[str]`; HTTP `GET /recommendations/{sku}`.
Constraints: Response excludes the queried SKU; language is Python.
Requirements: REQ-MARKETPLACE-004
ADRs: ADR-0001

## DES-MARKETPLACE-005: Backend for frontend (BFF)
Responsibilities: Accept the client's order submission and forward it to the
order orchestration service unchanged.
Interfaces: `submitOrder(request): OrderResult`; HTTP `POST /api/orders`.
Constraints: Must not alter the order service's decision or status code;
language is TypeScript (Node.js).
Requirements: REQ-MARKETPLACE-005
ADRs: ADR-0001
Depends-On: DES-MARKETPLACE-003

## DES-MARKETPLACE-006: Storefront summary rendering
Responsibilities: Render the BFF's order decision text to the shopper without
modification.
Interfaces: `renderOrderSummary(decision: OrderDecision): string`.
Constraints: Language is TypeScript (Next.js); no server round-trip inside the
rendering function itself.
Requirements: REQ-MARKETPLACE-006
ADRs: ADR-0001
Depends-On: DES-MARKETPLACE-005
