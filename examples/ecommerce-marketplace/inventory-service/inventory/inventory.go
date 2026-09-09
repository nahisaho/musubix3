// Package inventory implements the inventory reservation boundary of the
// ecommerce-marketplace example.
package inventory

import "sync"

// Reservation is the outcome of a stock reservation attempt.
type Reservation struct {
	SKU      string
	Quantity int
	Reserved bool
}

// Store tracks per-SKU stock levels guarded by a mutex.
type Store struct {
	mu    sync.Mutex
	stock map[string]int
}

// NewStore builds a Store from an initial stock map.
func NewStore(initial map[string]int) *Store {
	stock := make(map[string]int, len(initial))
	for sku, qty := range initial {
		stock[sku] = qty
	}
	return &Store{stock: stock}
}

/* @id CODE-MARKETPLACE-001
 * @implements REQ-MARKETPLACE-001
 * @design DES-MARKETPLACE-001
 */
// ReserveStock reserves qty units of sku, rejecting the reservation when
// stock is insufficient. It never leaves stock negative.
func (s *Store) ReserveStock(sku string, qty int) Reservation {
	s.mu.Lock()
	defer s.mu.Unlock()
	available := s.stock[sku]
	if qty <= 0 || available < qty {
		return Reservation{SKU: sku, Quantity: qty, Reserved: false}
	}
	s.stock[sku] = available - qty
	return Reservation{SKU: sku, Quantity: qty, Reserved: true}
}

// Remaining reports the current stock for sku.
func (s *Store) Remaining(sku string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stock[sku]
}

// Release returns qty units of sku back to stock; used to roll back a
// reservation when a downstream decision rejects the order.
func (s *Store) Release(sku string, qty int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stock[sku] += qty
}
