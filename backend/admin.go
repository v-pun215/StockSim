package main

import (
	"encoding/json"
	"math"
	"math/rand"
	"net/http"
	"os"
	"time"
)

// admin abuse :(, wrote it twice accidentally (covid got me down bad huh)
func adminStockActionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	// admin secret
	if secret := os.Getenv("ADMIN_SECRET"); secret != "" {
		if r.Header.Get("X-Admin-Secret") != secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	var req struct {
		StockID   string  `json:"stock_id"`
		Action    string  `json:"action"`
		Magnitude float64 `json:"magnitude"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.StockID == "" || (req.Action != "tank" && req.Action != "spike") {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.Magnitude <= 0 {
		req.Magnitude = 0.5
	}

	stocksLock.Lock()
	found := false
	for i := range stocks {
		if stocks[i].ID == req.StockID {
			found = true
			break
		}
	}
	stocksLock.Unlock()
	if !found {
		http.Error(w, "stock not found", http.StatusBadRequest)
		return
	}

	_, _ = db.Exec("INSERT INTO admin_actions (stock_id, action, magnitude, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", req.StockID, req.Action, req.Magnitude)

	go func(stockID string, action string, magnitude float64) {
		stocksLock.Lock()
		var basePrice float64
		for i := range stocks {
			if stocks[i].ID == stockID {
				basePrice = stocks[i].Price
				break
			}
		}
		stocksLock.Unlock()
		if basePrice <= 0 {
			basePrice = 0.01
		}

		sign := 1.0
		if action == "tank" {
			sign = -1.0
		}

		if magnitude > 4.0 {
			magnitude = 4.0
		} else if magnitude < 0 {
			magnitude = 0
		}

		targetMultiplier := 1.0 + sign*magnitude
		if targetMultiplier <= 0.0001 {
			targetMultiplier = 0.0001
		}
		steps := int(40 + math.Round(math.Abs(magnitude)*160)) // ~40..(200+)
		if steps < 30 {
			steps = 30
		}
		if steps > 900 {
			steps = 900
		}
		randNorm := func() float64 {
			u1 := rand.Float64()
			u2 := rand.Float64()
			if u1 < 1e-12 {
				u1 = 1e-12
			}
			return math.Sqrt(-2.0*math.Log(u1)) * math.Cos(2.0*math.Pi*u2)
		}
		easeInOut := func(x float64) float64 {
			return 0.5 - 0.5*math.Cos(math.Pi*x)
		}

		currentPrice := basePrice
		lastAppend := time.Now().Add(-2 * time.Minute)

		for step := 1; step <= steps; step++ {
			frac := float64(step) / float64(steps)
			targetFrac := easeInOut(frac)
			ideal := basePrice * math.Pow(targetMultiplier, targetFrac)
			moveFactor := 0.08 + 0.55*math.Pow(frac, 1.1)
			noiseScale := 0.0006 + 0.006*math.Abs(magnitude)
			noise := randNorm() * noiseScale * basePrice

			nextPrice := currentPrice + (ideal-currentPrice)*moveFactor + noise

			microSteps := 1 + rand.Intn(3)
			for m := 0; m < microSteps; m++ {
				jitter := randNorm() * 0.00035 * basePrice
				stepPrice := nextPrice + jitter
				maxAllowed := basePrice * targetMultiplier * 1.06
				minAllowed := basePrice * targetMultiplier * 0.94
				if sign >= 0 && stepPrice > maxAllowed {
					stepPrice = maxAllowed
				}
				if sign < 0 && stepPrice < minAllowed {
					stepPrice = minAllowed
				}
				if stepPrice < 0.01 {
					stepPrice = 0.01
				}
				stocksLock.Lock()
				for i := range stocks {
					if stocks[i].ID != stockID {
						continue
					}
					prev := stocks[i].Price
					stocks[i].Price = stepPrice
					stocks[i].Change = stepPrice - prev
				}
				updated := make([]Stock, len(stocks))
				copy(updated, stocks)
				stocksLock.Unlock()
				broadcastPrices(updated)

				shouldAppend := false
				if time.Since(lastAppend) > 1200*time.Millisecond {
					shouldAppend = true
				} else if m == microSteps-1 && (math.Abs(stepPrice-currentPrice) > basePrice*0.002) {
					shouldAppend = true
				}

				if shouldAppend {
					vol := int64(400 + rand.Intn(3000) + int(math.Round(700.0*math.Abs(magnitude))))
					appendTick(stockID, stepPrice, vol)
					lastAppend = time.Now()
				}

				currentPrice = stepPrice
				sleepMs := 120 + rand.Intn(520)
				time.Sleep(time.Duration(sleepMs) * time.Millisecond)
			}

			// makes it look a little bit more realistic
			plateauProb := 0.08 + 0.12*(1.0-frac)
			if rand.Float64() < plateauProb {
				time.Sleep(time.Duration(400+rand.Intn(1400)) * time.Millisecond)
			}
		}
		finalPrice := basePrice * targetMultiplier
		if finalPrice < 0.01 {
			finalPrice = 0.01
		}
		stocksLock.Lock()
		for i := range stocks {
			if stocks[i].ID != stockID {
				continue
			}
			prev := stocks[i].Price
			stocks[i].Price = finalPrice
			stocks[i].Change = finalPrice - prev
			vol := int64(1200 + rand.Intn(5200))
			appendTick(stocks[i].ID, finalPrice, vol)
		}
		updated := make([]Stock, len(stocks))
		copy(updated, stocks)
		stocksLock.Unlock()
		broadcastPrices(updated)
	}(req.StockID, req.Action, req.Magnitude)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "stock_id": req.StockID})
}
