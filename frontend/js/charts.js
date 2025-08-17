(() => {
  const chartContainer = document.querySelector('.chart');
  let portfolioChart = null;
  let ro = null;
  let lastUserId = null;
  let refreshTimer = null;

  function getCssVariable(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v ? v.trim() : fallback;
  }

  function ensureCanvas() {
    if (!chartContainer) return null;
    if (!chartContainer.style.minHeight) chartContainer.style.minHeight = '240px';
    let canvas = chartContainer.querySelector('canvas#portfolioChart');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'portfolioChart';
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
      chartContainer.appendChild(canvas);
    }
    return canvas;
  }

  function destroyChart() {
    if (portfolioChart) {
      try { portfolioChart.destroy(); } catch (_) {}
      portfolioChart = null;
    }
  }

  function buildPalette(n) {
    const primary = getCssVariable('--primary-green', '#00b894');
    const fallbacks = [
      primary, '#3498db', '#9b59b6', '#e67e22', '#2ecc71',
      '#f1c40f', '#e74c3c', '#95a5a6', '#34495e', '#1abc9c',
      '#8e44ad', '#2c3e50', '#d35400', '#16a085', '#7f8c8d'
    ];
    const out = [];
    for (let i = 0; i < n; i++) out.push(fallbacks[i % fallbacks.length]);
    return out;
  }

  function toLabel(x) {
    const raw = x?.label ?? x?.StockID ?? x?.stock_id ?? x?.symbol ?? x?.name ?? '';
    const s = String(raw || '').toUpperCase();
    return s.length > 16 ? s.slice(0, 15) + '…' : s || '—';
  }

  function normalizeHoldings(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const h of arr) {
      const shares = Number(h.shares ?? h.Shares ?? 0);
      const curr = Number(h.current_price ?? h.CurrentPrice ?? h.price ?? h.close ?? 0);
      const mv =
        Number((h.market_value ?? h.MarketValue ?? h.marketValue ?? h.Value ??
               (shares * curr)) || 0);
      out.push({ label: toLabel(h), value: isFinite(mv) ? mv : 0 });
    }
    const anyPos = out.some(x => x.value > 0);
    return anyPos ? out.filter(x => x.value > 0) : out;
  }

  function renderNoHoldings() {
    drawChart([{ label: 'No holdings', value: 1 }], {
      isEmpty: true
    });
  }

  function drawChart(items, opts = {}) {
    const canvas = ensureCanvas();
    if (!canvas) return;

    destroyChart();

    const ctx = canvas.getContext('2d');
    const darkGrey = getCssVariable('--dark-grey', '#343a40');
    const white = getCssVariable('--white', '#ffffff');

    const labels = items.map(i => i.label);
    const data = items.map(i => i.value);

    const isEmpty = !!opts.isEmpty || (items.length === 0);
    const backgroundColor = isEmpty
      ? [getCssVariable('--black', '#000000')]
      : buildPalette(items.length);

    portfolioChart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor,
          hoverOffset: 8,
          borderColor: white,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: 10 },
        plugins: {
          legend: {
            position: 'right',
            labels: {
              font: { size: 12, family: 'Inter' },
              color: darkGrey,
              boxWidth: 20,
              padding: 8
            }
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const lbl = context.label || '';
                const v = context.parsed;
                if (isEmpty) return 'No holdings';
                // show currency and price
                const total = context.chart._metasets[0].total || context.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((v / total) * 100).toFixed(2) : '0.00';
                return `${lbl}: $${Number(v).toFixed(2)} (${pct}%)`;
              }
            },
            backgroundColor: getCssVariable('--tooltip-bg', 'rgba(0,0,0,0.85)'),
            titleFont: { size: 15, weight: 'bold', family: 'Inter' },
            bodyFont: { size: 13, family: 'Inter' },
            padding: 12,
            caretSize: 6,
            cornerRadius: 8,
            displayColors: true
          }
        }
      }
    });
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function loadFromAPI() {
    try {
      const me = await fetchJSON('/api/auth/me');
      if (me && typeof me.user_id !== 'undefined') lastUserId = me.user_id;
    } catch (_) {
    }
    let data = null;
    try {
      const url = lastUserId ? `/api/portfolio?user_id=${encodeURIComponent(lastUserId)}` : '/api/portfolio';
      data = await fetchJSON(url);
    } catch (_) {
      renderNoHoldings();
      return;
    }
    const raw = Array.isArray(data.holdings)
      ? data.holdings
      : (data.data && Array.isArray(data.data.holdings) ? data.data.holdings : []);

    const items = normalizeHoldings(raw);

    if (!items.length || items.every(x => x.value === 0)) {
      renderNoHoldings();
      return;
    }

    items.sort((a, b) => b.value - a.value);
    drawChart(items);
  }

  function watchResize() {
    if (!chartContainer || typeof ResizeObserver === 'undefined') return;
    ro = new ResizeObserver(() => {
      if (portfolioChart) {
        portfolioChart.resize();
      }
    });
    ro.observe(chartContainer);
  }

  function init() {
    if (!chartContainer) return;
    renderNoHoldings();
    loadFromAPI();
    watchResize();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadFromAPI();
    });


    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadFromAPI, 60 * 1000);
  }

  window.PortfolioChartAPI = {
    refresh: () => {
      if (portfolioChart) portfolioChart.update();
      else loadFromAPI();
    },
    updateHoldings: (newHoldings) => {
      const items = normalizeHoldings(newHoldings);
      if (!items.length || items.every(x => x.value === 0)) {
        renderNoHoldings();
      } else {
        items.sort((a, b) => b.value - a.value);
        drawChart(items);
      }
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();