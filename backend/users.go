package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// /api/users
func usersHandler(w http.ResponseWriter, r *http.Request) {
	// handle preflight
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	// admin only
	if secret := os.Getenv("ADMIN_SECRET"); secret != "" {
		if r.Header.Get("X-Admin-Secret") != secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	rows, err := db.Query("SELECT id, school_code, cash, created_at FROM users")
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type UserOut struct {
		ID        int64   `json:"id"`
		Username  string  `json:"username"`
		Cash      float64 `json:"cash"`
		CreatedAt string  `json:"created_at"`
	}

	users := make([]UserOut, 0)
	for rows.Next() {
		var u UserOut
		var created sql.NullString
		if err := rows.Scan(&u.ID, &u.Username, &u.Cash, &created); err != nil {
			http.Error(w, "db scan error", http.StatusInternalServerError)
			return
		}
		if created.Valid {
			u.CreatedAt = created.String
		} else {
			u.CreatedAt = ""
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "db rows error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// /api/auth/signup
func signupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || len(req.Username) > 64 {
		http.Error(w, "username required (1-64 chars)", http.StatusBadRequest)
		return
	}

	// Try to find existing user
	var id int64
	var cash float64
	err := db.QueryRow("SELECT id, cash FROM users WHERE school_code = ?", req.Username).Scan(&id, &cash)
	if err == sql.ErrNoRows {
		// create new user
		res, err := db.Exec("INSERT INTO users (school_code, cash) VALUES (?, ?)", req.Username, 10000.0)
		if err != nil {
			// race or other error: try select again
			err = db.QueryRow("SELECT id, cash FROM users WHERE school_code = ?", req.Username).Scan(&id, &cash)
			if err != nil {
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
		} else {
			id, _ = res.LastInsertId()
			cash = 10000.0
		}
	} else if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	// Set a user cookie (HttpOnly) value is user id
	cookie := &http.Cookie{
		Name:     "stocksim_user",
		Value:    fmt.Sprintf("%d", id),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(30 * 24 * time.Hour),
	}
	http.SetCookie(w, cookie)

	// Return user info
	resp := map[string]interface{}{
		"user_id":  id,
		"username": req.Username,
		"cash":     cash,
		"message":  "ok",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func meHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	c, err := r.Cookie("stocksim_user")
	if err != nil {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	userID, err := strconv.ParseInt(c.Value, 10, 64)
	if err != nil {
		http.Error(w, "bad cookie", http.StatusBadRequest)
		return
	}

	var username string
	var cash float64
	err = db.QueryRow("SELECT school_code, cash FROM users WHERE id = ?", userID).Scan(&username, &cash)
	if err == sql.ErrNoRows {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"user_id":  userID,
		"username": username,
		"cash":     cash,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
