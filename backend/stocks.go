package main

import (
	"encoding/json"
	"log"
	"math"
	"math/rand"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

func pricesWSHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}
	defer conn.Close()

	clients[conn] = true
	log.Println("Client connected")

	// keep connection alive until client disconnects
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			log.Println("Client disconnected")
			delete(clients, conn)
			break
		}
	}
}
func priceTicker() {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	// per-stock anchors and state
	baseline := make(map[string]float64)
	momentum := make(map[string]float64)
	volatility := make(map[string]float64)

	// initial setup (use current prices as baseline)
	stocksLock.Lock()
	for _, s := range stocks {
		baseline[s.ID] = s.Price
		momentum[s.ID] = 0.0
		// had to study ts :sob: :pray: :wilted_rose:
		// default per-tick volatility (fraction). 0.001 = 0.1% typical tick.
		volatility[s.ID] = 0.0012
	}
	stocksLock.Unlock()

	for range ticker.C {
		now := time.Now().Local()

		stocksLock.Lock()
		for i := range stocks {
			id := stocks[i].ID
			oldPrice := stocks[i].Price

			// small Gaussian (Box-Muller) interesting stuff
			u1 := rand.Float64()
			u2 := rand.Float64()
			if u1 < 1e-12 {
				u1 = 1e-12
			}
			z := math.Sqrt(-2*math.Log(u1)) * math.Cos(2*math.Pi*u2)

			// mean reversion toward baseline (gentle)
			meanReversionK := 0.0006
			meanRevert := meanReversionK * (baseline[id] - oldPrice) / oldPrice

			// gentle momentum
			mom := momentum[id]

			// per-tick volatility (stddev fraction)
			sigma := volatility[id]

			// combined fractional change for this tick
			pctChange := mom + meanRevert + sigma*z

			// cap absolute percent change per tick to keep things stable
			const maxPct = 0.0035 // ~0.35% per tick cap (tune down for calmer)
			if pctChange > maxPct {
				pctChange = maxPct
			} else if pctChange < -maxPct {
				pctChange = -maxPct
			}

			// new price
			newPrice := oldPrice * (1 + pctChange)
			if newPrice < 0.01 {
				newPrice = 0.01
			}

			// update stock struct
			stocks[i].Change = newPrice - oldPrice
			stocks[i].Price = newPrice

			// update momentum: decay + small addition from this tick
			const momentumDecay = 0.88
			const momentumGain = 0.12
			momentum[id] = momentum[id]*momentumDecay + pctChange*momentumGain
			// clamp momentum
			if momentum[id] > 0.003 {
				momentum[id] = 0.003
			} else if momentum[id] < -0.003 {
				momentum[id] = -0.003
			}

			// realistic-ish volume
			volBase := int64(80 + rand.Intn(220)) // base 80..299
			volMultiplier := 1.0 + math.Min(math.Abs(pctChange)*220.0, 6.0)
			vol := int64(float64(volBase) * volMultiplier)

			// append tick for history (uses local time now inside appendTick)
			appendTick(id, newPrice, vol)
		}

		// snapshot and unlock before broadcasting
		updated := make([]Stock, len(stocks))
		copy(updated, stocks)
		stocksLock.Unlock()

		// broadcast snapshot (uses local time in payload)
		broadcastPrices(updated)
		_ = now
	}
}
func broadcastPrices(data []Stock) {
	msg, _ := json.Marshal(map[string]interface{}{
		"stocks": data,
		"time":   time.Now().Local().Format(time.RFC3339),
	})

	for conn := range clients {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Println("WebSocket write error:", err)
			conn.Close()
			delete(clients, conn)
		}
	}
}
