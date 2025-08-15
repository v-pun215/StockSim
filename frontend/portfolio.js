(() => {
  const API_PORTFOLIO = '/api/portfolio';
  const API_TRANSACTIONS = '/api/transactions?limit=50';
  const WS_PRICES = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/prices';

  const currentCashEl = document.getElementById('current-cash');
  const currentNetworthEl = document.getElementById('current-networth');
  const totalGainEl = document.getElementById('total-gain');
  const totalPercentChangeEl = document.getElementById('total-percent-change');
  const portfolioDivEl = document.getElementById('portfolio-div');
  const leaderboardPositionEl = document.getElementById('leaderboard-position');
  const ownedStocksTable = document.getElementById('ownedStocksTable');

  let holdings = []; // array of objects matching Holding in backend
  let summary = null;
  let stocksIndex = {};
  let socket = null;
  let reconnectTimer = null;

  function fmtMoney(n) {
    return '$' + Number(n || 0).toFixed(2);
  }
  function fmtPct(n) {
    const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
    return sign + Math.abs(Number(n || 0)).toFixed(2) + '%';
  }
  function safeNum(x) { return (typeof x === 'number' ? x : Number(x || 0)); }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function recomputeAndRenderSummary(resp) {
    summary = resp || summary;
    holdings = (resp && resp.holdings) ? resp.holdings : holdings;

    const cash = safeNum(resp?.cash ?? 0);
    const networth = safeNum(resp?.networth ?? 0);

    for (let h of holdings) {
      if (stocksIndex[h.StockID] !== undefined) {
        h.CurrentPrice = stocksIndex[h.StockID];
        h.Value = round2(h.CurrentPrice * safeNum(h.Shares));
      } else {
        // keep backend-provided current_price if ws not started yet
        h.CurrentPrice = safeNum(h.CurrentPrice);
        h.Value = round2(h.CurrentPrice * safeNum(h.Shares));
      }
    }

    // total gain = sum((currentPrice - avgPrice) * shares)
    let totalGain = 0;
    let totalCost = 0;
    for (let h of holdings) {
      const cost = safeNum(h.AvgPrice) * safeNum(h.Shares);
      const value = safeNum(h.CurrentPrice) * safeNum(h.Shares);
      totalGain += (value - cost);
      totalCost += cost;
    }
    const totalPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

    // update DOM
    if (currentCashEl) currentCashEl.textContent = fmtMoney(cash);
    if (currentNetworthEl) currentNetworthEl.textContent = fmtMoney(networth);
    if (totalGainEl) totalGainEl.textContent = (totalGain >= 0 ? '+' : '-') + fmtMoney(Math.abs(totalGain)).replace('$-', '$');
    if (totalPercentChangeEl) totalPercentChangeEl.textContent = (totalPct >= 0 ? '+' : '-') + Math.abs(totalPct).toFixed(2) + '%';
    if (portfolioDivEl) portfolioDivEl.textContent = `${holdings.length} unique stocks`;

    // render holdings table
    renderHoldingsTable();
  }

  function renderHoldingsTable() {
    if (!ownedStocksTable) return;
    const tbody = ownedStocksTable.querySelector('tbody');
    tbody.innerHTML = '';

    if (!holdings || holdings.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="8" class="text-center">No stocks owned.</td>';
      tbody.appendChild(tr);
      return;
    }

    for (let h of holdings) {
      const symbol = h.StockID;
      const shares = safeNum(h.Shares);
      const avg = round2(safeNum(h.AvgPrice));
      const cur = round2(safeNum(h.CurrentPrice));
      const value = round2(cur * shares);
      const totalGL = round2((cur - avg) * shares);
      const pctChange = avg > 0 ? ((cur - avg) / avg) * 100 : 0;

      let dailyGL = 0;
      if (h.DailyChange !== undefined) {
        dailyGL = round2(h.DailyChange * shares);
      } else if (stocksIndex[`__change__${symbol}`] !== undefined) {
        dailyGL = round2(stocksIndex[`__change__${symbol}`] * shares);
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(symbol)}</td>
        <td>${shares}</td>
        <td>${fmtMoney(avg)}</td>
        <td>${fmtMoney(cur)}</td>
        <td>${fmtMoney(value)}</td>
        <td class="${totalGL >= 0 ? 'pos' : 'neg'}">${totalGL >= 0 ? '+' : '-'}${fmtMoney(Math.abs(totalGL))}</td>
        <td class="${pctChange >= 0 ? 'pos' : 'neg'}">${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%</td>
        <td class="${dailyGL >= 0 ? 'pos' : 'neg'}">${dailyGL >= 0 ? '+' : '-'}${fmtMoney(Math.abs(dailyGL))}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // escape helper for safety
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
        "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
      }[c];
    });
  }

  // fetch portfolio for the logged-in user
  async function fetchPortfolioAndRender() {
    try {
      // get current user (cookie) to know user_id; fallback to no user
      const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!meRes.ok) {
        // not logged in — clear UI
        recomputeAndRenderSummary({ user_id: 0, cash: 0, holdings: [], networth: 0 });
        return;
      }
      const me = await meRes.json();
      const userId = me.user_id;

      const res = await fetch(`${API_PORTFOLIO}?user_id=${encodeURIComponent(userId)}`, { credentials: 'same-origin' });
      if (!res.ok) {
        console.error('portfolio fetch failed', res.status);
        return;
      }
      const data = await res.json();
      recomputeAndRenderSummary({
        user_id: data.user_id ?? userId,
        cash: data.cash ?? 0,
        holdings: (data.holdings || []).map(h => ({
          StockID: h.stock_id || h.StockID || h.Stock,
          Shares: h.shares || h.Shares || 0,
          AvgPrice: h.avg_price || h.AvgPrice || 0,
          CurrentPrice: h.current_price || h.CurrentPrice || h.current_price || 0,
          Value: h.value || h.Value || 0
        })),
        networth: data.networth ?? 0
      });
    } catch (err) {
      console.error('fetchPortfolioAndRender error', err);
    }
  }

  async function fetchTransactions(limit = 50) {
    try {
      const res = await fetch(`${API_TRANSACTIONS}&limit=${limit}`, { credentials: 'same-origin' });
      if (!res.ok) {
        // try alternate endpoint
        const alt = await fetch(`/api/transactionhistory?limit=${limit}`, { credentials: 'same-origin' });
        if (!alt.ok) return;
        return await alt.json();
      }
      return await res.json();
    } catch (err) {
      console.log(err);
      return null;
    }
  }

  function initWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) return;
    try {
      socket = new WebSocket(WS_PRICES);
    } catch (err) {
      console.error('WS init error', err);
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      console.log('WS connected');
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });

    socket.addEventListener('message', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        let stocksArr = null;
        if (Array.isArray(parsed)) {
          stocksArr = parsed;
        } else if (parsed.stocks && Array.isArray(parsed.stocks)) {
          stocksArr = parsed.stocks;
        } else if (parsed.type === 'prices' && parsed.data && parsed.data.stocks) {
          stocksArr = parsed.data.stocks;
        } else if (parsed.stocks) {
          stocksArr = parsed.stocks;
        }

        if (!stocksArr) return;
        for (let s of stocksArr) {
          const id = s.ID || s.id || s.stock_id || s.stockId || s.Stock || s.stock;
          const price = s.Price || s.price || s.PriceNow || s.price_now || s.p || s.price;
          const change = s.Change || s.change || 0;
          const key = String(id || s.id || s.stock_id || s.Stock || s.stock);
          if (key) {
            stocksIndex[key] = Number(price || s.Price || s.price || 0);
            // store change under a special key so holdings rows may use it for dailyGL if available
            stocksIndex[`__change__${key}`] = Number(change || 0);
          }
        }

        for (let h of holdings) {
          if (stocksIndex[h.StockID] !== undefined) {
            h.CurrentPrice = stocksIndex[h.StockID];
            h.Value = round2(h.CurrentPrice * safeNum(h.Shares));
          }
        }

        let holdingsVal = 0;
        for (let h of holdings) holdingsVal += safeNum(h.Value);
        // networth = cash + holdingsVal
        const cash = safeNum(summary?.cash || 0);
        const networth = round2(cash + holdingsVal);

        if (currentNetworthEl) currentNetworthEl.textContent = fmtMoney(networth);
        renderHoldingsTable();

      } catch (err) {
        console.error('WS message parse error', err);
      }
    });

    socket.addEventListener('close', (ev) => {
      console.warn('WS closed', ev.code, ev.reason);
      scheduleReconnect();
    });

    socket.addEventListener('error', (err) => {
      console.error('WS error', err);
      try { socket.close(); } catch (e) {}
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      initWebSocket();
    }, 2000 + Math.random() * 3000);
  }
  // 'boot'
  (async function boot() {
    await fetchPortfolioAndRender();

    try {
      const r = await fetch('/api/stocks');
      if (r.ok) {
        const arr = await r.json();
        for (let s of arr) {
          const id = s.ID || s.id || s.stock_id || s.Stock || s.stock;
          const price = s.Price || s.price || s.price_now || s.PriceNow;
          if (id !== undefined && price !== undefined) stocksIndex[String(id)] = Number(price);
        }
      }
    } catch (e) {
      console.error('Error fetching stocks:', e);
    }

    initWebSocket();

    setInterval(fetchPortfolioAndRender, 60 * 1000);
  })();

})();
