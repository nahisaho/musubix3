package com.example.order;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/*
 * @id TEST-MARKETPLACE-007
 * @verifies REQ-MARKETPLACE-007
 */
class OrderCancellationTest {

    @Test
    @Tag("TEST-MARKETPLACE-007")
    void cancelsAcceptedOrderAndReleasesReservation() {
        var releaseCalls = new int[]{0};
        OrderService.InventoryClient inventory = new OrderService.InventoryClient() {
            public boolean reserve(String sku, int quantity) { return true; }
            public void release(String sku, int quantity) { releaseCalls[0]++; }
        };
        OrderService.RiskClient risk = (amount, priorOrders) -> "approve";
        var service = new OrderService(inventory, risk);

        var created = service.createOrder(new OrderService.OrderRequest("SKU-1", 2, 100.0, 3));
        var cancelled = service.cancelOrder(created.orderId());

        assertEquals(OrderService.CancelDecision.CANCELLED, cancelled.decision());
        assertEquals(1, releaseCalls[0], "inventory release must be called exactly once");
    }

    @Test
    @Tag("TEST-MARKETPLACE-007")
    void rejectsCancellationForAnOrderThatWasNeverAccepted() {
        var releaseCalls = new int[]{0};
        OrderService.InventoryClient inventory = new OrderService.InventoryClient() {
            public boolean reserve(String sku, int quantity) { return false; }
            public void release(String sku, int quantity) { releaseCalls[0]++; }
        };
        OrderService.RiskClient risk = (amount, priorOrders) -> "approve";
        var service = new OrderService(inventory, risk);

        var cancelled = service.cancelOrder("unknown-order-id");

        assertEquals(OrderService.CancelDecision.REJECTED, cancelled.decision());
        assertFalse(releaseCalls[0] > 0, "inventory release must not be called for an unaccepted order");
    }

    @Test
    @Tag("TEST-MARKETPLACE-007")
    void rejectsDoubleCancellationOfTheSameOrder() {
        var releaseCalls = new int[]{0};
        OrderService.InventoryClient inventory = new OrderService.InventoryClient() {
            public boolean reserve(String sku, int quantity) { return true; }
            public void release(String sku, int quantity) { releaseCalls[0]++; }
        };
        OrderService.RiskClient risk = (amount, priorOrders) -> "approve";
        var service = new OrderService(inventory, risk);

        var created = service.createOrder(new OrderService.OrderRequest("SKU-1", 2, 100.0, 3));
        service.cancelOrder(created.orderId());
        var secondCancel = service.cancelOrder(created.orderId());

        assertEquals(OrderService.CancelDecision.REJECTED, secondCancel.decision());
        assertTrue(releaseCalls[0] == 1, "inventory release must not be called again on double cancellation");
    }
}
