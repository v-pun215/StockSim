package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// this loads the config.json file, currently it has only start and end time for comp
func loadConfig() {
	file, err := os.ReadFile("data/config.json")
	if err != nil {
		log.Fatalf("Failed to read config.json: %v", err)
	}

	var cfg Config
	if err := json.Unmarshal(file, &cfg); err != nil {
		log.Fatalf("Failed to parse config.json: %v", err)
	}

	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		loc = time.FixedZone("IST", 5*3600+30*60)
	}

	parseTime := func(value string) (time.Time, error) {
		v := strings.TrimSpace(value)
		if v == "" {
			return time.Time{}, fmt.Errorf("empty time value")
		}

		layouts := []string{
			"01/02/06 15:04",
			"01/02/2006 15:04",
			"2006-01-02 15:04",
			"2006-01-02T15:04:05",
			"2006-01-02T15:04:05Z07:00",
			time.RFC3339,
		}
		// interesting sometimes its failing, adding fallbacks..
		for _, layout := range layouts {
			if t, err := time.ParseInLocation(layout, v, loc); err == nil {
				return t, nil
			}
		}
		if t, err := time.Parse(time.RFC3339, v); err == nil {

			return t.In(loc), nil
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

// loads list of stocks
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

// api endpoint for competition status
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
