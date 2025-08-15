(() => {
  const chartContainer = document.querySelector('.chart');
  let portfolioChart = null;
  let ro = null;

  function getCssVariable(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v ? v.trim() : fallback;
  }

  //sample holdings for now, backend will be linked later.
  const holdings = [
    { label: 'AAPL', value: 25 },
    { label: 'NVDA', value: 200 },
    { label: 'TSLA', value: 50 },
    { label: 'AMZN', value: 30 },
    { label: 'GOOG', value: 40 }
  ];

  function ensureCanvas() {
    // ensure container exists
    if (!chartContainer) return null;

    // ensure container can flexibly grow/shrink: do not force fixed height,
    // but provide a sensible minimum so chart is visible by default.
    if (!chartContainer.style.minHeight) {
      chartContainer.style.minHeight = '240px';
    }
    // create or reuse canvas
    let canvas = chartContainer.querySelector('canvas#portfolioChart');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'portfolioChart';
      // Let the canvas size be controlled by CSS of parent.
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.padding = '0';
      canvas.style.margin = '0 auto';
      chartContainer.appendChild(canvas);
    }
    // remove explicit width/height attributes so Chart.js/responsive can manage it
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');
    return canvas;
  }

  function createPortfolioChart() {
    const canvas = ensureCanvas();
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // destroy previous chart if exists
    if (portfolioChart) {
      try { portfolioChart.destroy(); } catch (e) { /* ignore */ }
      portfolioChart = null;
    }

    const primaryColor = getCssVariable('--primary-green', '#00b894');
    const darkGrey = getCssVariable('--dark-grey', '#343a40');

    const labels = holdings.map(h => h.label);
    const data = holdings.map(h => h.value);
    const bgColors = [
      primaryColor, '#3498db', '#9b59b6', '#e67e22', '#2ecc71',
      '#f1c40f', '#e74c3c', '#95a5a6', '#34495e', '#1abc9c'
    ];

    portfolioChart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: bgColors,
          hoverOffset: 8,
          borderColor: getCssVariable('--white', '#ffffff'),
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,            // important: allow Chart.js to be responsive
        maintainAspectRatio: false, // important: allow canvas to fill container height
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
                let label = context.label || '';
                if (label) label += ': ';
                if (context.parsed !== null) label += context.parsed;
                return label + ' shares';
              }
            },
            backgroundColor: getCssVariable('--tooltip-bg', 'rgba(0,0,0,0.85)'),
            titleFont: { size: 15, weight: 'bold', family: 'Inter', color: getCssVariable('--tooltip-text', '#fff') },
            bodyFont: { size: 13, family: 'Inter', color: getCssVariable('--tooltip-text', '#fff') },
            padding: 12,
            caretSize: 6,
            cornerRadius: 8,
            displayColors: true
          }
        }
      }
    });

    // After creating, trigger a resize to ensure Chart.js reads the current container size.
    setTimeout(() => {
      try { portfolioChart.resize(); } catch (e) { /* ignore */ }
    }, 0);
  }

  function initResizeObserver() {
    if (!chartContainer) return;

    // If ResizeObserver supported, use it for robust detection of container size changes
    if (typeof ResizeObserver !== 'undefined') {
      if (ro) ro.disconnect();
      ro = new ResizeObserver(() => {
        if (portfolioChart) {
          try { portfolioChart.resize(); } catch (e) { /* ignore */ }
        }
      });
      ro.observe(chartContainer);
    } else {
      // fallback: window resize
      window.addEventListener('resize', () => {
        if (portfolioChart) {
          try { portfolioChart.resize(); } catch (e) { /* ignore */ }
        }
      });
    }
  }

  function init() {
    if (!chartContainer) return;
    createPortfolioChart();
    initResizeObserver();
  }

  // expose a small API so you can update chart dataset externally later if you want:
  window.PortfolioChartAPI = {
    refresh: () => {
      if (!portfolioChart) createPortfolioChart();
      else portfolioChart.update();
    },
    updateHoldings: (newHoldings) => {
      // replace holdings data and redraw
      if (!Array.isArray(newHoldings)) return;
      // map to simple label/value
      while (holdings.length) holdings.pop();
      for (const h of newHoldings) holdings.push({ label: h.label || h.StockID || h.stock_id, value: Number(h.value || h.shares || 0) });
      if (portfolioChart) {
        portfolioChart.data.labels = holdings.map(h => h.label);
        portfolioChart.data.datasets[0].data = holdings.map(h => h.value);
        portfolioChart.update();
      } else {
        createPortfolioChart();
      }
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
