package com.example.order;

/**
 * Order orchestration boundary of the ecommerce-marketplace example.
 */
public class OrderService {

    /** Result of the reservation call, provided by an inventory client. */
    public interface InventoryClient {
        boolean reserve(String sku, int quantity);
        void release(String sku, int quantity);
    }

    /** Result of the risk scoring call, provided by a risk client. */
    public interface RiskClient {
        String evaluate(double orderAmount, int priorOrders);
    }

    private final InventoryClient inventoryClient;
    private final RiskClient riskClient;

    public OrderService(InventoryClient inventoryClient, RiskClient riskClient) {
        this.inventoryClient = inventoryClient;
        this.riskClient = riskClient;
    }

    public record OrderRequest(String sku, int quantity, double amount, int priorOrders) {}

    public enum Decision { ACCEPTED, REJECTED }

    public record OrderResult(Decision decision, String reason) {}

    /*
     * @id CODE-MARKETPLACE-003
     * @implements REQ-MARKETPLACE-003
     * @design DES-MARKETPLACE-003
     */
    public OrderResult createOrder(OrderRequest request) {
        boolean reserved = inventoryClient.reserve(request.sku(), request.quantity());
        if (!reserved) {
            return new OrderResult(Decision.REJECTED, "insufficient-stock");
        }
        String risk = riskClient.evaluate(request.amount(), request.priorOrders());
        if ("reject".equals(risk)) {
            inventoryClient.release(request.sku(), request.quantity());
            return new OrderResult(Decision.REJECTED, "risk-reject");
        }
        return new OrderResult(Decision.ACCEPTED, risk);
    }
}
