package main

import (
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"
)

type Stock struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Price  float64 `json:"price"`
	Change float64 `json:"change"`
	Sector string  `json:"sector"`
}

type Config struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

var (
	stocks     []Stock
	stocksLock sync.Mutex
	compStart  time.Time
	compEnd    time.Time
)

func main() {
	rand.Seed(time.Now().UnixNano())
	loadConfig()
	loadStocks()
	initDB()    // db
	initTicks() // get the inital stock history chart for frontend

	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", statusHandler)
	mux.HandleFunc("/api/transactions", transactionsHandler)
	mux.HandleFunc("/api/stocks", stocksHandler)
	mux.HandleFunc("/ws/prices", pricesWSHandler)
	mux.HandleFunc("/api/portfolio", portfolioHandler)
	mux.HandleFunc("/api/trade", tradeHandler)
	mux.HandleFunc("/api/auth/signup", signupHandler)
	mux.HandleFunc("/api/auth/signout", signoutHandler)
	mux.HandleFunc("/api/auth/me", meHandler)
	mux.HandleFunc("/api/users", usersHandler)
	mux.HandleFunc("/api/history", historyHandler)
	mux.HandleFunc("/api/news/sources", newsSourcesHandler)
	mux.HandleFunc("/api/news", getNewsHandler)
	mux.HandleFunc("/api/admin/publish-news", publishNewsHandler)
	mux.HandleFunc("/api/admin/stock-action", adminStockActionHandler)
	mux.HandleFunc("/api/leaderboard", leaderboardHandler)
	mux.HandleFunc("/api/teams", teamsHandler)
	mux.HandleFunc("/api/teams/leaderboard", teamLeaderboardHandler)
	mux.HandleFunc("/api/teams/join", joinTeamHandler)
	mux.HandleFunc("/api/teams/create", createTeamHandler)
	mux.Handle("/", http.StripPrefix("/", http.FileServer(http.Dir("../frontend/")))) // serve frontend

	go priceTicker() // start price ticking

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	log.Printf("Server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, enableCORS(mux)))
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
