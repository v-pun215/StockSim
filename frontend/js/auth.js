(function () {
	const API_BASE = ''
	const MAX_USERNAME_LEN = 64
  const FETCH_CREDENTIALS = 'include'

	function log() { try { console.log.apply(console, ['[auth]'].concat(Array.prototype.slice.call(arguments))) } catch (e) {} }

	async function getMe() {
		try {
			const res = await fetch(`${API_BASE}/api/auth/me`, { method: 'GET', credentials: 'same-origin' })
			if (res.status === 200) return await res.json()
			return null
		} catch (e) {
			log('getMe error', e)
			return null
		}
	}

	async function getTeams() {
		try {
			const res = await fetch(`${API_BASE}/api/teams`, { method: 'GET', credentials: 'same-origin' })
			if (!res.ok) return []
			const arr = await res.json()
			return Array.isArray(arr) ? arr : []
		} catch (e) {
			log('getTeams error', e)
			return []
		}
	}

	async function signup(payload) {
		const res = await fetch(`${API_BASE}/api/auth/signup`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		})
		if (!res.ok) {
			const txt = await res.text()
			throw new Error(txt || `signup failed ${res.status}`)
		}
		return await res.json()
	}

	async function logout() {
		const endpoints = ['/api/auth/signout', '/api/auth/logout', '/api/auth/sign_out']
		for (const ep of endpoints) {
			try {
				const res = await fetch(API_BASE + ep, { method: 'POST', credentials: 'same-origin' })
				if (res.ok) break
			} catch (e) {}
		}
		try { localStorage.removeItem('stocksim_username') } catch (e) {}
		window.CURRENT_USER = null
		closeAccountPopup()
		window.location.reload()
	}

	function escapeHtml(s) {
		return String(s || '').replace(/[&<>"'`=\/]/g, function (c) {
			return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;' }[c]
		})
	}

	function updateNavUsername(name) {
		const nav = document.getElementById('username-display-nav') || document.querySelector('.nav-right a')
		if (nav) nav.textContent = name || 'Sign in'
		const popupName = document.getElementById('username-display')
		if (popupName) popupName.textContent = name || ''
	}

	function createAccountPopupInDOM() {
		if (document.querySelector('.overlay.account-popup-inserted')) return
		const overlay = document.createElement('div')
		overlay.className = 'overlay account-popup-inserted'
		overlay.style.display = 'none'
		overlay.setAttribute('aria-hidden', 'true')

		const popup = document.createElement('div')
		popup.className = 'account-popup'

		const closeDiv = document.createElement('div')
		closeDiv.className = 'close-btn-div'
		const closeBtn = document.createElement('button')
		closeBtn.id = 'close-btn'
		closeBtn.type = 'button'
		closeBtn.textContent = '✕'
		closeDiv.appendChild(closeBtn)

		const topDiv = document.createElement('div')
		topDiv.className = 'top'
		const p = document.createElement('p')
		p.innerHTML = 'Logged in as: <span id="username-display">username</span>'
		const adminBtn = document.createElement('button')
		adminBtn.id = 'admin'
		adminBtn.type = 'button'
		adminBtn.textContent = 'Admin'
		const logoutBtn = document.createElement('button')
		logoutBtn.id = 'logout'
		logoutBtn.type = 'button'
		logoutBtn.textContent = 'Logout'

		topDiv.appendChild(p)
		topDiv.appendChild(adminBtn)
		topDiv.appendChild(logoutBtn)

		popup.appendChild(closeDiv)
		popup.appendChild(topDiv)
		overlay.appendChild(popup)
		document.body.appendChild(overlay)

		closeBtn.addEventListener('click', function (e) { e.preventDefault(); closeAccountPopup() })
		logoutBtn.addEventListener('click', async function (e) { e.preventDefault(); await logout() })
		adminBtn.addEventListener('click', function (e) { e.preventDefault(); gotoadmin() })
		overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeAccountPopup() })
		document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeAccountPopup() })
	}

	function gotoadmin() {
		window.location.href = 'admin.html';
	}

	function showAccountPopup() {
		const popup = document.querySelector('.overlay.account-popup-inserted')
		if (!popup) return
		popup.style.display = 'flex'
		popup.setAttribute('aria-hidden', 'false')
		const usernameEl = document.getElementById('username-display')
		if (window.CURRENT_USER && usernameEl) usernameEl.textContent = window.CURRENT_USER.username || ''
	}

	function closeAccountPopup() {
		const popup = document.querySelector('.overlay.account-popup-inserted')
		if (!popup) return
		popup.style.display = 'none'
		popup.setAttribute('aria-hidden', 'true')
	}

	function initNavBinding() {
		const navAnchor = document.getElementById('username-display-nav') || document.querySelector('.nav-right a')
		if (!navAnchor) return
		navAnchor.addEventListener('click', async function (ev) {
			ev.preventDefault()
			let me = window.CURRENT_USER || await getMe()
			if (me) {
				window.CURRENT_USER = me
				updateNavUsername(me.username || '')
				showAccountPopup()
				return
			}
			const created = await showSignInModal()
			if (created) {
				window.CURRENT_USER = created
				updateNavUsername(created.username || '')
				showAccountPopup()
			}
		})
	}

	function buildSignInDialog() {
		const overlay = document.createElement('div')
		overlay.id = 'signin-modal-overlay'
		overlay.className = 'overlay signin-overlay'
		overlay.style.display = 'flex'
		overlay.style.alignItems = 'center'
		overlay.style.justifyContent = 'center'
		overlay.style.position = 'fixed'
		overlay.style.inset = '0'
		overlay.style.zIndex = '9999'
		overlay.style.background = 'rgba(0,0,0,0.45)'

		const dialog = document.createElement('div')
		dialog.className = 'signin-dialog'
		dialog.style.width = 'min(720px, 96vw)'
		dialog.style.maxWidth = '720px'
		dialog.style.background = '#fff'
		dialog.style.borderRadius = '10px'
		dialog.style.padding = '20px'
		dialog.style.boxShadow = '0 12px 40px rgba(0,0,0,0.25)'
		dialog.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial'

		dialog.innerHTML = `
			<h2 style="margin:0 0 8px 0;">Sign in</h3>
			<p style="margin:0 0 12px 0;color:#444">Username and team are required. Choose an existing team or create one.</p>
			<form id="signin-form" style="display:flex;flex-direction:column;gap:12px;">
				<label style="font-size:13px;color:#333">
					Username
					<input id="signin-username" name="username" type="text" maxlength="${MAX_USERNAME_LEN}" placeholder="Enter username" required
						style="width:100%;padding:8px;margin-top:6px;border-radius:6px;border:1px solid #ddd;">
				</label>
				<div style="display:flex;gap:12px;align-items:center;">
					<label><input type="radio" name="team_mode" value="choose" checked> Choose team</label>
					<label><input type="radio" name="team_mode" value="create"> Create team</label>
				</div>
				<div id="choose-team-row">
					<label style="font-size:13px;color:#333">
						Choose an existing team
						<select id="signin-team-select" style="width:100%;padding:8px;margin-top:6px;border-radius:6px;border:1px solid #ddd;">
							<option value="">Loading teams...</option>
						</select>
					</label>
					<small style="color:#666">Or enter a Team ID manually</small>
					<input id="signin-team-id" type="number" placeholder="Team ID (optional)" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ddd;">
				</div>
				<div id="create-team-row" style="display:none;">
					<label style="font-size:13px;color:#333">
						New team name
						<input id="signin-team-name" name="team_name" type="text" maxlength="64" placeholder="Team name (1-64 chars)"
							style="width:100%;padding:8px;margin-top:6px;border-radius:6px;border:1px solid #ddd;">
					</label>
				</div>
				<div id="signin-error" style="color:#b00020;font-size:13px;min-height:18px;"></div>
				<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
					<button id="signin-submit" type="submit" class="nav-btn btn-primary">Sign in</button>
				</div>
			</form>
		`

		overlay.appendChild(dialog)
		return { overlay, dialog }
	}

	async function showSignInModal() {
		return new Promise(async (resolve) => {
			const existing = document.getElementById('signin-modal-overlay')
			if (existing) existing.remove()
			const built = buildSignInDialog()
			document.body.appendChild(built.overlay)

			const form = built.dialog.querySelector('#signin-form')
			const usernameInput = built.dialog.querySelector('#signin-username')
			const chooseRow = built.dialog.querySelector('#choose-team-row')
			const createRow = built.dialog.querySelector('#create-team-row')
			const teamSelect = built.dialog.querySelector('#signin-team-select')
			const teamIdInput = built.dialog.querySelector('#signin-team-id')
			const teamNameInput = built.dialog.querySelector('#signin-team-name')
			const errorBox = built.dialog.querySelector('#signin-error')

			function setMode(mode) {
				chooseRow.style.display = mode === 'choose' ? 'block' : 'none'
				createRow.style.display = mode === 'create' ? 'block' : 'none'
			}

			built.dialog.querySelectorAll('input[name="team_mode"]').forEach(r => {
				r.addEventListener('change', (e) => setMode(e.target.value))
			})

			;(async () => {
				const teams = await getTeams()
				if (!teams || teams.length === 0) {
					teamSelect.innerHTML = '<option value="">(no teams available)</option>'
					const radioCreate = built.dialog.querySelector('input[value="create"]')
					if (radioCreate) { radioCreate.checked = true; setMode('create') }
					return
				}
				teams.sort((a, b) => (String(a.name || '')).localeCompare(String(b.name || '')))
				const opts = ['<option value="">Pick a team</option>']
				for (const t of teams) {
					const id = t.id || t.ID || t.team_id || ''
					const name = t.name || '(no-name)'
					const members = (t.members !== undefined) ? t.members : (t.MemberCount !== undefined ? t.MemberCount : '')
					opts.push(`<option value="${escapeHtml(String(id))}">${escapeHtml(String(id))}. ${escapeHtml(String(name))}</option>`)
				}
				teamSelect.innerHTML = opts.join('')
			})()

			try { const saved = localStorage.getItem('stocksim_username'); if (saved) usernameInput.value = saved } catch (e) {}

			form.addEventListener('submit', async (ev) => {
				ev.preventDefault()
				errorBox.textContent = ''
				const username = String(usernameInput.value || '').trim()
				if (!username || username.length === 0 || username.length > MAX_USERNAME_LEN) {
					errorBox.textContent = 'Username required (1–64 chars).'
					usernameInput.focus()
					return
				}
				const mode = (built.dialog.querySelector('input[name="team_mode"]:checked') || {}).value || 'choose'
				const payload = { username: username }
				if (mode === 'create') {
					const tname = String(teamNameInput.value || '').trim()
					if (!tname || tname.length === 0 || tname.length > 64) {
						errorBox.textContent = 'Team name required (1–64 chars).'
						teamNameInput.focus()
						return
					}
					payload.team_action = 'create'
					payload.team_name = tname
				} else {
					let teamID = null
					const explicitID = String(teamIdInput.value || '').trim()
					if (explicitID) {
						const nid = parseInt(explicitID, 10)
						if (!Number.isNaN(nid) && nid > 0) teamID = nid
						else { errorBox.textContent = 'Invalid Team ID.'; teamIdInput.focus(); return }
					} else {
						const sel = String(teamSelect.value || '').trim()
						if (sel) {
							const nid = parseInt(sel, 10)
							if (!Number.isNaN(nid) && nid > 0) teamID = nid
						}
					}
					if (!teamID) { errorBox.textContent = 'You must choose an existing team or enter its ID.'; teamSelect.focus(); return }
					payload.team_action = 'join'
					payload.team_id = teamID
				}
				try {
					const created = await signup(payload)
					try { localStorage.setItem('stocksim_username', payload.username) } catch (e) {}
					built.overlay.remove()
					resolve(created)
				} catch (err) {
					errorBox.textContent = String(err.message || err)
				}
			})

			usernameInput.focus()
		})
	}

	async function ensureUser() {
		const existing = await getMe()
		if (existing) {
			window.CURRENT_USER = existing
			updateNavUsername(existing.username || '')
			return existing
		}
		while (true) {
			const created = await showSignInModal()
			if (created) {
				window.CURRENT_USER = created
				updateNavUsername(created.username || '')
				return created
			}
		}
	}

	document.addEventListener('DOMContentLoaded', function () {
		createAccountPopupInDOM()
		initNavBinding()
		ensureUser().catch(e => log('ensureUser failed', e))
	})

	window.authDebug = { getMe, getTeams, signup, ensureUser, logout, showSignInModal }
})()