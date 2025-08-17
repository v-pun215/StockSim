package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Holding struct {
	StockID        string  `json:"stock_id"`
	Name           string  `json:"name,omitempty"`
	Shares         int64   `json:"shares"`
	AvgPrice       float64 `json:"avg_price"`
	CurrentPrice   float64 `json:"current_price"`
	MarketValue    float64 `json:"market_value"`
	UnrealizedPL   float64 `json:"unrealized_pl"`
	UnrealizedPLPc float64 `json:"unrealized_pl_pct"`
	DailyChange    float64 `json:"daily_change"` // was gonna implement something like this, but it never worked out. im too scared to take change it now lol, frontend doesnt ask daily change
	DailyChangePL  float64 `json:"daily_change_pl"`
	AllocationPct  float64 `json:"allocation_pct"`
	PrevClose      float64 `json:"prev_close"`
}

type TeamInfo struct {
	TeamID      *int64   `json:"team_id,omitempty"`
	TeamName    *string  `json:"team_name,omitempty"`
	TeamRank    *int     `json:"team_rank,omitempty"`
	TeamValue   *float64 `json:"team_value,omitempty"`
	MemberCount *int     `json:"member_count,omitempty"`
}

type PortfolioSummary struct {
	UserID             int64    `json:"user_id"`
	Username           string   `json:"username"`
	Cash               float64  `json:"cash"`
	Networth           float64  `json:"networth"`
	TotalUnrealizedPL  float64  `json:"total_unrealized_pl"`
	TotalGainSincePrev float64  `json:"total_gain_since_prev"`
	TotalGainPct       float64  `json:"total_gain_pct"`
	Diversification    int      `json:"diversification"`
	LeaderPosition     int      `json:"leaderboard_position,omitempty"`
	LeaderTotal        int      `json:"leaderboard_total,omitempty"`
	LastUpdated        string   `json:"last_updated"`
	Team               TeamInfo `json:"team"`
}

type TransactionOut struct {
	ID        int64   `json:"id"`
	Timestamp string  `json:"timestamp"`
	StockID   string  `json:"stock_id"`
	Action    string  `json:"action"`
	Shares    int64   `json:"shares"`
	Price     float64 `json:"price"`
	Total     float64 `json:"total"`
}

func parseUserIDFromRequest(r *http.Request) (int64, error) {
	// accepts cookie or user_id
	if c, err := r.Cookie("stocksim_user"); err == nil && c.Value != "" {
		if id, err := strconv.ParseInt(c.Value, 10, 64); err == nil && id > 0 {
			return id, nil
		}
	}
	if uid := r.URL.Query().Get("user_id"); uid != "" {
		if id, err := strconv.ParseInt(uid, 10, 64); err == nil && id > 0 {
			return id, nil
		}
	}
	return 0, fmt.Errorf("user not authenticated")
}

func portfolioHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, err := parseUserIDFromRequest(r)
	if err != nil {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	// fetch user's data including team info
	var cash float64
	var username string
	var teamID sql.NullInt64
	err = db.QueryRow("SELECT school_code, cash, team_id FROM users WHERE id = ?", userID).Scan(&username, &cash, &teamID)
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

	holdings := []Holding{}
	var totalMarketValue float64
	var totalUnrealizedPL float64

	for rows.Next() {
		var stockID string
		var shares int64
		var avgPrice float64
		if err := rows.Scan(&stockID, &shares, &avgPrice); err != nil {
			http.Error(w, "db scan error", http.StatusInternalServerError)
			return
		}
		// read current price from in-memory stocks list
		price, perr := getStockPrice(stockID)
		if perr != nil {
			price = 0
		}
		marketVal := float64(shares) * price
		unrealized := marketVal - float64(shares)*avgPrice

		// previous close for daily calculation (if not available, prevClose == price)
		prevClose, _ := getPreviousClose(stockID)
		// if prevClose == 0 fallback
		if prevClose == 0 {
			prevClose = price
		}
		dailyChange := price - prevClose
		dailyPL := float64(shares) * dailyChange

		h := Holding{
			StockID:       stockID,
			Shares:        shares,
			AvgPrice:      avgPrice,
			CurrentPrice:  price,
			MarketValue:   marketVal,
			UnrealizedPL:  unrealized,
			PrevClose:     prevClose,
			DailyChange:   dailyChange,
			DailyChangePL: dailyPL,
		}
		holdings = append(holdings, h)
		totalMarketValue += marketVal
		totalUnrealizedPL += unrealized
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "db rows error", http.StatusInternalServerError)
		return
	}
	for i := range holdings {
		if totalMarketValue > 0 {
			holdings[i].AllocationPct = (holdings[i].MarketValue / totalMarketValue) * 100.0
		} else {
			holdings[i].AllocationPct = 0
		}
	}

	// compute networth and previous networth (using prevClose)
	networth := cash + totalMarketValue

	previousMarketValue := 0.0
	for _, h := range holdings {
		previousMarketValue += float64(h.Shares) * h.PrevClose
	}
	previousNetworth := cash + previousMarketValue
	totalGain := networth - previousNetworth
	totalGainPct := 0.0
	if previousNetworth > 0 {
		totalGainPct = (totalGain / previousNetworth) * 100.0
	}

	diversification := len(holdings)

	leaderPos, leaderTotal := computeLeaderboardPosition(userID)
	teamInfo := getTeamInfo(teamID)

	lastUpdated := time.Now().Local().Format(time.RFC3339)

	summary := PortfolioSummary{
		UserID:             userID,
		Username:           username,
		Cash:               cash,
		Networth:           roundToTwo(networth),
		TotalUnrealizedPL:  roundToTwo(totalUnrealizedPL),
		TotalGainSincePrev: roundToTwo(totalGain),
		TotalGainPct:       roundToTwo(totalGainPct),
		Diversification:    diversification,
		LeaderPosition:     leaderPos,
		LeaderTotal:        leaderTotal,
		LastUpdated:        lastUpdated,
		Team:               teamInfo,
	}
	sort.Slice(holdings, func(i, j int) bool {
		return holdings[i].MarketValue > holdings[j].MarketValue
	})
	stocksLock.Lock()
	for i := range holdings {
		for _, s := range stocks {
			if s.ID == holdings[i].StockID {
				holdings[i].Name = s.Name
				break
			}
		}
	}
	stocksLock.Unlock()

	resp := map[string]interface{}{
		"summary":  summary,
		"holdings": holdings,
	}

	writeJSON(w, resp)
}

// pretty sure this is duplicate - maybe something to fix later?
func getTeamInfo(teamID sql.NullInt64) TeamInfo {
	teamInfo := TeamInfo{}

	if !teamID.Valid {
		return teamInfo
	}
	var teamName string
	if err := db.QueryRow("SELECT name FROM teams WHERE id = ?", teamID.Int64).Scan(&teamName); err == nil {
		teamInfo.TeamID = &teamID.Int64
		teamInfo.TeamName = &teamName

		var memberCount int
		if err := db.QueryRow("SELECT COUNT(*) FROM users WHERE team_id = ?", teamID.Int64).Scan(&memberCount); err == nil {
			teamInfo.MemberCount = &memberCount
		}
		teamValue := calculateTeamValue(teamID.Int64)
		teamInfo.TeamValue = &teamValue
		teamRank := calculateTeamRank(teamID.Int64, teamValue)
		teamInfo.TeamRank = &teamRank
	}

	return teamInfo
}

func calculateTeamValue(teamID int64) float64 {
	rows, err := db.Query("SELECT id FROM users WHERE team_id = ?", teamID)
	if err != nil {
		return 0
	}
	defer rows.Close()

	var totalValue float64
	for rows.Next() {
		var userID int64
		if err := rows.Scan(&userID); err != nil {
			continue
		}
		var cash float64
		if err := db.QueryRow("SELECT cash FROM users WHERE id = ?", userID).Scan(&cash); err != nil {
			continue
		}
		portfolioValue := calculateUserPortfolioValue(userID)
		totalValue += cash + portfolioValue
	}

	return roundToTwo(totalValue)
}

func calculateTeamRank(teamID int64, teamValue float64) int {
	rows, err := db.Query("SELECT DISTINCT team_id FROM users WHERE team_id IS NOT NULL")
	if err != nil {
		return 0
	}
	defer rows.Close()

	rank := 1
	for rows.Next() {
		var otherTeamID int64
		if err := rows.Scan(&otherTeamID); err != nil {
			continue
		}

		if otherTeamID == teamID {
			continue
		}

		otherTeamValue := calculateTeamValue(otherTeamID)
		if otherTeamValue > teamValue {
			rank++
		}
	}

	return rank
}

func transactionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, err := parseUserIDFromRequest(r)
	if err != nil {
		http.Error(w, "unauthenticated", http.StatusUnauthorized)
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if li, err := strconv.Atoi(l); err == nil && li > 0 && li <= 1000 {
			limit = li
		}
	}

	rows, err := db.Query("SELECT id, timestamp, stock_id, action, shares, price FROM transactions WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?", userID, limit)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []TransactionOut{}
	for rows.Next() {
		var id int64
		var ts sql.NullString
		var stockID, action string
		var shares int64
		var price float64
		if err := rows.Scan(&id, &ts, &stockID, &action, &shares, &price); err != nil {
			http.Error(w, "db scan error", http.StatusInternalServerError)
			return
		}
		tstr := ""
		if ts.Valid {
			parsed := parseDBTimeToLocal(ts.String)
			tstr = parsed.Format("2006-01-02 15:04:05 MST")
		}
		out = append(out, TransactionOut{
			ID:        id,
			Timestamp: tstr,
			StockID:   stockID,
			Action:    strings.Title(action),
			Shares:    shares,
			Price:     roundToTwo(price),
			Total:     roundToTwo(float64(shares) * price),
		})
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "db rows error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, out)
}

func getPreviousClose(stockID string) (float64, error) {
	// get local start of day
	nowLocal := time.Now().Local()
	startOfDayLocal := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, nowLocal.Location())

	rows, err := db.Query("SELECT close, time FROM price_history WHERE stock_id = ? AND time < ? ORDER BY time DESC LIMIT 1", stockID, startOfDayLocal.Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	if rows.Next() {
		var close sql.NullFloat64
		var t sql.NullString
		if err := rows.Scan(&close, &t); err != nil {
			return 0, err
		}
		if close.Valid {
			return close.Float64, nil
		}
	}
	// fallback
	rows2, err := db.Query("SELECT close, time FROM price_history WHERE stock_id = ? ORDER BY time DESC LIMIT 1", stockID)
	if err != nil {
		return 0, err
	}
	defer rows2.Close()
	if rows2.Next() {
		var close sql.NullFloat64
		var t sql.NullString
		if err := rows2.Scan(&close, &t); err == nil && close.Valid {
			return close.Float64, nil
		}
	}

	return 0, fmt.Errorf("no previous close found")
}

func computeLeaderboardPosition(userID int64) (int, int) {
	rows, err := db.Query("SELECT id, cash FROM users")
	if err != nil {
		return 0, 0
	}
	defer rows.Close()

	type userNet struct {
		id  int64
		net float64
	}
	users := []userNet{}
	for rows.Next() {
		var id int64
		var cash float64
		if err := rows.Scan(&id, &cash); err != nil {
			continue
		}
		hrows, err := db.Query("SELECT stock_id, shares FROM portfolio WHERE user_id = ?", id)
		if err != nil {
			continue
		}
		total := cash
		for hrows.Next() {
			var sid string
			var shares int64
			if err := hrows.Scan(&sid, &shares); err != nil {
				continue
			}
			price, perr := getStockPrice(sid)
			if perr != nil {
				price = 0
			}
			total += float64(shares) * price
		}
		hrows.Close()
		users = append(users, userNet{id: id, net: total})
	}
	if len(users) == 0 {
		return 0, 0
	}

	sort.Slice(users, func(i, j int) bool { return users[i].net > users[j].net })

	rank := 0
	for i, u := range users {
		if u.id == userID {
			rank = i + 1
			break
		}
	}
	return rank, len(users)
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}
func parseDBTimeToLocal(src string) time.Time {
	// try 'RFC3339'
	if t, err := time.Parse(time.RFC3339, src); err == nil {
		return t.Local()
	}
	// try sqlite default
	layout := "2006-01-02 15:04:05"
	if t, err := time.ParseInLocation(layout, src, time.UTC); err == nil {
		return t.Local()
	}
	// try without timezone in local zone
	if t, err := time.ParseInLocation(layout, src, time.Local); err == nil {
		return t
	}
	// fallback to now
	return time.Now()
}

// some basic math helpers
func roundToTwo(f float64) float64 {
	return mathRound(f*100.0) / 100.0
}

func mathRound(f float64) float64 {
	if f < 0 {
		return float64(int64(f - 0.5))
	}
	return float64(int64(f + 0.5))
}
