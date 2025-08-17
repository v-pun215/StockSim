document.addEventListener('DOMContentLoaded', function () {
  const container = document.querySelector('.symbol-bubbles');
  if (!container) return;

  fetch('/api/stocks')
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to fetch /api/stocks');
      return res.json();
    })
    .then(function (list) {
      if (!Array.isArray(list)) return;

      list.forEach(function (s) {
        // minimal, forgiving symbol extraction
        const sym = (s.ID || s.id || s.stock_id || s.symbol || '').toString().trim().toUpperCase();
        if (!sym) return;

        const span = document.createElement('span');
        span.className = 'symbol-bubble';
        span.textContent = sym;
        span.setAttribute('data-symbol', sym);
        span.setAttribute('title', 'Open ' + sym + ' in Market');

        span.addEventListener('click', function () {
          try {
            localStorage.setItem('stocksim_selected', sym);
          } catch (e) {
          }
          location.href = 'market.html';
        });

        container.appendChild(span);
      });
    })
    .catch(function (err) {
      console.error('bubbles.js error:', err);
    });
});