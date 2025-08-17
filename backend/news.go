package main

import (
	"database/sql"
	"encoding/json"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// /api/news output
type NewsOut struct {
	ID             int64   `json:"id"`
	Title          string  `json:"title"`
	Content        string  `json:"content"`
	AffectedStock  string  `json:"affected_stock,omitempty"`
	AffectedSector string  `json:"affected_sector,omitempty"`
	Category       string  `json:"category,omitempty"`
	Source         string  `json:"source,omitempty"`
	Impact         float64 `json:"impact"`
	PublishedAt    string  `json:"published_at"`
}

// loads from /data/newswebsites.json
func loadNewsSources() map[string]bool {
	allowed := map[string]bool{}
	paths := []string{"data/newswebsites.json"}
	var data []byte
	var err error
	for _, p := range paths {
		data, err = os.ReadFile(p)
		if err == nil {
			break
		}
	}
	if err == nil {
		var arr []struct {
			Name string `json:"name"`
		}
		if jerr := json.Unmarshal(data, &arr); jerr == nil {
			for _, it := range arr {
				n := strings.TrimSpace(it.Name)
				if n != "" {
					allowed[strings.ToLower(n)] = true
				}
			}
		}
	}
	return allowed
}

func newsSourcesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	allowedSources := loadNewsSources()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(allowedSources)
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
	rows, err := db.Query("SELECT id, title, content, affected_stock, affected_sector, category, source, impact, published_at FROM news ORDER BY published_at DESC LIMIT ?", limit)
	if err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []NewsOut{}
	for rows.Next() {
		var n NewsOut
		var affectedStock sql.NullString
		var affectedSector sql.NullString
		var category sql.NullString
		var source sql.NullString
		var pub sql.NullString
		if err := rows.Scan(&n.ID, &n.Title, &n.Content, &affectedStock, &affectedSector, &category, &source, &n.Impact, &pub); err != nil {
			http.Error(w, "db scan error", http.StatusInternalServerError)
			return
		}
		if affectedStock.Valid {
			n.AffectedStock = affectedStock.String
		}
		if affectedSector.Valid {
			n.AffectedSector = affectedSector.String
		}
		if category.Valid {
			n.Category = category.String
		}
		if source.Valid {
			n.Source = source.String
		}
		if pub.Valid {
			n.PublishedAt = pub.String
		}
		out = append(out, n)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// admin action, publish new news.
func publishNewsHandler(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		Title          string  `json:"title"`
		Content        string  `json:"content"`
		AffectedStock  string  `json:"affected_stock,omitempty"`
		AffectedSector string  `json:"affected_sector,omitempty"`
		Impact         float64 `json:"impact"`
		Source         string  `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)
	req.AffectedStock = strings.TrimSpace(req.AffectedStock)
	req.AffectedSector = strings.TrimSpace(req.AffectedSector)
	req.Source = strings.TrimSpace(req.Source)

	if req.Source == "" {
		http.Error(w, "source required", http.StatusBadRequest)
		return
	}
	allowedSources := loadNewsSources()
	if !allowedSources[strings.ToLower(req.Source)] {
		http.Error(w, "invalid source", http.StatusBadRequest)
		return
	}

	if req.AffectedStock != "" && req.AffectedSector != "" {
		http.Error(w, "provide either affected_stock OR affected_sector, not both", http.StatusBadRequest)
		return
	}
	// to prevent lots of bugs in my code that arise if more than 0.4 on both ends
	impact := req.Impact
	if impact > 0.4 {
		impact = 0.4
	}
	if impact < -0.4 {
		impact = -0.4
	}

	category := ""
	if req.AffectedStock != "" {
		found := false
		stocksLock.Lock()
		for i := range stocks {
			if stocks[i].ID == req.AffectedStock {
				category = strings.TrimSpace(stocks[i].Sector)
				found = true
				break
			}
		}
		stocksLock.Unlock()
		if !found {
			http.Error(w, "affected stock not found", http.StatusBadRequest)
			return
		}
	} else if req.AffectedSector != "" {
		category = req.AffectedSector
	}

	var dbAffectedStock interface{} = nil
	var dbAffectedSector interface{} = nil
	var dbCategory interface{} = nil
	if req.AffectedStock != "" {
		dbAffectedStock = req.AffectedStock
	}
	if req.AffectedSector != "" {
		dbAffectedSector = req.AffectedSector
	}
	if category != "" {
		dbCategory = category
	}

	_, err := db.Exec(
		"INSERT INTO news (title, content, affected_stock, affected_sector, category, source, impact, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
		req.Title, req.Content, dbAffectedStock, dbAffectedSector, dbCategory, req.Source, impact,
	)
	if err != nil {
		http.Error(w, "db insert error", http.StatusInternalServerError)
		return
	}
	if (req.AffectedStock == "" && req.AffectedSector == "") || impact == 0 {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	}

	var ids []string
	var bases []float64

	stocksLock.Lock()
	if req.AffectedStock != "" {
		for i := range stocks {
			if stocks[i].ID == req.AffectedStock {
				ids = append(ids, stocks[i].ID)
				bases = append(bases, stocks[i].Price)
				break
			}
		}
	} else if req.AffectedSector != "" {
		target := strings.ToLower(req.AffectedSector)
		for i := range stocks {
			if strings.ToLower(strings.TrimSpace(stocks[i].Sector)) == target {
				ids = append(ids, stocks[i].ID)
				bases = append(bases, stocks[i].Price)
			}
		}
	}
	stocksLock.Unlock()

	if len(ids) == 0 {
		http.Error(w, "no affected stocks found", http.StatusBadRequest)
		return
	}

	// give up the glory of changing actual stock data to another function T-T
	go changeStock(ids, bases, impact)

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// very very gradual yet semi-realistic change to stock
func changeStock(ids []string, bases []float64, impact float64) {
	if len(ids) == 0 || len(ids) != len(bases) {
		return
	}

	// as said in before comment T-T
	if impact > 4.0 {
		impact = 4.0
	} else if impact < -4.0 {
		impact = -4.0
	}

	targetMultiplier := 1.0 + impact
	if targetMultiplier <= 0.0001 {
		targetMultiplier = 0.0001
	}
	// keep it smooth
	steps := int(40 + math.Round(math.Abs(impact)*160))
	if steps < 30 {
		steps = 30
	}
	if steps > 900 {
		steps = 900
	}

	randNorm := func() float64 {
		u1 := rand.Float64()
		u2 := rand.Float64()
		if u1 < 1e-12 {
			u1 = 1e-12
		}
		return math.Sqrt(-2.0*math.Log(u1)) * math.Cos(2.0*math.Pi*u2)
	}
	easeInOut := func(x float64) float64 {
		return 0.5 - 0.5*math.Cos(math.Pi*x)
	}
	n := len(ids)
	current := make([]float64, n)
	for i := 0; i < n; i++ {
		current[i] = bases[i]
		if current[i] <= 0 {
			current[i] = 0.01
		}
	}

	lastAppend := time.Now().Add(-2 * time.Minute)

	for step := 1; step <= steps; step++ {
		frac := float64(step) / float64(steps)
		targetFrac := easeInOut(frac)

		for ti := 0; ti < n; ti++ {
			base := bases[ti]
			ideal := base * math.Pow(targetMultiplier, targetFrac)

			moveFactor := 0.08 + 0.55*math.Pow(frac, 1.1)
			noiseScale := 0.0006 + 0.006*math.Abs(impact)
			noise := randNorm() * noiseScale * base

			nextPrice := current[ti] + (ideal-current[ti])*moveFactor + noise

			microSteps := 1 + rand.Intn(3)
			for m := 0; m < microSteps; m++ {
				jitter := randNorm() * 0.00035 * base
				stepPrice := nextPrice + jitter

				maxAllowed := base * targetMultiplier * 1.06
				minAllowed := base * targetMultiplier * 0.94
				if impact >= 0 && stepPrice > maxAllowed {
					stepPrice = maxAllowed
				}
				if impact < 0 && stepPrice < minAllowed {
					stepPrice = minAllowed
				}
				if stepPrice < 0.01 {
					stepPrice = 0.01
				}

				stocksLock.Lock()
				for i := range stocks {
					if stocks[i].ID != ids[ti] {
						continue
					}
					prev := stocks[i].Price
					stocks[i].Price = stepPrice
					stocks[i].Change = stepPrice - prev
				}
				updated := make([]Stock, len(stocks))
				copy(updated, stocks)
				stocksLock.Unlock()
				// broadcast it for the world to fear
				broadcastPrices(updated)

				shouldAppend := false
				if time.Since(lastAppend) > 1200*time.Millisecond {
					shouldAppend = true
				} else if m == microSteps-1 && (math.Abs(stepPrice-current[ti]) > base*0.002) {
					shouldAppend = true
				}

				if shouldAppend {
					vol := int64(400 + rand.Intn(3000) + int(math.Round(700.0*math.Abs(impact))))
					appendTick(ids[ti], stepPrice, vol)
					lastAppend = time.Now()
				}

				current[ti] = stepPrice

				sleepMs := 120 + rand.Intn(520)
				time.Sleep(time.Duration(sleepMs) * time.Millisecond)
			}
		}

		// stack overflow or smth idk but this makes it feel a lot more realistic
		plateauProb := 0.08 + 0.12*(1.0-frac)
		if rand.Float64() < plateauProb {
			time.Sleep(time.Duration(400+rand.Intn(1400)) * time.Millisecond)
		}
	}
	for ti := 0; ti < n; ti++ {
		finalPrice := bases[ti] * targetMultiplier
		if finalPrice < 0.01 {
			finalPrice = 0.01
		}
		stocksLock.Lock()
		for i := range stocks {
			if stocks[i].ID != ids[ti] {
				continue
			}
			prev := stocks[i].Price
			stocks[i].Price = finalPrice
			stocks[i].Change = finalPrice - prev
			vol := int64(1200 + rand.Intn(5200))
			appendTick(stocks[i].ID, finalPrice, vol)
		}
		updated := make([]Stock, len(stocks))
		copy(updated, stocks)
		stocksLock.Unlock()
		broadcastPrices(updated)
		// this makes it unusually fast and its fine for now
		time.Sleep(90 * time.Millisecond)
	}
}
