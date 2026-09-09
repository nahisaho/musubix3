#[cfg(test)]
mod tests {
    use risk_service::{evaluate_risk, RiskDecision};

    /* @id TEST-MARKETPLACE-002
     * @verifies REQ-MARKETPLACE-002
     */
    #[test]
    fn test_marketplace_002_classifies_risk_by_amount_and_history() {
        assert_eq!(evaluate_risk(300.0, 5), RiskDecision::Approve);
        assert_eq!(evaluate_risk(6000.0, 0), RiskDecision::Reject);
        assert_eq!(evaluate_risk(1200.0, 2), RiskDecision::Review);
    }
}
