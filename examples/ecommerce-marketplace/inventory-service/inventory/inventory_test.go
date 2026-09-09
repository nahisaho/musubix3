package inventory

import "testing"

/* @id TEST-MARKETPLACE-001
 * @verifies REQ-MARKETPLACE-001
 */
func TestReserveStock(t *testing.T) {
	t.Run("TEST-MARKETPLACE-001", func(t *testing.T) {
		store := NewStore(map[string]int{"SKU-1": 10})

		reservation := store.ReserveStock("SKU-1", 4)
		if !reservation.Reserved {
			t.Fatalf("expected reservation to succeed")
		}
		if remaining := store.Remaining("SKU-1"); remaining != 6 {
			t.Fatalf("expected remaining stock 6, got %d", remaining)
		}

		rejected := store.ReserveStock("SKU-1", 100)
		if rejected.Reserved {
			t.Fatalf("expected reservation to be rejected for insufficient stock")
		}
		if remaining := store.Remaining("SKU-1"); remaining != 6 {
			t.Fatalf("expected stock unchanged after rejected reservation, got %d", remaining)
		}
	})
}
