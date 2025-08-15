package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

// this gets stock price for any given stock symbol
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

// this took me lot of time to get right lol
func tradeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "only POST allowed, buddy", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		UserID  int    `json:"user_id"`
		StockID string `json:"stock_id"`
		Action  string `json:"action"` // buy or sell
		Shares  int64  `json:"shares"`
	}
	//error handling
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
	err = tx.QueryRow("SELECT cash FROM users WHERE id = ?", req.UserID).Scan(&cash)
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
	portfolioHandler(w, r)
}
