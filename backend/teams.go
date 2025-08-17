package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

type TeamMember struct {
	UserID   int64   `json:"user_id"`
	Username string  `json:"username"`
	Cash     float64 `json:"cash"`
	Networth float64 `json:"networth"`
	JoinedAt string  `json:"joined_at"`
}

type TeamOut struct {
	ID          int64        `json:"id"`
	Name        string       `json:"name"`
	CreatedAt   string       `json:"created_at"`
	Members     []TeamMember `json:"members"`
	MemberCount int          `json:"member_count"`
	Capacity    int          `json:"capacity"`
	TeamCash    float64      `json:"team_cash"`
	TeamValue   float64      `json:"team_value"`
	AvgNetworth float64      `json:"avg_networth"`
	Rank        int          `json:"rank,omitempty"`
}

type TeamSummary struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	MemberCount int     `json:"member_count"`
	TeamValue   float64 `json:"team_value"`
	Rank        int     `json:"rank"`
}

func teamsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == http.MethodPost {
		editTeamHandler(w, r)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	teamIDStr := r.URL.Query().Get("id")
	if teamIDStr != "" {
		teamID, err := strconv.ParseInt(teamIDStr, 10, 64)
		if err != nil {
			http.Error(w, "invalid team id", http.StatusBadRequest)
			return
		}
		handleSingleTeam(w, teamID)
		return
	}
	if r.URL.Query().Get("view") == "summary" {
		handleTeamsSummary(w)
		return
	}

	handleAllTeams(w)
}

