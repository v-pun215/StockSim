package main

import (
	"encoding/json"
	"log"
	"math"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// haha makes me think of minecraft ticks, so named it Tick ig idk i think thats what its supposed to be named
type Tick struct {
	Time   time.Time
	Open   float64
	High   float64
	Low    float64
	Close  float64
	Volume int64
}

type RawTickEvent struct {
	Price  float64
	Time   time.Time
	Volume int64
}

var (
	tickLock          sync.Mutex
	tickBuffer              = map[string][]Tick{}
	maxTicksPerStock        = 10000
	currentMinuteData       = map[string]*Tick{}
	lastMinuteKey     int64 = 0

	rawTickHistory = map[string][]RawTickEvent{}
)

var (
	upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	clients     = make(map[*websocket.Conn]bool)
	clientsLock sync.Mutex
	writeWait   = 5 * time.Second
	pingPeriod  = 25 * time.Second
	pongWait    = 60 * time.Second
)

// api endpoint that returns all stocks in json
func stocksHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	stocksLock.Lock()
	defer stocksLock.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stocks)
}

func init() {
	// go extension in vs code doesnt liek this code ig
	rand.Seed(time.Now().UnixNano())
}

func initTicks() {
	tickLock.Lock()
	defer tickLock.Unlock()

	points := 200
	now := time.Now().Local()

	stocksLock.Lock()
	snapshot := make([]Stock, len(stocks))
	copy(snapshot, stocks)
	stocksLock.Unlock()

	for _, s := range snapshot {
		p := s.Price
		buf := make([]Tick, 0, points)
		start := now.Add(-time.Duration(points-1) * time.Minute)
		for i := 0; i < points; i++ {
			t := start.Add(time.Duration(i) * time.Minute)
			change := (rand.Float64() - 0.5) * 0.002
			open := p
			close := p * (1 + change)
			high := math.Max(open, close) * (1 + rand.Float64()*0.001)
			low := math.Min(open, close) * (1 - rand.Float64()*0.001)
			vol := int64(100 + rand.Intn(900))
			buf = append(buf, Tick{
				Time:   t,
				Open:   open,
				High:   high,
				Low:    low,
				Close:  close,
				Volume: vol,
			})
			p = close
		}
		tickBuffer[strings.ToUpper(strings.TrimSpace(s.ID))] = buf

		rh := make([]RawTickEvent, 0, len(buf))
		for _, b := range buf {
			rh = append(rh, RawTickEvent{Price: b.Close, Time: b.Time, Volume: b.Volume})
		}
		rawTickHistory[strings.ToUpper(strings.TrimSpace(s.ID))] = rh
	}
	lastMinuteKey = now.Unix() / 60
}

func appendTick(stockID string, price float64, vol int64) {
	stockID = strings.ToUpper(strings.TrimSpace(stockID))
	now := time.Now().Local()
	minKey := now.Unix() / 60

	tickLock.Lock()
	defer tickLock.Unlock()

	if lastMinuteKey != 0 && minKey > lastMinuteKey {
		finalizeCompMinutes(minKey) // lots of weird bugs, had to write this function
		lastMinuteKey = minKey
	}

	buf := tickBuffer[stockID]
	if len(buf) > 0 {
		last := &buf[len(buf)-1]
		lastMin := last.Time.Unix() / 60
		if lastMin == minKey {
			if price > last.High {
				last.High = price
			}
			if price < last.Low {
				last.Low = price
			}
			last.Close = price
			last.Volume += vol

			currentMinuteData[stockID] = &Tick{
				Time:   now,
				Open:   last.Open,
				High:   last.High,
				Low:    last.Low,
				Close:  price,
				Volume: last.Volume,
			}
			rh := rawTickHistory[stockID]
			rh = append(rh, RawTickEvent{Price: price, Time: now, Volume: vol})
			if len(rh) > maxTicksPerStock {
				start := len(rh) - maxTicksPerStock
				rh = rh[start:]
			}
			rawTickHistory[stockID] = rh

			return
		}
	}
	newBar := Tick{
		Time:   now,
		Open:   price,
		High:   price,
		Low:    price,
		Close:  price,
		Volume: vol,
	}

	buf = append(buf, newBar)
	if len(buf) > maxTicksPerStock {
		start := len(buf) - maxTicksPerStock
		buf = buf[start:]
	}
	tickBuffer[stockID] = buf
	currentMinuteData[stockID] = &newBar

	rh := rawTickHistory[stockID]
	rh = append(rh, RawTickEvent{Price: price, Time: now, Volume: vol})
	if len(rh) > maxTicksPerStock {
		start := len(rh) - maxTicksPerStock
		rh = rh[start:]
	}
	rawTickHistory[stockID] = rh

	if lastMinuteKey == 0 {
		lastMinuteKey = minKey
	}
}

