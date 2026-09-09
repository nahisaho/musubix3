package main

import (
	"encoding/json"
	"log"
	"net/http"

	"inventory-service/inventory"
)

func main() {
	store := inventory.NewStore(map[string]int{"SKU-1": 100, "SKU-2": 5})

	http.HandleFunc("/reservations", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			SKU      string `json:"sku"`
			Quantity int    `json:"quantity"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		reservation := store.ReserveStock(req.SKU, req.Quantity)
		w.Header().Set("Content-Type", "application/json")
		if !reservation.Reserved {
			w.WriteHeader(http.StatusConflict)
		}
		_ = json.NewEncoder(w).Encode(reservation)
	})

	log.Println("inventory-service listening on :8081")
	log.Fatal(http.ListenAndServe(":8081", nil))
}
