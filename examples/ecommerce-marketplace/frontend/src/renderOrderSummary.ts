/**
 * Storefront rendering boundary of the ecommerce-marketplace example.
 */

export type OrderDecision = { decision: string };

/** @id CODE-MARKETPLACE-006
 * @implements REQ-MARKETPLACE-006
 * @design DES-MARKETPLACE-006
 */
export function renderOrderSummary(decision: OrderDecision): string {
  return `Order result: ${decision.decision}`;
}