func finalizeCompMinutes(currentMinKey int64) {
	for stockID, tick := range currentMinuteData {
		tickMinKey := tick.Time.Unix() / 60
		if tickMinKey < currentMinKey {
			delete(currentMinuteData, stockID)
		}
	}
}

func writeJSONToConn(conn *websocket.Conn, payload interface{}) error {
	conn.SetWriteDeadline(time.Now().Add(writeWait))
	return conn.WriteJSON(payload)
}

func pricesWSHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}

	clientsLock.Lock()
	clients[conn] = true
	clientsLock.Unlock()

	stocksLock.Lock()
	initial := make([]Stock, len(stocks))
	copy(initial, stocks)
	stocksLock.Unlock()

	_ = writeJSONToConn(conn, map[string]interface{}{
		"stocks": initial,
		"time":   time.Now().Local().Format(time.RFC3339),
	})
	conn.SetReadLimit(1024)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	stopPing := make(chan struct{})
	go func() {
		t := time.NewTicker(pingPeriod)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				conn.SetWriteDeadline(time.Now().Add(writeWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					// remove on error
					clientsLock.Lock()
					if _, ok := clients[conn]; ok {
						delete(clients, conn)
					}
					clientsLock.Unlock()
					conn.Close()
					return
				}
			case <-stopPing:
				return
			}
		}
	}()
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			clientsLock.Lock()
			if _, ok := clients[conn]; ok {
				delete(clients, conn)
			}
			clientsLock.Unlock()
			close(stopPing)
			conn.Close()
			return
		}
	}
}
func priceTicker() {
	log.Println("priceTicker.")
	tickInterval := 3 * time.Second

	// seed PRNG once
	rand.Seed(time.Now().UnixNano())

	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now().UTC()

		stocksLock.Lock()
		for i := range stocks {
			id := stocks[i].ID
			oldPrice := stocks[i].Price

			change := (rand.Float64() - 0.5) * 0.002
			newPrice := oldPrice * (1 + change)

			if newPrice < 0.01 {
				newPrice = 0.01
			}

			baseVol := int64(100 + rand.Intn(400)) // 100..499
			volMultiplier := 1.0 + math.Min(math.Abs(change)*120.0, 5.0)
			vol := int64(float64(baseVol) * volMultiplier)

			stocks[i].Change = newPrice - oldPrice
			stocks[i].Price = newPrice
			appendTick(id, newPrice, vol)
		}

		updated := make([]Stock, len(stocks))
		copy(updated, stocks)
		stocksLock.Unlock()

		broadcastPrices(updated)

		_ = now
	}
}

func broadcastPrices(data []Stock) {
	// broadcasts to websocket clients
	msg, err := json.Marshal(map[string]interface{}{
		"stocks": data,
		"time":   time.Now().Local().Format(time.RFC3339),
	})
	if err != nil {
		log.Println("broadcast marshal error:", err)
		return
	}
	clientsLock.Lock()
	conns := make([]*websocket.Conn, 0, len(clients))
	for c := range clients {
		conns = append(conns, c)
	}
	clientsLock.Unlock()

	for _, c := range conns {
		c.SetWriteDeadline(time.Now().Add(writeWait))
		if err := c.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Println("WebSocket write error, removing client:", err)
			// cleanup
			clientsLock.Lock()
			if _, ok := clients[c]; ok {
				delete(clients, c)
			}
			clientsLock.Unlock()
			_ = c.Close()
		}
	}
}

