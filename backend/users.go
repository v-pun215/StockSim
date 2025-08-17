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

func usersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if secret := os.Getenv("ADMIN_SECRET"); secret != "" {
		if r.Header.Get("X-Admin-Secret") != secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	rows, err := db.Query("SELECT u.id, u.school_code, u.cash, u.team_id, u.created_at, t.name FROM users u LEFT JOIN teams t ON u.team_id = t.id")
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type UserOut struct {
		ID        int64   `json:"id"`
		Username  string  `json:"username"`
		Cash      float64 `json:"cash"`
		TeamID    *int64  `json:"team_id,omitempty"`
		TeamName  *string `json:"team_name,omitempty"`
		CreatedAt string  `json:"created_at"`
	}

	users := make([]UserOut, 0)
	for rows.Next() {
		var u UserOut
		var created sql.NullString
		var teamID sql.NullInt64
		var teamName sql.NullString
		if err := rows.Scan(&u.ID, &u.Username, &u.Cash, &teamID, &created, &teamName); err != nil {
			http.Error(w, "db scan error", http.StatusInternalServerError)
			return
		}
		if created.Valid {
			u.CreatedAt = created.String
		} else {
			u.CreatedAt = ""
		}
		if teamID.Valid {
			val := teamID.Int64
			u.TeamID = &val
		}
		if teamName.Valid {
			val := teamName.String
			u.TeamName = &val
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
		Username   string `json:"username"`
		TeamAction string `json:"team_action,omitempty"`
		TeamName   string `json:"team_name,omitempty"`
		TeamID     int64  `json:"team_id,omitempty"`
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

	action := strings.ToLower(strings.TrimSpace(req.TeamAction))

	var existingID int64
	var existingCash float64
	err := db.QueryRow("SELECT id, cash FROM users WHERE school_code = ?", req.Username).Scan(&existingID, &existingCash)
	if err == nil {
		cookie := &http.Cookie{
			Name:     "stocksim_user",
			Value:    fmt.Sprintf("%d", existingID),
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Expires:  time.Now().Add(30 * 24 * time.Hour),
		}
		http.SetCookie(w, cookie)

		var teamID sql.NullInt64
		var teamName sql.NullString
		_ = db.QueryRow("SELECT team_id FROM users WHERE id = ?", existingID).Scan(&teamID)
		if teamID.Valid {
			_ = db.QueryRow("SELECT name FROM teams WHERE id = ?", teamID.Int64).Scan(&teamName)
		}

		resp := map[string]interface{}{
			"user_id":  existingID,
			"username": req.Username,
			"cash":     existingCash,
		}
		if teamID.Valid {
			resp["team_id"] = teamID.Int64
		}
		if teamName.Valid {
			resp["team_name"] = teamName.String
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
		return
	} else if err != sql.ErrNoRows {
		http.Error(w, "db error", http.StatusInternalServerError)
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

	var teamIDResult sql.NullInt64

	if action == "create" {
		teamNameTrim := strings.TrimSpace(req.TeamName)
		if teamNameTrim == "" {
			tx.Rollback()
			http.Error(w, "team name required", http.StatusBadRequest)
			return
		}
		res, err := tx.Exec("INSERT INTO teams (name) VALUES (?)", teamNameTrim)
		if err != nil {
			var existingTeamID int64
			if err2 := tx.QueryRow("SELECT id FROM teams WHERE name = ?", teamNameTrim).Scan(&existingTeamID); err2 == nil {
				teamIDResult = sql.NullInt64{Int64: existingTeamID, Valid: true}
			} else {
				tx.Rollback()
				http.Error(w, "db error creating team", http.StatusInternalServerError)
				return
			}
		} else {
			last, _ := res.LastInsertId()
			teamIDResult = sql.NullInt64{Int64: last, Valid: true}
		}

		if teamIDResult.Valid {
			var cnt int
			if err := tx.QueryRow("SELECT COUNT(*) FROM users WHERE team_id = ?", teamIDResult.Int64).Scan(&cnt); err != nil {
				tx.Rollback()
				http.Error(w, "db error", http.StatusInternalServerError)
				return
			}
			if cnt >= 6 {
				tx.Rollback()
				http.Error(w, "team already full", http.StatusBadRequest)
				return
			}
		}
	} else if action == "join" {
		if req.TeamID <= 0 {
			tx.Rollback()
			http.Error(w, "team_id required to join", http.StatusBadRequest)
			return
		}
		var tname string
		if err := tx.QueryRow("SELECT name FROM teams WHERE id = ?", req.TeamID).Scan(&tname); err != nil {
			if err == sql.ErrNoRows {
				tx.Rollback()
				http.Error(w, "team not found", http.StatusBadRequest)
				return
			}
			tx.Rollback()
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		var cnt int
		if err := tx.QueryRow("SELECT COUNT(*) FROM users WHERE team_id = ?", req.TeamID).Scan(&cnt); err != nil {
			tx.Rollback()
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		if cnt >= 6 {
			tx.Rollback()
			http.Error(w, "team is full", http.StatusBadRequest)
			return
		}
		teamIDResult = sql.NullInt64{Int64: req.TeamID, Valid: true}
	} else {
		teamIDResult = sql.NullInt64{Valid: false}
	}

	var res sql.Result
	if teamIDResult.Valid {
		res, err = tx.Exec("INSERT INTO users (school_code, cash, team_id) VALUES (?, ?, ?)", req.Username, 10000.0, teamIDResult.Int64)
	} else {
		res, err = tx.Exec("INSERT INTO users (school_code, cash) VALUES (?, ?)", req.Username, 10000.0)
	}
	if err != nil {
		tx.Rollback()
		if err2 := db.QueryRow("SELECT id, cash FROM users WHERE school_code = ?", req.Username).Scan(&existingID, &existingCash); err2 == nil {
			cookie := &http.Cookie{
				Name:     "stocksim_user",
				Value:    fmt.Sprintf("%d", existingID),
				Path:     "/",
				HttpOnly: true,
				SameSite: http.SameSiteLaxMode,
				Expires:  time.Now().Add(30 * 24 * time.Hour),
			}
			http.SetCookie(w, cookie)
			resp := map[string]interface{}{"user_id": existingID, "username": req.Username, "cash": existingCash}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		http.Error(w, "db error inserting user", http.StatusInternalServerError)
		return
	}
	newID, _ := res.LastInsertId()

	if err := tx.Commit(); err != nil {
		tx.Rollback()
		http.Error(w, "db commit error", http.StatusInternalServerError)
		return
	}

	cookie := &http.Cookie{
		Name:     "stocksim_user",
		Value:    fmt.Sprintf("%d", newID),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(30 * 24 * time.Hour),
	}
	http.SetCookie(w, cookie)

	var teamNameResp *string
	if teamIDResult.Valid {
		var tname string
		if err := db.QueryRow("SELECT name FROM teams WHERE id = ?", teamIDResult.Int64).Scan(&tname); err == nil {
			teamNameResp = &tname
		}
	}

	resp := map[string]interface{}{
		"user_id":  newID,
		"username": req.Username,
		"cash":     10000.0,
		"message":  "ok",
	}
	if teamIDResult.Valid {
		resp["team_id"] = teamIDResult.Int64
	}
	if teamNameResp != nil {
		resp["team_name"] = *teamNameResp
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
	var teamID sql.NullInt64
	var teamName sql.NullString

	err = db.QueryRow("SELECT school_code, cash, team_id FROM users WHERE id = ?", userID).Scan(&username, &cash, &teamID)
	if err == sql.ErrNoRows {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	if teamID.Valid {
		_ = db.QueryRow("SELECT name FROM teams WHERE id = ?", teamID.Int64).Scan(&teamName)
	}

	resp := map[string]interface{}{
		"user_id":  userID,
		"username": username,
		"cash":     cash,
	}
	if teamID.Valid {
		resp["team_id"] = teamID.Int64
	}
	if teamName.Valid {
		resp["team_name"] = teamName.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func signoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "stocksim_user",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"message": "signed out"})
}
