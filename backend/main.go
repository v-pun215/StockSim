package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Stock struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Price  float64 `json:"price"`
	Change float64 `json:"change"`
}

type Config struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

var (
	stocks     []Stock
	stocksLock sync.Mutex
	clients    = make(map[*websocket.Conn]bool)
	compStart  time.Time
	compEnd    time.Time
	upgrader   = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true }, // i know this is not recommended :p
	}
)

func main() {
	rand.Seed(time.Now().UnixNano())
	loadConfig()
	loadStocks()
	initDB()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", statusHandler)
	mux.HandleFunc("/api/stocks", stocksHandler)
	mux.HandleFunc("/ws/prices", pricesWSHandler)
	mux.HandleFunc("/api/portfolio", portfolioHandler)
	mux.HandleFunc("/api/trade", tradeHandler)

	mux.Handle("/", http.StripPrefix("/", http.FileServer(http.Dir("../frontend/"))))

	go priceTicker()

	log.Println("Server listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", enableCORS(mux)))
}

func loadConfig() {
	file, err := os.ReadFile("config.json")
	if err != nil {
		log.Fatalf("Failed to read config.json: %v", err)
	}

	var cfg Config
	if err := json.Unmarshal(file, &cfg); err != nil {
		log.Fatalf("Failed to parse config.json: %v", err)
	}

	parseTime := func(value string) (time.Time, error) {
		if t, err := time.Parse(time.RFC3339, value); err == nil {
			return t, nil
		}
		if t, err := time.Parse("01/02/06 15:04", value); err == nil {
			return t, nil
		}
		return time.Time{}, fmt.Errorf("unsupported time format: %s", value)
	}

	var errStart, errEnd error
	compStart, errStart = parseTime(cfg.Start)
	compEnd, errEnd = parseTime(cfg.End)

	if errStart != nil || errEnd != nil {
		log.Fatalf("Failed to parse start/end time: %v %v", errStart, errEnd)
	}

	compStart = compStart.UTC()
	compEnd = compEnd.UTC()

	log.Printf("Competition Start (UTC): %s", compStart.Format(time.RFC3339))
	log.Printf("Competition End   (UTC): %s", compEnd.Format(time.RFC3339))
}

func loadStocks() {
	file, err := os.ReadFile("data/stocks.json")
	if err != nil {
		log.Fatalf("Failed to read stocks.json: %v", err)
	}

	if err := json.Unmarshal(file, &stocks); err != nil {
		log.Fatalf("Failed to parse stocks.json: %v", err)
	}

	log.Printf("Loaded %d stocks", len(stocks))
}

func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
func getStockPrice(stockID string) (float64, error) {
	stocksLock.Lock()
	defer stocksLock.Unlock()
	for _, s := range stocks {
		if s.ID == stockID {
			return s.Price, nil
		}
	}
	return 0, errors.New("stock not found")
}

func portfolioHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	uidStr := r.URL.Query().Get("user_id")
	if uidStr == "" {
		http.Error(w, "missing user_id", http.StatusBadRequest)
		return
	}
	userID, err := strconv.Atoi(uidStr)
	if err != nil {
		http.Error(w, "invalid user_id", http.StatusBadRequest)
		return
	}

	// load cash
	var cash float64
	err = db.QueryRow("SELECT cash FROM users WHERE id = ?", userID).Scan(&cash)
	if err == sql.ErrNoRows {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	// load holdings
	rows, err := db.Query("SELECT stock_id, shares, avg_price FROM portfolio WHERE user_id = ?", userID)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Holding struct {
		StockID      string  `json:"stock_id"`
		Shares       int64   `json:"shares"`
		AvgPrice     float64 `json:"avg_price"`
		CurrentPrice float64 `json:"current_price"`
		Value        float64 `json:"value"`
	}

	holdingsRes := []Holding{}
	totalValue := cash
	for rows.Next() {
		var stockID string
		var shares int64
		var avgPrice float64
		if err := rows.Scan(&stockID, &shares, &avgPrice); err != nil {
			http.Error(w, "db scan error", http.StatusInternalServerError)
			return
		}
		price, perr := getStockPrice(stockID)
		if perr != nil {
			price = 0
		}
		value := float64(shares) * price
		totalValue += value
		holdingsRes = append(holdingsRes, Holding{
			StockID: stockID, Shares: shares, AvgPrice: avgPrice, CurrentPrice: price, Value: value,
		})
	}

	resp := map[string]interface{}{
		"user_id":  userID,
		"cash":     cash,
		"holdings": holdingsRes,
		"networth": totalValue,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func tradeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "only POST allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UserID  int    `json:"user_id"`
		StockID string `json:"stock_id"`
		Action  string `json:"action"` // "buy" or "sell"
		Shares  int64  `json:"shares"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Shares <= 0 {
		http.Error(w, "shares must be > 0", http.StatusBadRequest)
		return
	}
	price, err := getStockPrice(req.StockID)
	if err != nil {
		http.Error(w, "unknown stock", http.StatusBadRequest)
		return
	}

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, "db tx error", http.StatusInternalServerError)
		return
	}
	defer func() {
		if p := recover(); p != nil {
			tx.Rollback()
			panic(p)
		}
	}()

	// read user cash
	var cash float64
	err = tx.QueryRow("SELECT cash FROM users WHERE id = ? FOR UPDATE", req.UserID).Scan(&cash)
	if err == sql.ErrNoRows {
		tx.Rollback()
		http.Error(w, "user not found", http.StatusNotFound)
		return
	} else if err != nil {
		tx.Rollback()
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	cost := float64(req.Shares) * price

	switch req.Action {
	case "buy":
		if cash < cost {
			tx.Rollback()
			http.Error(w, "insufficient funds", http.StatusBadRequest)
			return
		}
		// update or insert portfolio
		var curShares int64
		var curAvg float64
		row := tx.QueryRow("SELECT shares, avg_price FROM portfolio WHERE user_id = ? AND stock_id = ?", req.UserID, req.StockID)
		err = row.Scan(&curShares, &curAvg)
		if err == sql.ErrNoRows {
			_, err = tx.Exec("INSERT INTO portfolio(user_id, stock_id, shares, avg_price) VALUES(?,?,?,?)", req.UserID, req.StockID, req.Shares, price)
			if err != nil {
				tx.Rollback()
				http.Error(w, "db insert error", http.StatusInternalServerError)
				return
			}
		} else if err == nil {
			newShares := curShares + req.Shares
			// weighted avg price
			newAvg := ((float64(curShares) * curAvg) + (float64(req.Shares) * price)) / float64(newShares)
			_, err = tx.Exec("UPDATE portfolio SET shares = ?, avg_price = ? WHERE user_id = ? AND stock_id = ?", newShares, newAvg, req.UserID, req.StockID)
			if err != nil {
				tx.Rollback()
				http.Error(w, "db update error", http.StatusInternalServerError)
				return
			}
		} else {
			tx.Rollback()
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}

		// deduct cash
		_, err = tx.Exec("UPDATE users SET cash = cash - ? WHERE id = ?", cost, req.UserID)
		if err != nil {
			tx.Rollback()
			http.Error(w, "db update error", http.StatusInternalServerError)
			return
		}

		// insert transaction
		_, err = tx.Exec("INSERT INTO transactions(user_id, stock_id, action, shares, price) VALUES(?,?,?,?,?)", req.UserID, req.StockID, "buy", req.Shares, price)
		if err != nil {
			tx.Rollback()
			http.Error(w, "db insert error", http.StatusInternalServerError)
			return
		}

	case "sell":
		// check existing shares
		var curShares int64
		var curAvg float64
		row := tx.QueryRow("SELECT shares, avg_price FROM portfolio WHERE user_id = ? AND stock_id = ?", req.UserID, req.StockID)
		err = row.Scan(&curShares, &curAvg)
		if err == sql.ErrNoRows {
			tx.Rollback()
			http.Error(w, "no shares to sell", http.StatusBadRequest)
			return
		} else if err != nil {
			tx.Rollback()
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		if curShares < req.Shares {
			tx.Rollback()
			http.Error(w, "not enough shares", http.StatusBadRequest)
			return
		}

		// add cash
		_, err = tx.Exec("UPDATE users SET cash = cash + ? WHERE id = ?", cost, req.UserID)
		if err != nil {
			tx.Rollback()
			http.Error(w, "db update error", http.StatusInternalServerError)
			return
		}

		newShares := curShares - req.Shares
		if newShares == 0 {
			_, err = tx.Exec("DELETE FROM portfolio WHERE user_id = ? AND stock_id = ?", req.UserID, req.StockID)
			if err != nil {
				tx.Rollback()
				http.Error(w, "db delete error", http.StatusInternalServerError)
				return
			}
		} else {
			// keep avg_price as before
			_, err = tx.Exec("UPDATE portfolio SET shares = ? WHERE user_id = ? AND stock_id = ?", newShares, req.UserID, req.StockID)
			if err != nil {
				tx.Rollback()
				http.Error(w, "db update error", http.StatusInternalServerError)
				return
			}
		}

		// insert transaction
		_, err = tx.Exec("INSERT INTO transactions(user_id, stock_id, action, shares, price) VALUES(?,?,?,?,?)", req.UserID, req.StockID, "sell", req.Shares, price)
		if err != nil {
			tx.Rollback()
			http.Error(w, "db insert error", http.StatusInternalServerError)
			return
		}

	default:
		tx.Rollback()
		http.Error(w, "action must be buy or sell", http.StatusBadRequest)
		return
	}

	if err := tx.Commit(); err != nil {
		tx.Rollback()
		http.Error(w, "db commit error", http.StatusInternalServerError)
		return
	}

	// return updated portfolio snapshot
	w.Header().Set("Content-Type", "application/json")
	// re-use portfolioHandler logic to build response
	portfolioHandler(w, r)
}

func statusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	now := time.Now().UTC()
	open := now.After(compStart) && now.Before(compEnd)

	resp := map[string]interface{}{
		"start": compStart.Format(time.RFC3339),
		"end":   compEnd.Format(time.RFC3339),
		"now":   now.Format(time.RFC3339),
		"open":  open,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func stocksHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	stocksLock.Lock()
	defer stocksLock.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stocks)
}

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
	for {
		time.Sleep(3 * time.Second)
		stocksLock.Lock()
		for i := range stocks {
			// generate random price change between -2% to +2%
			change := (rand.Float64() - 0.5) * 2
			percentChange := change * 0.02
			oldPrice := stocks[i].Price
			newPrice := oldPrice * (1 + percentChange)
			stocks[i].Change = newPrice - oldPrice
			stocks[i].Price = newPrice
		}
		updated := make([]Stock, len(stocks))
		copy(updated, stocks)
		stocksLock.Unlock()

		broadcastPrices(updated)
	}
}

func broadcastPrices(data []Stock) {
	msg, _ := json.Marshal(map[string]interface{}{
		"stocks": data,
		"time":   time.Now().UTC().Format(time.RFC3339),
	})

	for conn := range clients {
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Println("WebSocket write error:", err)
			conn.Close()
			delete(clients, conn)
		}
	}
}