func historyHandler(w http.ResponseWriter, r *http.Request) {
	// basically, because when the server starts there is no data, i wrote this to make some data so that the client charts have something to display.
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
	points := 200
	if pstr := r.URL.Query().Get("points"); pstr != "" {
		if p, err := strconv.Atoi(pstr); err == nil && p > 0 {
			points = p
		}
	}
	if points > maxTicksPerStock {
		points = maxTicksPerStock
	}

	tickLock.Lock()
	buf, ok := tickBuffer[stock]
	cpy := make([]Tick, len(buf))
	copy(cpy, buf)
	rawCopy := make([]RawTickEvent, 0)
	if rh, has := rawTickHistory[stock]; has && len(rh) > 0 {
		rawCopy = make([]RawTickEvent, len(rh))
		copy(rawCopy, rh)
	}
	if currentTick, hasCurrentData := currentMinuteData[stock]; hasCurrentData {
		currentMinKey := currentTick.Time.Unix() / 60
		needsCurrentMinute := true
		if len(cpy) > 0 {
			lastCompleteMinKey := cpy[len(cpy)-1].Time.Unix() / 60
			if currentMinKey == lastCompleteMinKey {
				cpy[len(cpy)-1] = *currentTick
				needsCurrentMinute = false
			}
		}

		if needsCurrentMinute {
			cpy = append(cpy, *currentTick)
		}
	}
	tickLock.Unlock()
	if len(rawCopy) > 0 {
		start := 0
		if len(rawCopy) > points {
			start = len(rawCopy) - points
		}
		out := make([]map[string]interface{}, 0, len(rawCopy[start:]))
		for _, e := range rawCopy[start:] {
			p := roundToFour(e.Price)
			out = append(out, map[string]interface{}{
				"time":   e.Time.Format(time.RFC3339),
				"open":   p,
				"high":   p,
				"low":    p,
				"close":  p,
				"volume": e.Volume,
				"price":  p, // old key
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
		return
	}
	if !ok || len(cpy) == 0 {
		stocksLock.Lock()
		var curPrice float64 = 100.0
		for _, s := range stocks {
			if strings.ToUpper(strings.TrimSpace(s.ID)) == stock {
				curPrice = s.Price
				break
			}
		}
		stocksLock.Unlock()

		now := time.Now().Local()
		out := make([]map[string]interface{}, 0, points)
		p := curPrice
		// oldest to newest
		start := now.Add(-time.Duration(points-1) * time.Minute)
		for i := 0; i < points; i++ {
			t := start.Add(time.Duration(i) * time.Minute)
			// small random changes
			change := (rand.Float64() - 0.5) * 0.002
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
		_ = json.NewEncoder(w).Encode(out)
		return
	}

	// OHLC finally works!
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
				Open:   t.Open,
				High:   t.High,
				Low:    t.Low,
				Close:  t.Close,
				Volume: t.Volume,
				set:    true,
			}
		} else {
			if t.High > b.High {
				b.High = t.High
			}
			if t.Low < b.Low {
				b.Low = t.Low
			}
			b.Close = t.Close
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
		stocksLock.Lock()
		for _, s := range stocks {
			if strings.ToUpper(strings.TrimSpace(s.ID)) == stock {
				lastClose = s.Price
				break
			}
		}
		stocksLock.Unlock()
		if lastClose == 0 {
			lastClose = 100.0
		}
	}

	// iterate through minute-range oldest to newest and output either bucket or fill empty minutes with lastClos
	for m := startMinute; m <= endMinute; m++ {
		if b, exists := buckets[m]; exists && b.set {
			t := time.Unix(m*60, 0).Local()
			out = append(out, map[string]interface{}{
				"time":   t.Format(time.RFC3339),
				"open":   roundToFour(b.Open),
				"high":   roundToFour(b.High),
				"low":    roundToFour(b.Low),
				"close":  roundToFour(b.Close),
				"volume": b.Volume,
			})
			lastClose = b.Close
		} else {
			t := time.Unix(m*60, 0).Local()
			out = append(out, map[string]interface{}{
				"time":   t.Format(time.RFC3339),
				"open":   roundToFour(lastClose),
				"high":   roundToFour(lastClose),
				"low":    roundToFour(lastClose),
				"close":  roundToFour(lastClose),
				"volume": 0,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

func roundToFour(f float64) float64 {
	return math.Round((f+1e-9)*10000) / 10000
}
