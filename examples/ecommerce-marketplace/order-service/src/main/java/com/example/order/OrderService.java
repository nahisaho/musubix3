package com.example.order;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

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
    private final Map<String, AcceptedOrder> acceptedOrders = new HashMap<>();

    public OrderService(InventoryClient inventoryClient, RiskClient riskClient) {
        this.inventoryClient = inventoryClient;
        this.riskClient = riskClient;
    }

    public record OrderRequest(String sku, int quantity, double amount, int priorOrders) {}

    public enum Decision { ACCEPTED, REJECTED }

    public record OrderResult(Decision decision, String reason, String orderId) {}

    public enum CancelDecision { CANCELLED, REJECTED }

    public record CancelResult(CancelDecision decision, String reason) {}

    private record AcceptedOrder(String sku, int quantity, boolean cancelled) {}

    /*
     * @id CODE-MARKETPLACE-003
     * @implements REQ-MARKETPLACE-003
     * @design DES-MARKETPLACE-003
     */
    public OrderResult createOrder(OrderRequest request) {
        boolean reserved = inventoryClient.reserve(request.sku(), request.quantity());
        if (!reserved) {
            return new OrderResult(Decision.REJECTED, "insufficient-stock", null);
        }
        String risk = riskClient.evaluate(request.amount(), request.priorOrders());
        if ("reject".equals(risk)) {
            inventoryClient.release(request.sku(), request.quantity());
            return new OrderResult(Decision.REJECTED, "risk-reject", null);
        }
        String orderId = UUID.randomUUID().toString();
        acceptedOrders.put(orderId, new AcceptedOrder(request.sku(), request.quantity(), false));
        return new OrderResult(Decision.ACCEPTED, risk, orderId);
    }

    /*
     * @id CODE-MARKETPLACE-007
     * @implements REQ-MARKETPLACE-007
     * @design DES-MARKETPLACE-007
     */
    public CancelResult cancelOrder(String orderId) {
        AcceptedOrder order = acceptedOrders.get(orderId);
        if (order == null || order.cancelled()) {
            return new CancelResult(CancelDecision.REJECTED, "not-accepted");
        }
        inventoryClient.release(order.sku(), order.quantity());
        acceptedOrders.put(orderId, new AcceptedOrder(order.sku(), order.quantity(), true));
        return new CancelResult(CancelDecision.CANCELLED, "cancelled");
    }
}
