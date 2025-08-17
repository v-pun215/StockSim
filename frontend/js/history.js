(() => {
	'use strict';

	const API_TRANSACTIONS = '/api/transactions?limit=200';
	const POLL_INTERVAL_MS = 60 * 1000; // refresh every 60s

	function $ (sel) { return document.querySelector(sel); }
	function byId (id) { return document.getElementById(id); }

	function escapeHtml(s) {
		if (s === null || s === undefined) return '';
		return String(s).replace(/[&<>"'`=\/]/g, (c) => {
			return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;' }[c];
		});
	}

	const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

	function fmtMoney(n) {
		const num = Number(n || 0);
		if (!Number.isFinite(num)) return '$0.00';
		return currencyFmt.format(num);
	}

	function makeCell(txt, cls) {
		const td = document.createElement('td');
		if (cls) td.className = cls;
		td.innerHTML = escapeHtml(txt);
		return td;
	}

	function emptyRow(colspan, text) {
		const tr = document.createElement('tr');
		tr.innerHTML = `<td colspan="${colspan}" class="text-center">${escapeHtml(text)}</td>`;
		return tr;
	}

	async function fetchAndRender(tbody) {
		// show loading
		tbody.innerHTML = '';
		tbody.appendChild(emptyRow(6, 'Loading transactions…'));

		try {
			const res = await fetch(API_TRANSACTIONS, { credentials: 'same-origin' });

			if (res.status === 401) {
				tbody.innerHTML = '';
				tbody.appendChild(emptyRow(6, 'Not signed in — please sign in to view your transactions.'));
				return;
			}
			if (!res.ok) {
				let msg = `Failed to load transactions (${res.status})`;
				try { const t = await res.text(); if (t) msg = t; } catch (e) {}
				tbody.innerHTML = '';
				tbody.appendChild(emptyRow(6, msg));
				return;
			}

			const data = await res.json();
			if (!Array.isArray(data) || data.length === 0) {
				tbody.innerHTML = '';
				tbody.appendChild(emptyRow(6, 'No transactions yet.'));
				return;
			}


			tbody.innerHTML = '';
			for (const tx of data) {
				const tr = document.createElement('tr');
				let ts = tx.timestamp || tx.time || tx.created_at || '';
				const sym = tx.stock_id || tx.stock || tx.symbol || '';

				const action = (tx.action || '').toString();
				const actionCls = (/^sell$/i.test(action) ? 'neg' : (/^buy$/i.test(action) ? 'pos' : ''));
				const shares = Number(tx.shares || 0) || 0;
				const price = Number(tx.price || 0);
				const total = Number(tx.total || (price * shares) || 0);

				tr.appendChild(makeCell(ts));
				tr.appendChild(makeCell(sym));
				tr.appendChild(makeCell(action, actionCls));
				tr.appendChild(makeCell(String(shares)));
				tr.appendChild(makeCell(fmtMoney(price)));
				tr.appendChild(makeCell(fmtMoney(total)));

				tbody.appendChild(tr);
			}
		} catch (err) {
			tbody.innerHTML = '';
			tbody.appendChild(emptyRow(6, 'Error loading transactions.'));
			console.error('history.js fetch error', err);
		}
	}

	document.addEventListener('DOMContentLoaded', () => {
		const table = byId('transactionHistoryTable');
		if (!table) return;
		const tbody = table.querySelector('tbody');
		if (!tbody) return;


		fetchAndRender(tbody);

		setInterval(() => fetchAndRender(tbody), POLL_INTERVAL_MS);
	});
})();