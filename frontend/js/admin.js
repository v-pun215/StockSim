(() => {
	const API_STOCKS = '/api/stocks'
	const API_NEWS = '/api/news'
	const ADMIN_PUBLISH_NEWS = '/api/admin/publish-news'
	const ADMIN_STOCK_ACTION = '/api/admin/stock-action'
	const ADMIN_COMPETITION_UPDATE = '/api/teams'
	let adminSecret = null
	let stocks = []
	let sectors = []
	let sources = [] // news websites list

	const overlay = document.getElementById('admin-overlay')
	const secretInput = document.getElementById('admin-secret-input')
	const secretSubmit = document.getElementById('admin-secret-submit')
	const secretCancel = document.getElementById('admin-secret-cancel')
	const secretMsg = document.getElementById('admin-secret-msg')

	const stockSelectNews = document.getElementById('news-stock-select')
	const sectorSelectNews = document.getElementById('news-sector-select')
	const targetType = document.getElementById('news-target-type')
	const impactInput = document.getElementById('news-impact')
	const sourceSelect = document.getElementById('news-source')
	const titleInput = document.getElementById('news-title')
	const contentInput = document.getElementById('news-content')
	const publishBtn = document.getElementById('news-publish')
	const newsPreview = document.getElementById('news-preview')
	const newsStatus = document.getElementById('news-status')
	const maxParticipantsInput = document.getElementById('max-participants')

	const actionStockSelect = document.getElementById('action-stock')
	const actionType = document.getElementById('action-type')
	const actionMag = document.getElementById('action-magnitude')
	const actionRun = document.getElementById('action-run')
	const actionPreview = document.getElementById('action-run-preview')
	const actionStatus = document.getElementById('action-status')
	const competitionStatus = document.getElementById('competition-status')
	const capacityBtn = document.getElementById('comp-update')

	const stocksTableBody = document.querySelector('#stocks-table tbody')
	const newsListDiv = document.getElementById('news-list')
	const logoutBtn = document.getElementById('logout-admin')

	function setStatus(el, msg, isError = false) {
		if (!el) return
		el.innerHTML = ''
		if (!msg) return
		const d = document.createElement('div')
		d.className = 'status-msg ' + (isError ? 'status-error' : 'status-success')
		d.textContent = msg
		el.appendChild(d)
		if (!isError) setTimeout(() => { try { d.remove() } catch (e) {} }, 5000)
	}

	function clamp(n, min, max) {
		if (n < min) return min
		if (n > max) return max
		return n
	}

	function toFixedSafe(n, digits=2) {
		if (!Number.isFinite(n)) return 'N/A'
		return Number(n).toFixed(digits)
	}

	function escapeHtml(s) {
		if (!s) return ''
		return String(s).replace(/[&<>"'`=\/]/g, function (c) {
			return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;' }[c]
		})
	}

	// localstorage helpers
	const LS_KEY = 'stocksim_admin_secret'
	function storeAdminSecret(secret) {
		try { localStorage.setItem(LS_KEY, String(secret)) } catch (e) {}
	}
	function clearAdminSecret() {
		try { localStorage.removeItem(LS_KEY) } catch (e) {}
	}

	async function verifySecretAndUnlock(secret) {
		if (!secret) return false
		// show verifying message if UI available
		if (secretMsg) setStatus(secretMsg, 'Verifying admin secret...')
		try {
			const res = await fetch('/api/users', {
				method: 'GET',
				credentials: 'same-origin',
				headers: { 'X-Admin-Secret': secret }
			})
			if (res.status === 200) {
				adminSecret = secret

				storeAdminSecret(secret)
				if (overlay) hideOverlay()
				await refreshAll()
				try { localStorage.setItem('stocksim_admin_last_verified', String(Date.now())) } catch (e) {}
				if (secretMsg) setStatus(secretMsg, 'Admin unlocked', false)
				return true
			}
			// invalid
			const txt = await res.text().catch(() => '')
			if (secretMsg) setStatus(secretMsg, txt || 'Invalid admin secret', true)
			clearAdminSecret()
			return false
		} catch (err) {
			if (secretMsg) setStatus(secretMsg, 'Network error verifying secret', true)
			clearAdminSecret()
			return false
		}
	}

	function showOverlay() {
		if (!overlay) return
		overlay.style.display = 'flex'
		if (secretInput) secretInput.value = ''
		if (secretMsg) secretMsg.innerHTML = ''
		if (secretInput) secretInput.focus()
	}
	function hideOverlay() {
		if (!overlay) return
		overlay.style.display = 'none'
	}

	// load news websites
	async function loadSources() {
		try {
			const r = await fetch('/api/news/sources', { cache: 'no-store' })
			if (!r.ok) throw new Error('bad response')
			
			const obj = await r.json()
			sources = Object.keys(obj).filter(k => obj[k])
		} catch (e) {
			sources = []
		}

		if (!sourceSelect) return

		sourceSelect.innerHTML = ''
		const opt = document.createElement('option')
		opt.value = ''
		opt.textContent = '(select source)'
		sourceSelect.appendChild(opt)

		for (const s of sources) {
			const o = document.createElement('option')
			o.value = s
			o.textContent = s
			sourceSelect.appendChild(o)
		}
	}

	async function fetchStocks() {
		try {
			const r = await fetch(API_STOCKS, { credentials: 'same-origin' })
			if (!r.ok) throw new Error('failed')
			const arr = await r.json()
			stocks = Array.isArray(arr) ? arr : []
		} catch (err) {
			stocks = []
		}
		const set = new Set()
		for (const s of stocks) {
			if (s.sector) set.add(s.sector)
		}
		sectors = Array.from(set).sort()

		populateStockControls()
		renderStocksTable()
	}

	function populateStockControls() {
		if (!stockSelectNews || !actionStockSelect || !sectorSelectNews) return

		stockSelectNews.innerHTML = ''
		const blank = document.createElement('option'); blank.value=''; blank.textContent='(choose stock)'; stockSelectNews.appendChild(blank)
		for (const s of stocks) {
			const o = document.createElement('option'); o.value = s.id; o.textContent = `${s.id} — ${s.name}`; stockSelectNews.appendChild(o)
		}
		actionStockSelect.innerHTML = ''
		for (const s of stocks) {
			const o = document.createElement('option'); o.value = s.id; o.textContent = `${s.id} — ${s.name}`; actionStockSelect.appendChild(o)
		}
		sectorSelectNews.innerHTML = ''
		const blank2 = document.createElement('option'); blank2.value=''; blank2.textContent='(choose sector)'; sectorSelectNews.appendChild(blank2)
		for (const sec of sectors) {
			const o = document.createElement('option'); o.value = sec; o.textContent = sec; sectorSelectNews.appendChild(o)
		}
	}

	function renderStocksTable() {
		if (!stocksTableBody) return
		stocksTableBody.innerHTML = ''
		if (!stocks || stocks.length === 0) {
			stocksTableBody.innerHTML = '<tr><td colspan="5" class="text-center">No stocks found.</td></tr>'
			return
		}
		for (const s of stocks) {
			const tr = document.createElement('tr')
			tr.innerHTML = `<td>${escapeHtml(s.id)}</td><td>${escapeHtml(s.name || '')}</td><td>$${toFixedSafe(s.price,2)}</td><td>${s.change>=0?'+':''}${toFixedSafe(s.change,2)}</td><td>${escapeHtml(s.sector||'')}</td>`
			stocksTableBody.appendChild(tr)
		}
	}

	async function fetchNewsList() {
		if (!newsListDiv) return
		try {
			const r = await fetch(API_NEWS, { credentials: 'same-origin' })
			if (!r.ok) throw new Error('failed')
			const arr = await r.json()
			renderNewsList(Array.isArray(arr) ? arr : [])
		} catch (err) {
			newsListDiv.innerHTML = '<p class="small-muted">Failed loading news.</p>'
		}
	}

	function renderNewsList(arr) {
		if (!newsListDiv) return
		newsListDiv.innerHTML = ''
		if (!arr || arr.length === 0) {
			newsListDiv.innerHTML = '<p class="small-muted">No news published.</p>'
			return
		}
		for (const n of arr) {
			const d = document.createElement('div')
			d.style.padding = '8px'
			d.style.borderBottom = '1px solid #f0f0f0'
			d.innerHTML = `<strong>${escapeHtml(n.title)}</strong> <span class="small-muted">(${escapeHtml(n.published_at||'')})</span>
				<div class="small-muted">${escapeHtml(n.content||'')}</div>
				<div class="small-muted">Target: ${escapeHtml(n.affected_stock || n.affected_sector || '')} &nbsp; Impact: ${n.impact}</div>`
			newsListDiv.appendChild(d)
		}
	}

	// preview function
	function previewAffectedStocks(targetTypeVal) {
		if (!newsPreview) return
		newsPreview.innerHTML = ''
		const impact = Number(impactInput ? impactInput.value : 0) || 0
		if (targetTypeVal === 'stock') {
			const sid = stockSelectNews ? stockSelectNews.value : ''
			if (!sid) { newsPreview.textContent = '(no stock selected)'; return }
			const s = stocks.find(x => String(x.id).toUpperCase() === String(sid).toUpperCase())
			if (!s) { newsPreview.textContent = '(stock not found)'; return }
			newsPreview.innerHTML = `<div><strong>${escapeHtml(s.id)} — ${escapeHtml(s.name||'')}</strong> &nbsp; Sector: ${escapeHtml(s.sector||'')} &nbsp; Current: $${toFixedSafe(s.price)} &nbsp; Impact: ${impact}</div>`
			return
		}
		const sec = sectorSelectNews ? sectorSelectNews.value : ''
		if (!sec) { newsPreview.textContent = '(no sector selected)'; return }
		const matched = stocks.filter(x => x.sector === sec)
		if (!matched || matched.length === 0) { newsPreview.textContent = '(no stocks in sector)'; return }
		const ul = document.createElement('div')
		for (const s of matched) {
			const newPrice = Number(s.price || 0) * (1 + impact)
			const row = document.createElement('div')
			row.innerHTML = `${escapeHtml(s.id)} — ${escapeHtml(s.name||'')} — current $${toFixedSafe(s.price)} → $${toFixedSafe(newPrice)} (impact ${impact})`
			ul.appendChild(row)
		}
		newsPreview.appendChild(ul)
	}

	// publish news
	async function publishNews(dryRun=false) {
		if (!adminSecret) { setStatus(newsStatus, 'Admin secret required.', true); return }
		const title = (titleInput ? (titleInput.value || '').trim() : '').trim()
		const content = (contentInput ? (contentInput.value || '').trim() : '').trim()
		const type = (targetType ? (targetType.value || 'stock') : 'stock')
		const impact = clamp(Number(impactInput ? impactInput.value : 0) || 0, -0.4, 0.4)
		const source = (sourceSelect ? (sourceSelect.value || '').trim() : '').trim()

		if (!title) { setStatus(newsStatus, 'Title required', true); return }
		if (!content) { setStatus(newsStatus, 'Content required', true); return }
		if (!source) { setStatus(newsStatus, 'Source is required', true); return }
		// decide payload keys
		const payload = {
			title: title,
			content: content,
			impact: impact,
			source: source,
			affected_stock: '',
			affected_sector: ''
		}
		if (type === 'stock') {
			const sid = stockSelectNews ? stockSelectNews.value : ''
			if (!sid) { setStatus(newsStatus, 'Choose a stock target', true); return }
			payload.affected_stock = sid
		} else {
			const sec = sectorSelectNews ? sectorSelectNews.value : ''
			if (!sec) { setStatus(newsStatus, 'Choose a sector', true); return }
			payload.affected_sector = sec
		}

		// i was cooking up smth here, but i gave up
		if (dryRun) {
			previewAffectedStocks(type)
			setStatus(newsStatus, 'Preview generated (no network request).', false)
			return
		}

		try {
			const res = await fetch(ADMIN_PUBLISH_NEWS, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-Admin-Secret': adminSecret
				},
				body: JSON.stringify(payload)
			})
			if (!res.ok) {
				const txt = await res.text().catch(()=> '')
				setStatus(newsStatus, txt || `Publish failed (${res.status})`, true)
				return
			}
			setStatus(newsStatus, 'News published successfully.', false)
			await refreshAll()
		} catch (err) {
			setStatus(newsStatus, `Network error: ${err && err.message ? err.message : String(err)}`, true)
		}
	}
	async function runStockAction(dryRun=false) {
		if (!adminSecret) { setStatus(actionStatus, 'Admin secret required.', true); return }
		const sid = (actionStockSelect ? (actionStockSelect.value || '').trim() : '')
		const action = (actionType ? (actionType.value || 'tank') : 'tank')
		let magnitude = Number(actionMag ? actionMag.value : 0) || 0
		magnitude = clamp(magnitude, 0, 0.4)

		if (!sid) { setStatus(actionStatus, 'Choose a stock', true); return }

		if (dryRun) {
			const s = stocks.find(x => String(x.id).toUpperCase() === String(sid).toUpperCase())
			if (!s) { setStatus(actionStatus, 'Stock not found', true); return }
			let newPrice = s.price
			if (action === 'tank') newPrice = s.price * (1 - magnitude)
			else newPrice = s.price * (1 + magnitude)
			setStatus(actionStatus, `${s.id} preview: $${toFixedSafe(s.price)} → $${toFixedSafe(newPrice)} (action ${action} ${magnitude})`, false)
			return
		}

		const payload = { stock_id: sid, action: action, magnitude: magnitude }
		try {
			const res = await fetch(ADMIN_STOCK_ACTION, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-Admin-Secret': adminSecret
				},
				body: JSON.stringify(payload)
			})
			if (!res.ok) {
				const txt = await res.text().catch(()=>'')
				setStatus(actionStatus, txt || `Action failed (${res.status})`, true)
				return
			}
			setStatus(actionStatus, 'Action executed', false)
			await refreshAll()
		} catch (err) {
			setStatus(actionStatus, `Network error: ${err && err.message ? err.message : String(err)}`, true)
		}
	}
	async function updateCompetitionCapacity() {
		if (!adminSecret) { setStatus(competitionStatus, 'Admin secret required.', true); return }
		const capacity = (maxParticipantsInput ? (maxParticipantsInput.value || '').trim() : '')
		if (!capacity) { setStatus(competitionStatus, 'Enter a capacity', true); return }

		const payload = { capacity: Number(capacity) }
		try {
			const res = await fetch(ADMIN_COMPETITION_UPDATE, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-Admin-Secret': adminSecret
				},
				body: JSON.stringify(payload)
			})
			if (!res.ok) {
				const txt = await res.text().catch(()=>'')
				setStatus(competitionStatus, txt || `Update failed (${res.status})`, true)
				return
			}
			setStatus(competitionStatus, 'Competition capacity updated', false)
			await refreshAll()
		} catch (err) {
			setStatus(competitionStatus, `Network error: ${err && err.message ? err.message : String(err)}`, true)
		}
	}

	if (targetType) {
		targetType.addEventListener('change', () => {
			if (targetType.value === 'sector') {
				if (stockSelectNews) stockSelectNews.style.display = 'none'
				if (sectorSelectNews) sectorSelectNews.style.display = ''
			} else {
				if (stockSelectNews) stockSelectNews.style.display = ''
				if (sectorSelectNews) sectorSelectNews.style.display = 'none'
			}
			previewAffectedStocks(targetType.value)
		})
	}
	if (stockSelectNews) stockSelectNews.addEventListener('change', () => previewAffectedStocks('stock'))
	if (sectorSelectNews) sectorSelectNews.addEventListener('change', () => previewAffectedStocks('sector'))
	if (impactInput) impactInput.addEventListener('input', () => previewAffectedStocks(targetType ? targetType.value : 'stock'))
	if (publishBtn) publishBtn.addEventListener('click', (ev) => { ev.preventDefault(); publishNews(false) })
	if (actionPreview) actionPreview.addEventListener('click', (ev) => { ev.preventDefault(); runStockAction(true) })
	if (actionRun) actionRun.addEventListener('click', (ev) => { ev.preventDefault(); runStockAction(false) })
	if (capacityBtn) capacityBtn.addEventListener('click', (ev) => { ev.preventDefault(); updateCompetitionCapacity() })

	if (secretSubmit) {
		secretSubmit.addEventListener('click', (ev) => {
			ev.preventDefault()
			const s = (secretInput ? (secretInput.value || '') : '').trim()
			if (!s) { if (secretMsg) setStatus(secretMsg, 'Please enter admin secret', true); return }
			if (secretMsg) setStatus(secretMsg, 'Verifying...')
			verifySecretAndUnlock(s)
		})
	}
	if (secretCancel) {
		secretCancel.addEventListener('click', (ev) => {
			ev.preventDefault()
			if (secretInput) secretInput.value = ''
		})
	}
	if (logoutBtn) {
		logoutBtn.addEventListener('click', (ev) => {
			ev.preventDefault()
			adminSecret = null
			clearAdminSecret()
			try { localStorage.setItem('stocksim_admin_last_cleared', String(Date.now())) } catch (e) {}
			if (overlay) showOverlay()
		})
	}

	// refresh stocks and news
	async function refreshAll() {
		await loadSources()
		await fetchStocks()
		await fetchNewsList()
	}

	(async function boot() {
		await loadSources()
		let stored = null
		try { stored = localStorage.getItem(LS_KEY) } catch (e) { stored = null }
		if (stored) {
			if (secretMsg) setStatus(secretMsg, 'Verifying stored admin secret...')
			const ok = await verifySecretAndUnlock(stored)
			if (!ok) {
				clearAdminSecret()
				if (overlay) showOverlay()
			}
			return
		}

		if (overlay) showOverlay()
		await fetchStocks()
		await fetchNewsList()
	})()
})();