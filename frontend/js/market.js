(function () {
	const API_STOCKS = 'http://localhost:8080/api/stocks'
	const API_HISTORY = 'http://localhost:8080/api/history'
	const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + 'localhost:8080/ws/prices'

	function $ (sel) { return document.querySelector(sel) }
	function byId (id) { return document.getElementById(id) }
	function fmtMoney (n) { return '$' + Number(n || 0).toFixed(2) }

	const companyNameEl = byId('company-name')
	const companySectorEl = byId('company-sector')
	const stockSymbolEl = byId('stock-symbol')
	const stockPriceEl = byId('stock-price')
	const marketPriceEl = byId('market-price')
	const marketPriceEl2 = byId('market-price2')
	const netDollarEl = byId('net-dollar-change')
	const netPctEl = byId('net-percent-change')
	const chartWrapper = byId('stock-history')
	const searchInput = $('.search-stocks input')

	const ocOpenEl = byId('oclh-open')
	const ocCloseEl = byId('oclh-close')
	const ocHighEl = byId('oclh-high')
	const ocLowEl = byId('oclh-low')

	let chart = null
	let areaSeries = null
	let chartContainer = null

	let ws = null
	let wsReconnectTimer = null
	let lastHistoryClose = null
	let lastChartPointTime = null
	let selectedStockFullName = null

	let currentOclh = null
	let currentOclhMinuteKey = null

	function isoOrNumberToSeconds(t) {
		if (typeof t === 'number') {
			if (t > 1e12) return Math.floor(t / 1000)
			return Math.floor(t)
		}
		if (typeof t === 'string') {
			const d = new Date(t)
			if (isNaN(d.getTime())) return null
			return Math.floor(d.getTime() / 1000)
		}
		return null
	}

	function showNoSelection() {
		if (companyNameEl) companyNameEl.textContent = 'No Stock Selected'
		if (companySectorEl) companySectorEl.textContent = 'N/A'
		if (stockSymbolEl) stockSymbolEl.textContent = '(N/A)'
		if (stockPriceEl) stockPriceEl.textContent = 'N/A'
		if (marketPriceEl) marketPriceEl.textContent = 'N/A'
		if (marketPriceEl2) marketPriceEl2.textContent = 'N/A'
		if (netDollarEl) netDollarEl.textContent = 'N/A'
		if (netPctEl) netPctEl.textContent = 'N/A'
		setOclhDOM(null, null, null, null)
		if (chart) {
			try { chart.remove() } catch (e) {}
			chart = null
			areaSeries = null
			chartContainer = null
		}
		if (chartWrapper) chartWrapper.innerHTML = '<p style="color:#6b7280">No stock selected. Please select a stock to view its chart.</p>'
	}

	function ensureChartContainer() {
		chartWrapper.innerHTML = ''
		const wrap = document.createElement('div')
		wrap.id = 'tv-chart'
		wrap.style.width = '100%'
		wrap.style.height = '420px'
		wrap.style.padding = '0'
		wrap.style.margin = '0'
		chartWrapper.appendChild(wrap)
		chartContainer = wrap
		return wrap
	}

	function createChartee() {
		if (chart) return
		const el = ensureChartContainer()
		chart = LightweightCharts.createChart(el, {
			width: el.clientWidth,
			height: 420,
			layout: { backgroundColor: '#fff', textColor: '#333' },
			rightPriceScale: { scaleMargins: { top: 0.15, bottom: 0.15 } },
			timeScale: { timeVisible: true, secondsVisible: false },
			crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
			grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
			localization: { dateFormat: 'yyyy-MM-dd' }
		})

		areaSeries = chart.addAreaSeries({
			topColor: 'rgba(41,119,245,0.30)',
			bottomColor: 'rgba(41,119,245,0.00)',
			lineColor: '#2977F5',
			lineWidth: 2,
			priceLineVisible: true
		})

		window.addEventListener('resize', function () {
			if (!chart || !chartContainer) return
			chart.applyOptions({ width: chartContainer.clientWidth })
			setTimeout(() => { try { chart.timeScale().fitContent() } catch (e) {} }, 50)
		})
	}

	function preserveSelectedStockName(stock) {
		if (!stock) return
		selectedStockFullName = stock.name || stock.id || null
		if (companyNameEl && selectedStockFullName) companyNameEl.textContent = selectedStockFullName
		if (companySectorEl) companySectorEl.textContent = stock.sector || 'N/A'
	}

	function setLastHistoryCloseFromArray(historyArr) {
		lastHistoryClose = null
		if (Array.isArray(historyArr) && historyArr.length > 0) {
			const last = historyArr[historyArr.length - 1]
			lastHistoryClose = Number(last.close || 0) || null
		}
	}

	function headerUpdateFromWS(stockObj, msgTime) {
		if (!stockObj) return
		const id = String(stockObj.id || '').toUpperCase()
		const priceNum = Number(stockObj.price || 0)
		const changeAbs = Number(stockObj.change || 0)
		const impliedPrev = priceNum - changeAbs
		const baseForPct = (lastHistoryClose !== null && lastHistoryClose !== undefined) ? Number(lastHistoryClose) : (impliedPrev || priceNum)
		const pct = baseForPct !== 0 ? (changeAbs / baseForPct * 100) : 0

		if (companyNameEl && selectedStockFullName) companyNameEl.textContent = selectedStockFullName
		if (companySectorEl && (stockObj.sector || companySectorEl.textContent === 'N/A')) {
			if (!companySectorEl.textContent || companySectorEl.textContent === 'N/A') {
				companySectorEl.textContent = stockObj.sector || 'N/A'
			}
		}
		if (stockSymbolEl) stockSymbolEl.textContent = `(${id})`
		if (stockPriceEl) stockPriceEl.textContent = fmtMoney(priceNum)

		const sign = changeAbs > 0 ? '+' : (changeAbs < 0 ? '-' : '')
		const absFmt = fmtMoney(Math.abs(changeAbs)).replace('$-', '$')
		if (netDollarEl) {
			netDollarEl.textContent = `${sign}${absFmt}`
			netDollarEl.style.color = changeAbs < 0 ? 'var(--red)' : 'var(--green)'
		}
		if (netPctEl) {
			const pctSign = pct > 0 ? '+' : (pct < 0 ? '' : '')
			netPctEl.textContent = `${pctSign}${Number(pct).toFixed(2)}%`
			netPctEl.style.color = pct < 0 ? 'var(--red)' : 'var(--green)'
		}
		if (marketPriceEl) marketPriceEl.textContent = fmtMoney(priceNum)
		if (marketPriceEl2) marketPriceEl2.textContent = fmtMoney(priceNum)
	}

	function setOclhDOM(open, close, high, low) {
		if (ocOpenEl) ocOpenEl.textContent = (open === null || open === undefined) ? 'N/A' : fmtMoney(open)
		if (ocCloseEl) ocCloseEl.textContent = (close === null || close === undefined) ? 'N/A' : fmtMoney(close)
		if (ocHighEl) ocHighEl.textContent = (high === null || high === undefined) ? 'N/A' : fmtMoney(high)
		if (ocLowEl) ocLowEl.textContent = (low === null || low === undefined) ? 'N/A' : fmtMoney(low)
	}

	function initOclhFromBar(bar) {
		if (!bar) {
			currentOclh = null
			currentOclhMinuteKey = null
			setOclhDOM(null, null, null, null)
			return
		}
		const tsec = isoOrNumberToSeconds(bar.time)
		let localSeconds = tsec
		if (localSeconds === null) localSeconds = Math.floor(Date.now() / 1000)
		localSeconds = localSeconds - (new Date().getTimezoneOffset() * 60)
		currentOclhMinuteKey = Math.floor(localSeconds / 60)
		currentOclh = {
			open: Number(bar.open || bar.O || bar.o || 0),
			high: Number(bar.high || bar.H || bar.h || bar.open || 0),
			low: Number(bar.low || bar.L || bar.l || bar.open || 0),
			close: Number(bar.close || bar.C || bar.c || 0)
		}
		setOclhDOM(currentOclh.open, currentOclh.close, currentOclh.high, currentOclh.low)
	}

	function updateOclhWithTick(priceNum, wsTimeStrOrNum) {
		if (priceNum === null || priceNum === undefined) return
		const tsec = isoOrNumberToSeconds(wsTimeStrOrNum)
		let useTsec = tsec
		if (useTsec === null) useTsec = Math.floor(Date.now() / 1000)
		const localSeconds = useTsec - (new Date().getTimezoneOffset() * 60)
		const minuteKey = Math.floor(localSeconds / 60)

		if (!currentOclh || currentOclhMinuteKey === null || minuteKey > currentOclhMinuteKey) {
			currentOclhMinuteKey = minuteKey
			currentOclh = { open: Number(priceNum), high: Number(priceNum), low: Number(priceNum), close: Number(priceNum) }
			setOclhDOM(currentOclh.open, currentOclh.close, currentOclh.high, currentOclh.low)
			return
		}

		if (minuteKey === currentOclhMinuteKey) {
			const p = Number(priceNum)
			currentOclh.close = p
			if (p > currentOclh.high) currentOclh.high = p
			if (p < currentOclh.low) currentOclh.low = p
			setOclhDOM(currentOclh.open, currentOclh.close, currentOclh.high, currentOclh.low)
			return
		}
	}

	function appendTickToChart(priceNum, wsTimeStrOrNum) {
		if (!areaSeries || !chart) return
		try {
			let tsec = isoOrNumberToSeconds(wsTimeStrOrNum)
			if (tsec === null) tsec = Math.floor(Date.now() / 1000)
			let localSeconds = tsec - (new Date().getTimezoneOffset() * 60)

			if (lastChartPointTime && localSeconds <= lastChartPointTime) {
				localSeconds = lastChartPointTime + 1
			}

			areaSeries.update({ time: localSeconds, value: Number(priceNum) })
			lastChartPointTime = localSeconds
			updateOclhWithTick(priceNum, wsTimeStrOrNum)
		} catch (err) {
			console.warn('appendTickToChart error:', err)
		}
	}

	function handleWSMessageForSelected(msg) {
		if (!msg || !Array.isArray(msg.stocks)) return
		const msgTime = msg.time || null
		const sel = (localStorage.getItem('stocksim_selected') || '').toString().trim().toUpperCase()
		if (!sel) return
		const s = msg.stocks.find(x => (x.id || '').toString().toUpperCase() === sel)
		if (!s) return
		headerUpdateFromWS(s, msgTime)
		appendTickToChart(Number(s.price || 0), msgTime || Date.now())
	}

	function connectPricesWS(onStockUpdate) {
		if (ws) {
			try { ws.close() } catch (e) {}
			ws = null
		}
		try {
			ws = new WebSocket(WS_URL)
		} catch (e) {
			if (!wsReconnectTimer) wsReconnectTimer = setTimeout(() => connectPricesWS(onStockUpdate), 1000)
			return
		}
		ws.addEventListener('open', () => {
			if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null }
		})
		ws.addEventListener('message', (ev) => {
			try {
				const msg = JSON.parse(ev.data)
				if (!msg || !Array.isArray(msg.stocks)) return
				if (typeof onStockUpdate === 'function') onStockUpdate(msg)
			} catch (err) {}
		})
		ws.addEventListener('close', () => {
			if (!wsReconnectTimer) wsReconnectTimer = setTimeout(() => connectPricesWS(onStockUpdate), 1000)
		})
		ws.addEventListener('error', (e) => {
			try { ws.close() } catch (e) {}
		})
	}

	async function loadHistoryAndPlot(symbol, points) {
		createChartee()
		if (!areaSeries) return

		const url = `${API_HISTORY}?stock=${encodeURIComponent(symbol)}`
		try {
			const res = await fetch(url)
			if (!res.ok) {
				areaSeries.setData([])
				lastChartPointTime = null
				lastHistoryClose = null
				initOclhFromBar(null)
				return
			}
			const arr = await res.json()
			if (!Array.isArray(arr) || arr.length === 0) {
				areaSeries.setData([])
				lastChartPointTime = null
				lastHistoryClose = null
				initOclhFromBar(null)
				return
			}

			const raw = []
			for (const it of arr) {
				const t = isoOrNumberToSeconds(it.time)
				if (t === null) continue
				const localSeconds = t - (new Date().getTimezoneOffset() * 60)
				const close = Number(it.close)
				if (!Number.isFinite(close)) continue
				raw.push({ time: Math.floor(localSeconds), value: close })
			}

			if (raw.length === 0) {
				areaSeries.setData([])
				lastChartPointTime = null
				lastHistoryClose = null
				initOclhFromBar(null)
				return
			}

			raw.sort((a, b) => a.time - b.time)

			const finalLine = []
			let prevTime = null
			for (const p of raw) {
				let t = p.time
				if (prevTime === null) {
					finalLine.push({ time: t, value: p.value })
					prevTime = t
					continue
				}
				if (t <= prevTime) {
					t = prevTime + 1
				}
				finalLine.push({ time: t, value: p.value })
				prevTime = t
			}

			try {
				areaSeries.setData(finalLine)
			} catch (err) {
				console.warn('areaSeries.setData failed, trimming data:', err)
				const trimmed = finalLine.slice(-200)
				try {
					areaSeries.setData(trimmed)
				} catch (err2) {
					console.error('setData fallback also failed:', err2)
					areaSeries.setData([])
				}
			}

			try { chart.timeScale().fitContent() } catch (e) {}

			setLastHistoryCloseFromArray(arr)
			if (finalLine.length > 0) {
				lastChartPointTime = finalLine[finalLine.length - 1].time
			} else {
				lastChartPointTime = null
			}

			const lastBar = arr[arr.length - 1]
			initOclhFromBar(lastBar)
		} catch (err) {
			try { areaSeries.setData([]) } catch (e) {}
			lastChartPointTime = null
			lastHistoryClose = null
			initOclhFromBar(null)
			console.warn('loadHistoryAndPlot error:', err)
		}
	}

	function fillHeaderFromStock(s) {
		if (!s) { showNoSelection(); return }

		const name = s.name || s.id || 'Unknown'
		const id = (s.id || '').toString()
		const priceNum = Number(s.price || 0)
		const change = Number(s.change || 0)
		const prev = (priceNum - change) || 0
		const pct = prev !== 0 ? (change / prev * 100) : 0

		if (companyNameEl) companyNameEl.textContent = name
		if (companySectorEl) companySectorEl.textContent = s.sector || 'N/A'
		if (stockSymbolEl) stockSymbolEl.textContent = `(${id})`
		if (stockPriceEl) stockPriceEl.textContent = fmtMoney(priceNum)
		if (marketPriceEl) marketPriceEl.textContent = fmtMoney(priceNum)
		if (marketPriceEl2) marketPriceEl2.textContent = fmtMoney(priceNum)

		if (netDollarEl) netDollarEl.textContent = (change >= 0 ? '+' : '-') + fmtMoney(Math.abs(change)).replace('$-','$')
		if (netPctEl) netPctEl.textContent = (pct >= 0 ? '+' : '') + Number(pct).toFixed(2) + '%'
	}

	async function init() {
		let stocks = []
		try {
			const r = await fetch(API_STOCKS)
			if (r.ok) stocks = await r.json()
		} catch (e) {}

		const sel = (localStorage.getItem('stocksim_selected') || '').toString().trim().toUpperCase()
		if (!sel) { showNoSelection(); return }

		const stock = stocks.find(s => {
			if (!s) return false
			if ((s.id || '').toString().toUpperCase() === sel) return true
			if ((s.name || '').toString().toUpperCase().includes(sel)) return true
			return false
		})
		if (!stock) { showNoSelection(); return }

		preserveSelectedStockName(stock)
		fillHeaderFromStock(stock)
		await loadHistoryAndPlot(stock.id)
		connectPricesWS(handleWSMessageForSelected)
	}

	if (searchInput) {
		searchInput.addEventListener('keydown', function (e) {
			if (e.key !== 'Enter') return
			const v = (e.target.value || '').toString().trim().toUpperCase()
			if (!v) return
			localStorage.setItem('stocksim_selected', v)
			location.reload()
		})
	}

	document.addEventListener('DOMContentLoaded', init)
})()
