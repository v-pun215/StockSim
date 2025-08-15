package main

import (
	"database/sql"
	"encoding/json"
	"math"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Tick struct {
	Time   time.Time
	Price  float64
	Volume int64
}

var (
	tickLock         sync.Mutex
	tickBuffer       = map[string][]Tick{} // stockID -> ticks (most recent appended)
	maxTicksPerStock = 10000               // keep last 10000 ticks per stock (large cap)
)

func initTicks() {
	tickLock.Lock()
	defer tickLock.Unlock()

	points := 200 // initial bars to seed
	now := time.Now().Local()

	for _, s := range stocks {
		p := s.Price
		buf := make([]Tick, 0, points)
		// oldest time = now - (points-1) minutes
		start := now.Add(-time.Duration(points-1) * time.Minute)
		for i := 0; i < points; i++ {
			t := start.Add(time.Duration(i) * time.Minute)
			// small random walk (+/-0.1% per seed step)
			change := (rand.Float64() - 0.5) * 0.002
			p = p * (1 + change)
			vol := int64(100 + rand.Intn(900))
			buf = append(buf, Tick{Time: t, Price: p, Volume: vol})
		}
		tickBuffer[s.ID] = buf
	}
}

func appendTick(stockID string, price float64, vol int64) {
	tickLock.Lock()
	defer tickLock.Unlock()
	buf := tickBuffer[stockID]
	buf = append(buf, Tick{Time: time.Now().Local(), Price: price, Volume: vol})
	if len(buf) > maxTicksPerStock {
		start := len(buf) - maxTicksPerStock
		buf = buf[start:]
	}
	tickBuffer[stockID] = buf
}
func historyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	stock := r.URL.Query().Get("stock")
	if stock == "" {
		http.Error(w, "missing stock", http.StatusBadRequest)
		return
	}
	stock = strings.ToUpper(strings.TrimSpace(stock))

	// points default to 200 and cannot exceed maxTicksPerStock
	points := 200
	if pstr := r.URL.Query().Get("points"); pstr != "" {
		if p, err := strconv.Atoi(pstr); err == nil && p > 0 {
			points = p
		}
	}
	if points > maxTicksPerStock {
		points = maxTicksPerStock
	}

	// snapshot ticks for this stock (use local times in tick buffer)
	tickLock.Lock()
	buf, ok := tickBuffer[stock]
	cpy := make([]Tick, len(buf))
	copy(cpy, buf)
	tickLock.Unlock()

	// fallback: synthesize 'points' bars stepping backwards 1 minute, using local time
	if !ok || len(cpy) == 0 {
		stocksLock.Lock()
		var curPrice float64 = 100.0
		for _, s := range stocks {
			if s.ID == stock {
				curPrice = s.Price
				break
			}
		}
		stocksLock.Unlock()

		now := time.Now().Local()
		out := make([]map[string]interface{}, 0, points)
		p := curPrice
		// build oldest -> newest
		start := now.Add(-time.Duration(points-1) * time.Minute)
		for i := 0; i < points; i++ {
			t := start.Add(time.Duration(i) * time.Minute)
			// small random walk (gentle)
			change := (rand.Float64() - 0.5) * 0.002 // ±0.1%
			open := p
			close := p * (1 + change)
			high := math.Max(open, close) * (1 + rand.Float64()*0.001)
			low := math.Min(open, close) * (1 - rand.Float64()*0.001)
			vol := int64(100 + rand.Intn(900))
			out = append(out, map[string]interface{}{
				"time":   t.Format(time.RFC3339),
				"open":   open,
				"high":   high,
				"low":    low,
				"close":  close,
				"volume": vol,
			})
			p = close
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out)
		return
	}

	type bucket struct {
		Open   float64
		High   float64
		Low    float64
		Close  float64
		Volume int64
		set    bool
	}
	buckets := make(map[int64]*bucket)

	for _, t := range cpy {
		minKey := t.Time.Unix() / 60
		b, exists := buckets[minKey]
		if !exists {
			buckets[minKey] = &bucket{
				Open:   t.Price,
				High:   t.Price,
				Low:    t.Price,
				Close:  t.Price,
				Volume: t.Volume,
				set:    true,
			}
		} else {
			if t.Price > b.High {
				b.High = t.Price
			}
			if t.Price < b.Low {
				b.Low = t.Price
			}
			b.Close = t.Price
			b.Volume += t.Volume
		}
	}

	endMinute := time.Now().Local().Unix() / 60
	startMinute := endMinute - int64(points-1)

	out := make([]map[string]interface{}, 0, points)
	var lastClose float64
	if b, ok := buckets[endMinute]; ok && b.set {
		lastClose = b.Close
	} else {
		// try find current price from stocks slice
		stocksLock.Lock()
		for _, s := range stocks {
			if s.ID == stock {
				lastClose = s.Price
				break
			}
		}
		stocksLock.Unlock()
		if lastClose == 0 {
			lastClose = 100.0
		}
	}

	for m := startMinute; m <= endMinute; m++ {
		if b, exists := buckets[m]; exists && b.set {
			t := time.Unix(m*60, 0).Local() // minute-aligned local time
			out = append(out, map[string]interface{}{
				"time":   t.Format(time.RFC3339),
				"open":   b.Open,
				"high":   b.High,
				"low":    b.Low,
				"close":  b.Close,
				"volume": b.Volume,
			})
			lastClose = b.Close
		} else {
			t := time.Unix(m*60, 0).Local()
			out = append(out, map[string]interface{}{
				"time":   t.Format(time.RFC3339),
				"open":   lastClose,
				"high":   lastClose,
				"low":    lastClose,
				"close":  lastClose,
				"volume": 0,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func getNewsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if li, err := strconv.Atoi(l); err == nil && li > 0 {
			limit = li
		}
	}

	rows, err := db.Query("SELECT id, title, content, affected_stock, impact, published_at FROM news ORDER BY published_at DESC LIMIT ?", limit)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type NewsOut struct {
		ID            int64   `json:"id"`
		Title         string  `json:"title"`
		Content       string  `json:"content"`
		AffectedStock string  `json:"affected_stock"`
		Impact        float64 `json:"impact"`
		PublishedAt   string  `json:"published_at"`
	}
	res := []NewsOut{}
	for rows.Next() {
		var n NewsOut
		var pub sql.NullString
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &n.AffectedStock, &n.Impact, &pub); err != nil {
			http.Error(w, "db scan error", http.StatusInternalServerError)
			return
		}
		if pub.Valid {
			n.PublishedAt = pub.String
		}
		res = append(res, n)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func publishNewsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	// admin guard
	if secret := os.Getenv("ADMIN_SECRET"); secret != "" {
		if r.Header.Get("X-Admin-Secret") != secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}

	var req struct {
		Title         string  `json:"title"`
		Content       string  `json:"content"`
		AffectedStock string  `json:"affected_stock"`
		Impact        float64 `json:"impact"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	// insert into news table
	_, err := db.Exec("INSERT INTO news (title, content, affected_stock, impact, published_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)", req.Title, req.Content, req.AffectedStock, req.Impact)
	if err != nil {
		http.Error(w, "db insert error", http.StatusInternalServerError)
		return
	}
	// work in progress, does not work very well.
	if req.AffectedStock != "" && req.Impact != 0 {
		stocksLock.Lock()
		for i := range stocks {
			if stocks[i].ID == req.AffectedStock {
				old := stocks[i].Price
				// cap impact between -0.9 and +2.0 (i.e., -90% to +200%)
				impact := req.Impact
				if impact < -0.9 {
					impact = -0.9
				}
				if impact > 2.0 {
					impact = 2.0
				}
				newPrice := old * (1 + impact)
				stocks[i].Change = newPrice - old
				stocks[i].Price = newPrice
				// append tick for history
				vol := int64(500 + rand.Intn(2000))
				appendTick(stocks[i].ID, newPrice, vol)
				break
			}
		}
		stocksLock.Unlock()
	}

	stocksLock.Lock()
	updated := make([]Stock, len(stocks))
	copy(updated, stocks)
	stocksLock.Unlock()
	broadcastPrices(updated)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// tank or uplift
func adminStockActionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	// admin guard
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
		req.Magnitude = 0.5 // default 50%
	}

	stocksLock.Lock()
	defer stocksLock.Unlock()
	for i := range stocks {
		if stocks[i].ID == req.StockID {
			old := stocks[i].Price
			var newPrice float64
			if req.Action == "tank" {
				// reduce by magnitude fraction: price *= (1 - magnitude)
				newPrice = old * (1 - req.Magnitude)
				if newPrice < 0.01 {
					newPrice = 0.01
				}
			} else {
				// spike: price *= (1 + magnitude)
				newPrice = old * (1 + req.Magnitude)
			}
			stocks[i].Change = newPrice - old
			stocks[i].Price = newPrice
			// record admin action in DB (if table exists)
			_, _ = db.Exec("INSERT INTO admin_actions (stock_id, action, magnitude, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)", req.StockID, req.Action, req.Magnitude)
			// append tick for history
			vol := int64(1000 + rand.Intn(5000))
			appendTick(stocks[i].ID, newPrice, vol)
			// broadcast new prices
			updated := make([]Stock, len(stocks))
			copy(updated, stocks)
			go broadcastPrices(updated)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "stock_id": req.StockID, "old": old, "new": newPrice})
			return
		}
	}
	http.Error(w, "stock not found", http.StatusBadRequest)
}

// leaderboard
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

	rows, err := db.Query("SELECT id, school_code, cash FROM users")
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type Entry struct {
		UserID   int64   `json:"user_id"`
		Username string  `json:"username"`
		Cash     float64 `json:"cash"`
		Holdings float64 `json:"holdings"`
		Networth float64 `json:"networth"`
	}
	entries := []Entry{}
	for rows.Next() {
		var id int64
		var username string
		var cash float64
		if err := rows.Scan(&id, &username, &cash); err != nil {
			http.Error(w, "db scan error", http.StatusInternalServerError)
			return
		}
		// sum holdings
		hrows, err := db.Query("SELECT stock_id, shares FROM portfolio WHERE user_id = ?", id)
		if err != nil {
			http.Error(w, "db error", http.StatusInternalServerError)
			return
		}
		var holdingsValue float64
		for hrows.Next() {
			var sid string
			var shares int64
			if err := hrows.Scan(&sid, &shares); err != nil {
				hrows.Close()
				http.Error(w, "db scan error", http.StatusInternalServerError)
				return
			}
			price, perr := getStockPrice(sid)
			if perr != nil {
				price = 0
			}
			holdingsValue += float64(shares) * price
		}
		hrows.Close()
		net := cash + holdingsValue
		entries = append(entries, Entry{UserID: id, Username: username, Cash: cash, Holdings: holdingsValue, Networth: net})
	}

	// sort desc by networth
	sort.Slice(entries, func(i, j int) bool { return entries[i].Networth > entries[j].Networth })

	if len(entries) > limit {
		entries = entries[:limit]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}
