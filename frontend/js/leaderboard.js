(() => {
	const TEAM_ENDPOINT = '/api/teams/leaderboard'
	const INDIV_ENDPOINT = '/api/leaderboard'
	const TEAMS_ENDPOINT = '/api/teams'
	const REFRESH_INTERVAL_MS = 30 * 1000

	const fmtCurrency = (v) => {
		if (v === null || v === undefined) return '-'
		try {
			return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(v))
		} catch (e) {
			return '$' + Number(v || 0).toFixed(2)
		}
	}

	const escapeHtml = (s) => {
		if (s === null || s === undefined) return ''
		return String(s).replace(/[&<>"'`=\/]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;' }[c]))
	}

	const emptyRow = (colspan, text) => {
		const tr = document.createElement('tr')
		tr.innerHTML = `<td colspan="${colspan}" class="text-center">${escapeHtml(text)}</td>`
		return tr
	}

	let teamTable = null
	let individualTable = null
	document.querySelectorAll('.home-card').forEach(card => {
		const h2 = card.querySelector('h2')
		const tbl = card.querySelector('table')
		if (!h2 || !tbl) return
		const key = h2.textContent.trim().toLowerCase()
		if (key.indexOf('team') !== -1) teamTable = tbl
		if (key.indexOf('individual') !== -1 || key.indexOf('user') !== -1) individualTable = tbl
	})

	const allTables = Array.from(document.querySelectorAll('table'))
	if (!teamTable && allTables[0]) teamTable = allTables[0]
	if (!individualTable && allTables[1]) individualTable = allTables[1]
	if (!teamTable && !individualTable) {
		console.error('leaderboard.js: could not find leaderboard tables on page')
		return
	}

	const teamTbody = teamTable ? teamTable.querySelector('tbody') : null
	const indivTbody = individualTable ? individualTable.querySelector('tbody') : null

	async function fetchJsonArray(endpoint) {
		const res = await fetch(endpoint, { credentials: 'same-origin' })
		if (!res.ok) throw new Error('fetch failed ' + endpoint + ' status ' + res.status)
		const j = await res.json()
		if (!Array.isArray(j)) throw new Error('expected array from ' + endpoint)
		return j
	}

	function clearAndSetLoading(tbody) {
		if (!tbody) return
		tbody.innerHTML = ''
		const cols = (tbody.parentElement.querySelectorAll('th') || []).length || 4
		tbody.appendChild(emptyRow(cols, 'Loading...'))
	}

	function renderIndividualTable(arr) {
		if (!indivTbody) return
		indivTbody.innerHTML = ''
		if (!arr || arr.length === 0) {
			indivTbody.appendChild(emptyRow(4, 'No individual entries yet ¯\\_(ツ)_/¯'))
			return
		}
		for (let i = 0; i < arr.length; i++) {
			const raw = arr[i]
			const rank = raw.rank
			const username = raw.username
			const teamName = raw.team_name
			const networth = raw.networth
			const tr = document.createElement('tr')
			tr.innerHTML = `
				<td>${escapeHtml(String(rank))}</td>
				<td>${escapeHtml(String(username || ''))}</td>
				<td>${escapeHtml(String(teamName || '-'))}</td>
				<td>${escapeHtml(fmtCurrency(networth))}</td>
			`
			indivTbody.appendChild(tr)
		}
	}

	function renderTeamTable(arr) {
		if (!teamTbody) return
		teamTbody.innerHTML = ''
		if (!arr || arr.length === 0) {
			teamTbody.appendChild(emptyRow(4, 'No teams yet ¯\\_(ツ)_/¯'))
			return
		}
		for (let i = 0; i < arr.length; i++) {
			const row = arr[i]
			const tr = document.createElement('tr')
			tr.innerHTML = `
				<td>${escapeHtml(String(row.rank))}</td>
				<td>${escapeHtml(String(row.team_name || row.name || ''))}</td>
				<td>${escapeHtml(String(row.top_member || ''))}</td>
				<td>${escapeHtml(fmtCurrency(row.top_networth))}</td>
			`
			teamTbody.appendChild(tr)
		}
	}

	async function refreshOnce() {
		if (indivTbody) clearAndSetLoading(indivTbody)
		if (teamTbody) clearAndSetLoading(teamTbody)

		const pTeams = fetchJsonArray(TEAMS_ENDPOINT).then(v => ({ ok: true, value: v })).catch(e => ({ ok: false, error: e }))
		const pTeamBoard = fetchJsonArray(TEAM_ENDPOINT).then(v => ({ ok: true, value: v })).catch(e => ({ ok: false, error: e }))
		const pIndiv = fetchJsonArray(INDIV_ENDPOINT).then(v => ({ ok: true, value: v })).catch(e => ({ ok: false, error: e }))

		const [teamsRes, teamBoardRes, indivRes] = await Promise.all([pTeams, pTeamBoard, pIndiv])

		let indivData = null
		if (indivRes.ok) indivData = indivRes.value
		if (indivData) renderIndividualTable(indivData)
		else if (indivTbody) {
			indivTbody.innerHTML = ''
			indivTbody.appendChild(emptyRow(4, 'Could not fetch individual leaderboard.'))
		}

		let teamsToRender = null

		if (teamsRes.ok) {
			const teamsArr = teamsRes.value
			const topMap = {}
			for (let i = 0; i < teamsArr.length; i++) {
				const t = teamsArr[i]
				const id = t.id
				let topName = ''
				let topNet = 0
				if (Array.isArray(t.members) && t.members.length > 0) {
					for (let m = 0; m < t.members.length; m++) {
						const mem = t.members[m]
						const n = Number(mem.networth)
						if (m === 0 || n > topNet) {
							topNet = n
							topName = mem.username
						}
					}
				}
				topMap[String(id)] = { topName: topName, topNet: topNet }
			}
			if (teamBoardRes.ok) {
				const tb = teamBoardRes.value
				const out = []
				for (let i = 0; i < tb.length; i++) {
					const r = tb[i]
					const id = r.team_id
					let top_member = ''
					let top_networth = 0
					if (topMap[String(id)] !== undefined) {
						top_member = topMap[String(id)].topName
						top_networth = topMap[String(id)].topNet
					} else if (r.top_member !== undefined && r.top_networth !== undefined) {
						top_member = r.top_member
						top_networth = Number(r.top_networth)
					} else if (indivData) {
						let maxN = 0
						let maxName = ''
						for (let j = 0; j < indivData.length; j++) {
							const u = indivData[j]
							if (u.team_name === r.team_name) {
								const nn = Number(u.networth)
								if (maxName === '' || nn > maxN) {
									maxN = nn
									maxName = u.username
								}
							}
						}
						top_member = maxName
						top_networth = maxN
					}
					out.push({
						team_id: id,
						team_name: r.team_name,
						member_count: r.member_count,
						top_member: top_member,
						top_networth: top_networth
					})
				}
				out.sort((a, b) => Number(b.top_networth) - Number(a.top_networth))
				for (let i = 0; i < out.length; i++) out[i].rank = i + 1
				teamsToRender = out
			} else {
				const out = []
				for (let i = 0; i < teamsArr.length; i++) {
					const t = teamsArr[i]
					const id = t.id
					const tm = topMap[String(id)]
					const top_member = tm ? tm.topName : ''
					const top_networth = tm ? Number(tm.topNet) : 0
					out.push({
						team_id: id,
						team_name: t.name,
						member_count: t.member_count,
						top_member: top_member,
						top_networth: top_networth
					})
				}
				out.sort((a, b) => Number(b.top_networth) - Number(a.top_networth))
				for (let i = 0; i < out.length; i++) out[i].rank = i + 1
				teamsToRender = out
			}
		} else if (teamBoardRes.ok) {
			const tb = teamBoardRes.value
			const out = []
			for (let i = 0; i < tb.length; i++) {
				const r = tb[i]
				let top_member = ''
				let top_networth = 0
				if (r.top_member !== undefined && r.top_networth !== undefined) {
					top_member = r.top_member
					top_networth = Number(r.top_networth)
				} else if (indivData) {
					let maxN = 0
					let maxName = ''
					for (let j = 0; j < indivData.length; j++) {
						const u = indivData[j]
						if (u.team_name === r.team_name) {
							const nn = Number(u.networth)
							if (maxName === '' || nn > maxN) {
								maxN = nn
								maxName = u.username
							}
						}
					}
					top_member = maxName
					top_networth = maxN
				}
				out.push({
					team_id: r.team_id,
					team_name: r.team_name,
					member_count: r.member_count,
					top_member: top_member,
					top_networth: top_networth
				})
			}
			out.sort((a, b) => Number(b.top_networth) - Number(a.top_networth))
			for (let i = 0; i < out.length; i++) out[i].rank = i + 1
			teamsToRender = out
		} else {
			teamsToRender = []
		}

		if (teamTbody) {
			if (!teamsToRender || teamsToRender.length === 0) {
				teamTbody.innerHTML = ''
				teamTbody.appendChild(emptyRow(4, 'No teams yet ¯\\_(ツ)_/¯'))
			} else {
				renderTeamTable(teamsToRender)
			}
		}
	}

	;(function boot() {
		refreshOnce().catch(err => console.error('leaderboard refresh error', err))
		setInterval(() => { refreshOnce().catch(err => console.error('leaderboard refresh error', err)) }, REFRESH_INTERVAL_MS)
	})()

	window.LeaderboardAPI = { refresh: refreshOnce }
})()