package com.example.order;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/*
 * @id TEST-MARKETPLACE-003
 * @verifies REQ-MARKETPLACE-003
 */
class OrderServiceTest {

    @Test
    @Tag("TEST-MARKETPLACE-003")
    void acceptsOrderWhenReservedAndApproved() {
        var released = new boolean[]{false};
        OrderService.InventoryClient inventory = new OrderService.InventoryClient() {
            public boolean reserve(String sku, int quantity) { return true; }
            public void release(String sku, int quantity) { released[0] = true; }
        };
        OrderService.RiskClient risk = (amount, priorOrders) -> "approve";
        var service = new OrderService(inventory, risk);

        var result = service.createOrder(new OrderService.OrderRequest("SKU-1", 2, 100.0, 3));

        assertEquals(OrderService.Decision.ACCEPTED, result.decision());
        assertFalse(released[0], "reservation must not be released on acceptance");
    }

    @Test
    @Tag("TEST-MARKETPLACE-003")
    void rejectsAndRollsBackWhenRiskRejects() {
        var released = new boolean[]{false};
        OrderService.InventoryClient inventory = new OrderService.InventoryClient() {
            public boolean reserve(String sku, int quantity) { return true; }
            public void release(String sku, int quantity) { released[0] = true; }
        };
        OrderService.RiskClient risk = (amount, priorOrders) -> "reject";
        var service = new OrderService(inventory, risk);

        var result = service.createOrder(new OrderService.OrderRequest("SKU-1", 2, 9000.0, 0));

        assertEquals(OrderService.Decision.REJECTED, result.decision());
        assertTrue(released[0], "reservation must be released after risk rejection");
    }
}
