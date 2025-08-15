(function () {
	// config
	const HISTORY_ENDPOINT = 'http://localhost:8080/api/history';
	const STATUS_ENDPOINT = 'http://localhost:8080/api/status';

	// helpers
	function $(sel) { return document.querySelector(sel); }
	function formatDateYMD(d) {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${dd}`;
	}
	function isoOrNumberToSeconds(t) {
		if (typeof t === 'number') {
			if (t > 1e12) return Math.floor(t / 1000);
			if (t > 1e9) return Math.floor(t);
			return Math.floor(t);
		}
		if (typeof t === 'string') {
			const d = new Date(t);
			return Math.floor(d.getTime() / 1000);
		}
		return null;
	}

	// elements
	const chartArea = $('.stock-history');
	const searchInput = $('.search-stocks input');
	const headerTitle = document.querySelector('.top h1');
	const headerPrice = document.querySelector('.top h2');
	const priceChangeEl = $('#net-dollar-change');
	const pricePctEl = $('#net-percent-change');
	const marketPriceEl = $('#market-price');
	const estCostEl = $('#estimated-cost');
	const sharesInput = $('#shares');
	const simTimeEl = $('#sim-time');

	function ensureChartContainer() {
		if (!chartArea) return null;
		chartArea.innerHTML = '';
		const wrap = document.createElement('div');
		wrap.id = 'tv-chart';
		wrap.style.width = '100%';
		wrap.style.height = '420px';
		wrap.style.padding = '0';
		wrap.style.margin = '0';
		chartArea.appendChild(wrap);
		return wrap;
	}

	let chart = null;
	let areaSeries = null;
	let chartContainerEl = null;

	function createChart() {
		chartContainerEl = ensureChartContainer();
		if (!chartContainerEl) return;

		chart = LightweightCharts.createChart(chartContainerEl, {
			width: chartContainerEl.clientWidth,
			height: 420,
			layout: {
				backgroundColor: '#ffffff',
				textColor: '#333',
				fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial'
			},
			rightPriceScale: {
				scaleMargins: { top: 0.15, bottom: 0.15 },
				borderVisible: false
			},
			timeScale: {
				timeVisible: true,
				secondsVisible: false,
				borderVisible: false
			},
			crosshair: {
				mode: LightweightCharts.CrosshairMode.Normal
			},
			grid: {
				vertLines: { color: '#f0f0f0' },
				horzLines: { color: '#f0f0f0' }
			},
			localization: {
				dateFormat: 'yyyy-MM-dd'
			},
			handleScale: { axisPressedMouseMove: true },
			handleScroll: { mouseWheel: true, pressedMouseMove: true }
		});

		// Area (line) series — uses close prices
		areaSeries = chart.addAreaSeries({
			topColor: 'rgba(41,119,245,0.30)',
			bottomColor: 'rgba(41,119,245,0.00)',
			lineColor: '#2977F5',
			lineWidth: 2,
			priceLineVisible: true
		});

		window.addEventListener('resize', () => {
			if (chart && chartContainerEl) {
				chart.applyOptions({ width: chartContainerEl.clientWidth });
				setTimeout(() => chart.timeScale().fitContent(), 50);
			}
		});
	}

	async function loadHistory(symbol, points = 60) {
		if (!chart) createChart();
		if (!chart) return; // in case container not found

		const url = `${HISTORY_ENDPOINT}?stock=${encodeURIComponent(symbol)}&points=${points}`;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error('failed to fetch history');
			const raw = await res.json();
			if (!Array.isArray(raw) || raw.length === 0) {
				areaSeries.setData([]);
				return;
			}
			const line = [];
			for (let item of raw) {
                const t = isoOrNumberToSeconds(item.time);
                if (t === null) continue;
                const localTime = t - (new Date().getTimezoneOffset() * 60);
                line.push({
                    time: localTime,
                    value: Number(item.close)
                });
            }
			areaSeries.setData(line);
			chart.timeScale().fitContent();
		} catch (err) {
			console.error('loadHistory error', err);
		}
	}

	async function refreshHeader(symbol) {
		try {
			const res = await fetch('/api/stocks');
			if (!res.ok) return;
			const list = await res.json();
			const s = list.find(x => x.id === symbol || x.name.toUpperCase().includes(symbol));
			if (!s) return;
			if (headerTitle) headerTitle.textContent = (s.name || symbol) + ' Shares';
			if (headerPrice) headerPrice.textContent = `(${symbol}) $${s.price.toFixed(2)}`;
			if (marketPriceEl) marketPriceEl.textContent = `$${s.price.toFixed(2)}`;
			if (priceChangeEl) priceChangeEl.textContent = (s.change >= 0 ? '+' : '') + s.change.toFixed(2);
			if (pricePctEl) {
				const prev = s.price - s.change;
				const pct = prev !== 0 ? (s.change / prev * 100) : 0;
				pricePctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
			}
			updateEstimatedCost();
		} catch (err) {
			console.error(err);
		}
	}

	function updateEstimatedCost() {
		const shares = Number(sharesInput?.value || 0);
		const priceText = (marketPriceEl?.textContent || '').replace(/[^0-9.]/g, '');
		const price = Number(priceText) || 0;
		if (estCostEl) estCostEl.textContent = `$${(shares * price).toFixed(2)}`;
	}


	if (sharesInput) sharesInput.addEventListener('input', updateEstimatedCost);

	if (searchInput) {
		searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				const sym = e.target.value.trim().toUpperCase();
				if (sym) {
					loadHistory(sym, 120);
					refreshHeader(sym);
				}
			}
		});
	}

	// simulation time (scrapped for now)
	let serverNow = null;
	let compStart = null;
	let pageLoadAt = Date.now();

	async function fetchStatusAndStart() {
		try {
			const res = await fetch(STATUS_ENDPOINT);
			if (!res.ok) throw new Error('status fetch failed');
			const data = await res.json();
			serverNow = new Date(data.now);
			compStart = new Date(data.start);
			pageLoadAt = Date.now();
			updateSimTime();
			setInterval(updateSimTime, 1000);
		} catch (err) {
			console.error('status fetch error', err);
		}
	}

	function pad(n) { return String(n).padStart(2, '0'); }
	function formatDuration(ms) {
		if (ms < 0) ms = 0;
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
		return `${pad(minutes)}:${pad(seconds)}`;
	}

	function updateSimTime() {
		if (!serverNow || !compStart || !simTimeEl) return;
		const approxServerNow = new Date(serverNow.getTime() + (Date.now() - pageLoadAt));
		if (approxServerNow < compStart) {
			const diff = compStart - approxServerNow;
			simTimeEl.textContent = `Starts in ${formatDuration(diff)}`;
			return;
		}
		const realElapsedSeconds = (approxServerNow.getTime() - compStart.getTime()) / 1000;
		const simElapsedSeconds = realElapsedSeconds * 1440; // 86400/60
		const simNow = new Date(compStart.getTime() + simElapsedSeconds * 1000);
		const simDate = formatDateYMD(simNow);
		const simDay = Math.floor(simElapsedSeconds / 86400) + 1;
		simTimeEl.textContent = `Sim ${simDate} (Day ${simDay})`;
	}

	(function boot() {
		createChart();
		const initial = 'APEX'; // again, not dynamic right now
		loadHistory(initial);
		refreshHeader(initial);
		fetchStatusAndStart();
	})();
})();
