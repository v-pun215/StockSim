(() => {
	const LS_KEY = 'stocksim_admin_secret'
	const NAV_LINK_ID = 'nav-admin-link'

	function ensureAdminLink() {
		const links = document.querySelector('.links')
		if (!links) return

		try {
			const secret = localStorage.getItem(LS_KEY)
			const exists = document.getElementById(NAV_LINK_ID)
			if (secret && !exists) {
				const a = document.createElement('a')
				a.id = NAV_LINK_ID
				a.href = '/admin.html'
				a.textContent = 'Admin'
				links.appendChild(a)
			} else if (!secret && exists) {
				exists.remove()
			}
		} catch (e) {
		}
	}

	document.addEventListener('DOMContentLoaded', () => {
		ensureAdminLink()
		setTimeout(ensureAdminLink, 300)
	})

	window.addEventListener('storage', (ev) => {
		if (ev.key === LS_KEY || ev.key === 'stocksim_admin_last_verified' || ev.key === 'stocksim_admin_last_cleared') {
			// small debounce
			setTimeout(ensureAdminLink, 50)
		}
	})
})();