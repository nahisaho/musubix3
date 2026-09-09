//! Risk scoring boundary of the ecommerce-marketplace example.

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum RiskDecision {
    Approve,
    Review,
    Reject,
}

impl RiskDecision {
    pub fn as_str(&self) -> &'static str {
        match self {
            RiskDecision::Approve => "approve",
            RiskDecision::Review => "review",
            RiskDecision::Reject => "reject",
        }
    }
}

/* @id CODE-MARKETPLACE-002
 * @implements REQ-MARKETPLACE-002
 * @design DES-MARKETPLACE-002
 */
/// Classifies an order's risk from its amount and the customer's prior order
/// count using fixed thresholds.
pub fn evaluate_risk(order_amount: f64, prior_orders: u32) -> RiskDecision {
    if order_amount >= 5000.0 && prior_orders == 0 {
        return RiskDecision::Reject;
    }
    if order_amount < 500.0 && prior_orders > 0 {
        return RiskDecision::Approve;
    }
    RiskDecision::Review
}
