(function () {
  const API_PORTFOLIO = '/api/portfolio';
  const API_TRANSACTIONS = '/api/transactions?limit=50';
  const WS_PRICES = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/prices';

  const currentCashEl = document.getElementById('current-cash');
  const currentNetworthEl = document.getElementById('current-networth');
  const totalGainEl = document.getElementById('total-gain');
  const totalPercentChangeEl = document.getElementById('total-percent-change');
  const portfolioDivEl = document.getElementById('portfolio-div');
  const ownedStocksTable = document.getElementById('ownedStocksTable');
  const leaderboardPositionEl = document.getElementById('leaderboard-position');
  const holdingsValueEl = document.getElementById('holdings-value');

  const usernameEl = document.getElementById('username');
  const teamNameEl = document.getElementById('team-name');
  const teamIdEl = document.getElementById('team-id');

  let holdings = [];
  let summary = { cash: 0, networth: 0, username: '', team: {} };
  let stocksIndex = {};
  let socket = null;
  let reconnectTimer = null;

  function fmtMoney(n) { return '$' + Number(n || 0).toFixed(2); }
  function fmtPct(n) { const sign = n > 0 ? '+' : (n < 0 ? '-' : ''); return sign + Math.abs(Number(n || 0)).toFixed(2) + '%'; }
  function safeNum(x) { return (typeof x === 'number') ? x : Number(x || 0); }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function normalizeKey(id) { return String(id || '').toUpperCase(); }
  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"'`=\/]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' }[c];
    });
  }

  function applyPricesToHoldings() {
    for (let h of holdings) {
      const key = normalizeKey(h.StockID);
      if (Object.prototype.hasOwnProperty.call(stocksIndex, key)) {
        h.CurrentPrice = round2(safeNum(stocksIndex[key]));
      } else {
        h.CurrentPrice = round2(safeNum(h.CurrentPrice));
      }
      h.Value = round2(safeNum(h.CurrentPrice) * safeNum(h.Shares));
    }
  }

  function computeTotals() {
    const cash = round2(safeNum(summary.cash || 0));
    let holdingsVal = 0;
    let totalCost = 0;
    let totalGain = 0;
    for (let h of holdings) {
      const shares = safeNum(h.Shares);
      const avg = safeNum(h.AvgPrice);
      const cur = safeNum(h.CurrentPrice);
      const cost = avg * shares;
      const value = cur * shares;
      holdingsVal += value;
      totalCost += cost;
      totalGain += (value - cost);
    }
    const networth = round2(cash + holdingsVal);
    const totalPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    return {
      cash,
      holdingsVal: round2(holdingsVal),
      networth,
      totalGain: round2(totalGain),
      totalPct: round2(totalPct)
    };
  }

  function renderSummaryUI() {
    const totals = computeTotals();

    if (currentCashEl) currentCashEl.textContent = fmtMoney(totals.cash);

    if (holdingsValueEl) holdingsValueEl.textContent = fmtMoney(totals.holdingsVal);

    if (currentNetworthEl) currentNetworthEl.textContent = fmtMoney(totals.networth);

    if (totalGainEl) {
      const gainTxt = (totals.totalGain >= 0 ? '+' : '-') + fmtMoney(Math.abs(totals.totalGain)).replace('$-', '$');
      totalGainEl.textContent = gainTxt;
      totalGainEl.title = 'Unrealized P/L (current holdings)';
    }

    if (totalPercentChangeEl) {
      totalPercentChangeEl.textContent = fmtPct(totals.totalPct);
    }

    if (portfolioDivEl) {
      portfolioDivEl.textContent = `${holdings.length} unique stocks`;
    }

    if (leaderboardPositionEl && summary.leaderboard_position !== undefined) {
      leaderboardPositionEl.textContent = summary.leaderboard_position;
    }

    if (usernameEl) {
      usernameEl.textContent = summary.username || '—';
    }

    const t = summary.team || {};
    if (teamNameEl) {
      const name = t.team_name ?? t.name ?? null;
      teamNameEl.textContent = name || 'No team';
    }
    if (teamIdEl) {
      const id = t.team_id ?? t.id ?? null;
      teamIdEl.textContent = (id !== null && id !== undefined) ? String(id) : '—';
    }
  }

  function renderHoldingsTable() {
    if (!ownedStocksTable) {
      return;
    }
    const tbody = ownedStocksTable.querySelector('tbody');
    if (!tbody) {
      return;
    }

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
      } else {
        const changeKey = '__change__' + normalizeKey(symbol);
        if (Object.prototype.hasOwnProperty.call(stocksIndex, changeKey)) {
          dailyGL = round2(stocksIndex[changeKey] * shares);
        }
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
      `;
      tbody.appendChild(tr);
    }
  }

  function updateUIFromState() {
    applyPricesToHoldings();
    renderSummaryUI();
    renderHoldingsTable();
  }

  async function fetchPortfolioAndRender() {
    try {
      const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!meRes.ok) {
        summary = { cash: 0, networth: 0, username: '', team: {} };
        holdings = [];
        updateUIFromState();
        return;
      }
      const me = await meRes.json();
      const userId = me.user_id;

      const res = await fetch(`${API_PORTFOLIO}?user_id=${encodeURIComponent(userId)}`, { credentials: 'same-origin' });
      if (!res.ok) {
        return;
      }
      const data = await res.json();

      let respHoldings = Array.isArray(data.holdings) ? data.holdings : (Array.isArray(data.data && data.data.holdings) ? data.data.holdings : []);
      let respSummary = data.summary || data.data || {};

      if (!respSummary || Object.keys(respSummary).length === 0) {
        respSummary = {
          cash: data.cash,
          networth: data.networth,
          total_unrealized_pl: data.total_unrealized_pl,
          total_gain_since_prev: data.total_gain_since_prev,
          total_gain_pct: data.total_gain_pct,
          diversification: data.diversification,
          leaderboard_position: data.leaderboard_position,
          last_updated: data.last_updated,
          username: data.username,
          team: data.team
        };
      }

      holdings = respHoldings.map(h => ({
        StockID: normalizeKey(h.stock_id || h.StockID || h.Stock || h.symbol || h.symbol_id || h.id),
        Shares: Number(h.shares || h.Shares || h.quantity || 0),
        AvgPrice: Number(h.avg_price || h.AvgPrice || h.avgPrice || h.average_price || 0),
        CurrentPrice: Number(h.current_price || h.CurrentPrice || h.price || h.last || h.close || 0),
        Value: Number(h.value || h.Value || 0),
        DailyChange: (h.daily_change !== undefined ? h.daily_change : (h.DailyChange !== undefined ? h.DailyChange : undefined))
      }));

      const respTeam = respSummary.team || {};
      summary = {
        cash: Number(respSummary.cash || 0),
        networth: Number(respSummary.networth || 0),
        total_unrealized_pl: Number(respSummary.total_unrealized_pl || 0),
        total_gain_since_prev: Number(respSummary.total_gain_since_prev || 0),
        total_gain_pct: Number(respSummary.total_gain_pct || 0),
        diversification: respSummary.diversification || 0,
        leaderboard_position: (respSummary.leaderboard_position || respSummary.leaderboard_position === 0) ? respSummary.leaderboard_position : undefined,
        last_updated: respSummary.last_updated || undefined,
        username: String(respSummary.username || ''),
        team: {
          team_id: (respTeam.team_id !== undefined ? respTeam.team_id : (respTeam.id !== undefined ? respTeam.id : null)),
          team_name: (respTeam.team_name !== undefined ? respTeam.team_name : (respTeam.name !== undefined ? respTeam.name : null)),
          team_rank: respTeam.team_rank !== undefined ? respTeam.team_rank : undefined,
          team_value: respTeam.team_value !== undefined ? respTeam.team_value : undefined,
          member_count: respTeam.member_count !== undefined ? respTeam.member_count : undefined
        }
      };

      updateUIFromState();
    } catch (err) {
      console.error('[portfolio] fetchPortfolioAndRender error', err);
    }
  }

  async function fetchTransactions(limit = 50) {
    try {
      const res = await fetch(`${API_TRANSACTIONS}&limit=${limit}`, { credentials: 'same-origin' });
      if (!res.ok) {
        const alt = await fetch('/api/transactionhistory?limit=' + limit, { credentials: 'same-origin' });
        if (!alt.ok) return null;
        return await alt.json();
      }
      return await res.json();
    } catch (err) {
      console.error('[portfolio] fetchTransactions error', err);
      return null;
    }
  }

  function initWebSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return;
    }
    try {
      socket = new WebSocket(WS_PRICES);
    } catch (err) {
      console.error('[portfolio] websocket init error', err);
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });

    socket.addEventListener('message', (ev) => {
      try {
        const parsed = JSON.parse(ev.data);

        let stocksArr = null;
        if (Array.isArray(parsed)) stocksArr = parsed;
        else if (parsed.stocks && Array.isArray(parsed.stocks)) stocksArr = parsed.stocks;
        else if (parsed.data && parsed.data.stocks && Array.isArray(parsed.data.stocks)) stocksArr = parsed.data.stocks;

        if (!stocksArr) {
          return;
        }

        for (let s of stocksArr) {
          const id = s.ID || s.id || s.stock_id || s.symbol || s.Stock || s.stock;
          const price = s.Price || s.price || s.close || s.p || s.price_now;
          const change = s.Change || s.change || s.delta || 0;
          const key = normalizeKey(id);
          if (!key) continue;
          if (price !== undefined) {
            stocksIndex[key] = Number(price);
          }
          stocksIndex['__change__' + key] = Number(change);
        }

        updateUIFromState();
      } catch (err) {
        console.error('[portfolio] websocket message parse error', err);
      }
    });

    socket.addEventListener('close', () => {
      scheduleReconnect();
    });

    socket.addEventListener('error', (err) => {
      console.error('[portfolio] websocket error', err);
      try { socket.close(); } catch (e) {}
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      initWebSocket();
    }, 1500 + Math.random() * 3000);
  }

  (async function boot() {
    await fetchPortfolioAndRender();

    try {
      const r = await fetch('/api/stocks', { credentials: 'same-origin' });
      if (r.ok) {
        const arr = await r.json();
        for (let s of arr) {
          const id = s.ID || s.id || s.stock_id || s.symbol || s.Stock || s.stock;
          const price = s.Price || s.price || s.price_now;
          if (id !== undefined && price !== undefined) {
            stocksIndex[normalizeKey(id)] = Number(price);
          }
        }
        updateUIFromState();
      }
    } catch (e) {
      console.error('[portfolio] error seeding /api/stocks', e);
    }

    initWebSocket();

    setInterval(() => {
      fetchPortfolioAndRender();
    }, 60 * 1000);
  })();

})();
