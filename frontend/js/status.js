const headingEl = document.querySelector('.home-card.status .heading');
const timerEl = document.querySelector('.home-card.status .timer');
const compStartEl = document.getElementById('comp-start');
const compEndEl = document.getElementById('comp-end');

let startTime = null;
let endTime = null;
let statusInterval = null;
let hiddenNavAnchors = [];
let hiddenPageElems = [];

function isIndexPage() {
	try {
		const p = location.pathname || '';
		if (p === '/' || p === '' || p.endsWith('/index.html') || p.endsWith('/index.htm')) return true;
		// treat root slash as index
		if (p === '/') return true;
		return false;
	} catch (e) {
		return false;
	}
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatDuration(ms) {
	if (!ms || ms < 0) ms = 0;
	let totalSeconds = Math.floor(ms / 1000);
	let hours = pad(Math.floor(totalSeconds / 3600));
	let minutes = pad(Math.floor((totalSeconds % 3600) / 60));
	let seconds = pad(totalSeconds % 60);
	return `${hours}:${minutes}:${seconds}`;
}

function formatDateTime(d) {
	if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
	const year = d.getFullYear();
	const month = pad(d.getMonth() + 1);
	const day = pad(d.getDate());
	const hours = pad(d.getHours());
	const mins = pad(d.getMinutes());
	return `${year}-${month}-${day} ${hours}:${mins}`;
}

function hideNavExceptHome() {
	const navLinksContainer = document.querySelector('nav .links');
	if (!navLinksContainer) return;
	const anchors = Array.from(navLinksContainer.querySelectorAll('a'));
	for (const a of anchors) {
		const txt = (a.textContent || '').trim().toLowerCase();
		const href = (a.getAttribute && a.getAttribute('href')) || '';
		const isHomeText = txt === 'home';
		const isHomeHref = href === '/' || href.endsWith('/index.html') || href.endsWith('/index.htm') || href === '' || href === './' || href === './index.html';
		if (!isHomeText && !isHomeHref) {
			if (!a.dataset.stocksimHidden) {
				a.dataset.stocksimHidden = a.style.display || '';
				a.style.display = 'none';
				hiddenNavAnchors.push(a);
			}
		}
	}
}

function restoreNav() {
	if (!hiddenNavAnchors || hiddenNavAnchors.length === 0) return;
	for (const a of hiddenNavAnchors) {
		try {
			a.style.display = a.dataset.stocksimHidden || '';
			delete a.dataset.stocksimHidden;
		} catch (e) {}
	}
	hiddenNavAnchors = [];
}

function hidePageContent() {
	const bodyChildren = Array.from(document.body.children);
	for (const el of bodyChildren) {
		const tag = (el.tagName || '').toUpperCase();
		if (tag === 'NAV' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'TITLE' || tag === 'HEAD') {
			continue;
		}
		// skip if already hidden by us
		if (el.dataset && el.dataset.stocksimHiddenElem) continue;
		// store previous inline display and visibility
		try {
			el.dataset.stocksimHiddenElem = '1';
			el.dataset.stocksimPrevDisplay = el.style.display || '';
			el.dataset.stocksimPrevVisibility = el.style.visibility || '';
			el.style.display = 'none';
			el.style.visibility = 'hidden';
			hiddenPageElems.push(el);
		} catch (e) {}
	}
}

function restorePageContent() {
	if (!hiddenPageElems || hiddenPageElems.length === 0) return;
	for (const el of hiddenPageElems) {
		try {
			el.style.display = el.dataset.stocksimPrevDisplay || '';
			el.style.visibility = el.dataset.stocksimPrevVisibility || '';
			delete el.dataset.stocksimHiddenElem;
			delete el.dataset.stocksimPrevDisplay;
			delete el.dataset.stocksimPrevVisibility;
		} catch (e) {}
	}
	hiddenPageElems = [];
}

function applyLockdown(locked, stateLabel) {
	if (locked) {
		hideNavExceptHome();
		if (!isIndexPage()) {
			hidePageContent();
		} else {
			restorePageContent();
		}
	} else {
		restoreNav();
		restorePageContent();
	}
}

function updateTimer() {
	const now = Date.now();

	if (!startTime || !endTime) {
		if (headingEl) headingEl.textContent = 'Competition status';
		if (timerEl) timerEl.textContent = '--:--:--';
		return;
	}

	if (now < startTime) {
		if (headingEl) headingEl.textContent = 'Starts in';
		if (timerEl) timerEl.textContent = formatDuration(startTime - now);
		applyLockdown(true, 'notstarted');
	} else if (now >= startTime && now <= endTime) {
		if (headingEl) headingEl.textContent = 'Time left';
		if (timerEl) timerEl.textContent = formatDuration(endTime - now);
		applyLockdown(false);
	} else {
		if (headingEl) headingEl.textContent = 'Competition ended';
		if (timerEl) timerEl.textContent = '00:00:00';
		applyLockdown(true, 'ended');
		if (statusInterval) {
			clearInterval(statusInterval);
			statusInterval = null;
		}
	}
}

async function fetchStatus() {
	try {
		const res = await fetch('/api/status');
		if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
		const data = await res.json();

		startTime = new Date(data.start).getTime();
		endTime = new Date(data.end).getTime();

		if (compStartEl) compStartEl.textContent = formatDateTime(new Date(startTime));
		if (compEndEl) compEndEl.textContent = formatDateTime(new Date(endTime));

		updateTimer();

		if (statusInterval) clearInterval(statusInterval);
		statusInterval = setInterval(updateTimer, 1000);
	} catch (err) {
		console.error('Error fetching status:', err);
		if (headingEl) headingEl.textContent = 'Error loading status';
		if (timerEl) timerEl.textContent = '--:--:--';
		hideNavExceptHome();
	}
}

try {
	fetchStatus();
} catch (e) {
	console.error('status.js init error', e);
}