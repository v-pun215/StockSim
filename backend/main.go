package main

import (
	"log"
	"math/rand"
	"net/http"
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
	initTicks()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", statusHandler)
	mux.HandleFunc("/api/stocks", stocksHandler)
	mux.HandleFunc("/ws/prices", pricesWSHandler)
	mux.HandleFunc("/api/portfolio", portfolioHandler)
	mux.HandleFunc("/api/trade", tradeHandler)
	mux.HandleFunc("/api/auth/signup", signupHandler)
	mux.HandleFunc("/api/auth/me", meHandler)
	mux.HandleFunc("/api/users", usersHandler)
	mux.HandleFunc("/api/history", historyHandler)
	mux.HandleFunc("/api/news", getNewsHandler)                        // GET
	mux.HandleFunc("/api/admin/publish-news", publishNewsHandler)      // POST (admin)
	mux.HandleFunc("/api/admin/stock-action", adminStockActionHandler) // POST (admin)
	mux.HandleFunc("/api/leaderboard", leaderboardHandler)

	mux.Handle("/", http.StripPrefix("/", http.FileServer(http.Dir("../frontend/"))))

	go priceTicker()

	log.Println("Server listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", enableCORS(mux)))
}

func enableCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		} else {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		}

		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