// admin only edit capacity
func editTeamHandler(w http.ResponseWriter, r *http.Request) {
	// admin guard
	if secret := os.Getenv("ADMIN_SECRET"); secret != "" {
		if r.Header.Get("X-Admin-Secret") != secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Capacity int `json:"capacity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Capacity < 1 {
		http.Error(w, "capacity must be >= 1", http.StatusBadRequest)
		return
	}

	_, err := db.Exec("UPDATE teams SET capacity = ?", req.Capacity)
	if err != nil {
		http.Error(w, "db update error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"message":  "capacity updated for all teams",
		"capacity": req.Capacity,
	})
}

func handleSingleTeam(w http.ResponseWriter, teamID int64) {
	team, err := getTeamDetails(teamID)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "team not found", http.StatusNotFound)
			return
		}
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(team)
}

func handleTeamsSummary(w http.ResponseWriter) {
	rows, err := db.Query("SELECT id, name, created_at FROM teams ORDER BY created_at DESC")
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	teams := make([]TeamSummary, 0)
	for rows.Next() {
		var teamID int64
		var name string
		var created sql.NullString
		if err := rows.Scan(&teamID, &name, &created); err != nil {
			continue
		}

		// calculate team stats
		memberCount, teamValue := calculateTeamStats(teamID)

		teams = append(teams, TeamSummary{
			ID:          teamID,
			Name:        name,
			MemberCount: memberCount,
			TeamValue:   teamValue,
		})
	}

	// ranking by stats
	for i := range teams {
		for j := range teams {
			if teams[j].TeamValue > teams[i].TeamValue {
				teams[i].Rank++
			}
		}
		teams[i].Rank++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(teams)
}

func handleAllTeams(w http.ResponseWriter) {
	rows, err := db.Query("SELECT id, name, created_at FROM teams ORDER BY created_at DESC")
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	teams := make([]TeamOut, 0)
	for rows.Next() {
		var teamID int64
		var name string
		var created sql.NullString
		if err := rows.Scan(&teamID, &name, &created); err != nil {
			continue
		}

		team, err := getTeamDetails(teamID)
		if err != nil {
			continue
		}

		teams = append(teams, *team)
	}
	for i := range teams {
		rank := 1
		for j := range teams {
			if teams[j].TeamValue > teams[i].TeamValue {
				rank++
			}
		}
		teams[i].Rank = rank
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(teams)
}

func getTeamDetails(teamID int64) (*TeamOut, error) {
	var name string
	var created sql.NullString

	if err := db.QueryRow("SELECT name, created_at FROM teams WHERE id = ?", teamID).Scan(&name, &created); err != nil {
		return nil, err
	}

	var capacity sql.NullInt64
	if err := db.QueryRow("SELECT capacity FROM teams WHERE id = ?", teamID).Scan(&capacity); err != nil {
		capacity = sql.NullInt64{Valid: false}
	}

	memberRows, err := db.Query(`
		SELECT u.id, u.school_code, u.cash, u.created_at 
		FROM users u 
		WHERE u.team_id = ? 
		ORDER BY u.created_at ASC
	`, teamID)
	if err != nil {
		return nil, err
	}
	defer memberRows.Close()

	var members []TeamMember
	var totalCash float64
	var totalValue float64

	for memberRows.Next() {
		var userID int64
		var username string
		var cash float64
		var joinedAt sql.NullString

		if err := memberRows.Scan(&userID, &username, &cash, &joinedAt); err != nil {
			continue
		}

		// calculate protfolio value
		portfolioValue := calculateUserPortfolioValue(userID)
		networth := cash + portfolioValue

		member := TeamMember{
			UserID:   userID,
			Username: username,
			Cash:     cash,
			Networth: roundToTwo(networth),
		}

		if joinedAt.Valid {
			member.JoinedAt = joinedAt.String
		}

		members = append(members, member)
		totalCash += cash
		totalValue += networth
	}

	avgNetworth := 0.0
	if len(members) > 0 {
		avgNetworth = totalValue / float64(len(members))
	}

	team := &TeamOut{
		ID:          teamID,
		Name:        name,
		Members:     members,
		MemberCount: len(members),
		Capacity:    6, // fallback, db issues can occur fr some reason idk
		TeamCash:    roundToTwo(totalCash),
		TeamValue:   roundToTwo(totalValue),
		AvgNetworth: roundToTwo(avgNetworth),
	}

	if capacity.Valid {
		team.Capacity = int(capacity.Int64)
	}

	if created.Valid {
		team.CreatedAt = created.String
	}

	return team, nil
}

func calculateUserPortfolioValue(userID int64) float64 {
	rows, err := db.Query("SELECT stock_id, shares FROM portfolio WHERE user_id = ?", userID)
	if err != nil {
		return 0
	}
	defer rows.Close()

	var total float64
	for rows.Next() {
		var stockID string
		var shares int64
		if err := rows.Scan(&stockID, &shares); err != nil {
			continue
		}

		price, err := getStockPrice(stockID)
		if err != nil {
			price = 0
		}
		total += float64(shares) * price
	}

	return total
}

func calculateTeamStats(teamID int64) (int, float64) {
	rows, err := db.Query("SELECT id FROM users WHERE team_id = ?", teamID)
	if err != nil {
		return 0, 0
	}
	defer rows.Close()

	var memberCount int
	var totalValue float64

	for rows.Next() {
		var userID int64
		if err := rows.Scan(&userID); err != nil {
			continue
		}
		memberCount++

		var cash float64
		if err := db.QueryRow("SELECT cash FROM users WHERE id = ?", userID).Scan(&cash); err != nil {
			continue
		}

		portfolioValue := calculateUserPortfolioValue(userID)
		totalValue += cash + portfolioValue
	}

	return memberCount, totalValue
}

func leaderboardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if li, err := strconv.Atoi(l); err == nil && li > 0 {
			limit = li
		}
	}

	type Entry struct {
		UserID   int64   `json:"user_id"`
		Username string  `json:"username"`
		TeamName string  `json:"team_name"`
		Networth float64 `json:"networth"`
		Rank     int     `json:"rank"`
	}

	rows, err := db.Query(`
		SELECT u.id, u.school_code, u.cash, t.name
		FROM users u
		LEFT JOIN teams t ON u.team_id = t.id
	`)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := make([]Entry, 0)

	for rows.Next() {
		var uid int64
		var username string
		var cash float64
		var teamName sql.NullString

		if err := rows.Scan(&uid, &username, &cash, &teamName); err != nil {
			continue
		}

		portfolioValue := calculateUserPortfolioValue(uid)
		networth := roundToTwo(cash + portfolioValue)

		entries = append(entries, Entry{
			UserID:   uid,
			Username: username,
			TeamName: nullToString(teamName),
			Networth: networth,
		})
	}
	//networth based ranking
	sort.Slice(entries, func(i, j int) bool { return entries[i].Networth > entries[j].Networth })

	for i := range entries {
		entries[i].Rank = i + 1
	}

	if len(entries) > limit {
		entries = entries[:limit]
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(entries)
}

func nullToString(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

func teamLeaderboardHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if li, err := strconv.Atoi(l); err == nil && li > 0 {
			limit = li
		}
	}

	rows, err := db.Query("SELECT DISTINCT team_id FROM users WHERE team_id IS NOT NULL")
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type TeamLeaderboardEntry struct {
		TeamID      int64   `json:"team_id"`
		TeamName    string  `json:"team_name"`
		MemberCount int     `json:"member_count"`
		TeamValue   float64 `json:"team_value"`
		AvgNetworth float64 `json:"avg_networth"`
		TopMember   string  `json:"top_member"`
		TopNetworth float64 `json:"top_networth"`
		Rank        int     `json:"rank"`
	}

	var teams []TeamLeaderboardEntry

	for rows.Next() {
		var teamID int64
		if err := rows.Scan(&teamID); err != nil {
			continue
		}

		var teamName string
		if err := db.QueryRow("SELECT name FROM teams WHERE id = ?", teamID).Scan(&teamName); err != nil {
			continue
		}
		memberRows, err := db.Query("SELECT id, school_code, cash FROM users WHERE team_id = ?", teamID)
		if err != nil {
			continue
		}

		var totalValue float64
		var memberCount int
		var topMember string
		var topNetworth float64

		for memberRows.Next() {
			var userID int64
			var username string
			var cash float64

			if err := memberRows.Scan(&userID, &username, &cash); err != nil {
				continue
			}

			portfolioValue := calculateUserPortfolioValue(userID)
			networth := cash + portfolioValue
			totalValue += networth
			memberCount++

			if networth > topNetworth {
				topNetworth = networth
				topMember = username
			}
		}
		memberRows.Close()

		avgNetworth := 0.0
		if memberCount > 0 {
			avgNetworth = totalValue / float64(memberCount)
		}

		teams = append(teams, TeamLeaderboardEntry{
			TeamID:      teamID,
			TeamName:    teamName,
			MemberCount: memberCount,
			TeamValue:   roundToTwo(totalValue),
			AvgNetworth: roundToTwo(avgNetworth),
			TopMember:   topMember,
			TopNetworth: roundToTwo(topNetworth),
		})
	}
	for i := 0; i < len(teams); i++ {
		for j := i + 1; j < len(teams); j++ {
			if teams[j].TeamValue > teams[i].TeamValue {
				teams[i], teams[j] = teams[j], teams[i]
			}
		}
	}

	for i := range teams {
		teams[i].Rank = i + 1
	}

	if len(teams) > limit {
		teams = teams[:limit]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(teams)
}

func joinTeamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, err := parseUserIDFromRequest(r)
	if err != nil {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	var req struct {
		TeamID int64 `json:"team_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	if req.TeamID <= 0 {
		http.Error(w, "team_id required", http.StatusBadRequest)
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

	// does team exist?
	var teamName string
	if err := tx.QueryRow("SELECT name FROM teams WHERE id = ?", req.TeamID).Scan(&teamName); err != nil {
		tx.Rollback()
		if err == sql.ErrNoRows {
			http.Error(w, "team not found", http.StatusNotFound)
			return
		}
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	// get capacity
	var memberCount int
	if err := tx.QueryRow("SELECT COUNT(*) FROM users WHERE team_id = ?", req.TeamID).Scan(&memberCount); err != nil {
		tx.Rollback()
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	// fallback to 6 if not there
	capVal := 6
	var capNull sql.NullInt64
	if err := tx.QueryRow("SELECT capacity FROM teams WHERE id = ?", req.TeamID).Scan(&capNull); err == nil && capNull.Valid {
		capVal = int(capNull.Int64)
	}

	if memberCount >= capVal {
		tx.Rollback()
		http.Error(w, "team is full", http.StatusBadRequest)
		return
	}

	// is user in a team?
	var currentTeamID sql.NullInt64
	if err := tx.QueryRow("SELECT team_id FROM users WHERE id = ?", userID).Scan(&currentTeamID); err != nil {
		tx.Rollback()
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	if currentTeamID.Valid {
		tx.Rollback()
		http.Error(w, "already in a team", http.StatusBadRequest)
		return
	}

	_, err = tx.Exec("UPDATE users SET team_id = ? WHERE id = ?", req.TeamID, userID)
	if err != nil {
		tx.Rollback()
		http.Error(w, "db update error", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		tx.Rollback()
		http.Error(w, "db commit error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":   "successfully joined team",
		"team_id":   req.TeamID,
		"team_name": teamName,
	})
}

func createTeamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, err := parseUserIDFromRequest(r)
	if err != nil {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}
	var req struct {
		TeamName string `json:"team_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	req.TeamName = strings.TrimSpace(req.TeamName)
	if req.TeamName == "" || len(req.TeamName) > 64 {
		http.Error(w, "team name required (1-64 chars)", http.StatusBadRequest)
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

	var currentTeamID sql.NullInt64
	if err := tx.QueryRow("SELECT team_id FROM users WHERE id = ?", userID).Scan(&currentTeamID); err != nil {
		tx.Rollback()
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	if currentTeamID.Valid {
		tx.Rollback()
		http.Error(w, "already in a team", http.StatusBadRequest)
		return
	}
	var existingID int64
	err = tx.QueryRow("SELECT id FROM teams WHERE name = ?", req.TeamName).Scan(&existingID)
	if err == nil {
		tx.Rollback()
		http.Error(w, "team name already exists", http.StatusBadRequest)
		return
	} else if err != sql.ErrNoRows {
		tx.Rollback()
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	res, err := tx.Exec("INSERT INTO teams (name) VALUES (?)", req.TeamName)
	if err != nil {
		tx.Rollback()
		http.Error(w, "db insert error", http.StatusInternalServerError)
		return
	}

	teamID, _ := res.LastInsertId()

	_, err = tx.Exec("UPDATE users SET team_id = ? WHERE id = ?", teamID, userID)
	if err != nil {
		tx.Rollback()
		http.Error(w, "db update error", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		tx.Rollback()
		http.Error(w, "db commit error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":   "team created successfully",
		"team_id":   teamID,
		"team_name": req.TeamName,
	})
}
