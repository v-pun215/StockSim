(() => {
	document.addEventListener('DOMContentLoaded', () => {
		const orderDivs = Array.from(document.querySelectorAll('.order-div'));
		if (!orderDivs || orderDivs.length === 0) return;

		orderDivs.forEach(div => {
			const tabWrap = div.querySelector('.button-tabs');
			if (!tabWrap) return;

			const buyBtn = tabWrap.querySelector('.buy-button');
			const sellBtn = tabWrap.querySelector('.sell-button');
			const buyForm = div.querySelector('.order-form-buy');
			const sellForm = div.querySelector('.order-form-sell');

			if (!buyBtn || !sellBtn || !buyForm || !sellForm) return;

			function showBuy() {
				buyBtn.classList.add('selectede');
				sellBtn.classList.remove('selectede');
				buyForm.style.display = '';
				sellForm.style.display = 'none';
			}

			function showSell() {
				sellBtn.classList.add('selectede');
				buyBtn.classList.remove('selectede');
				sellForm.style.display = '';
				buyForm.style.display = 'none';
				// grab fresh share count when switching to sell
				const sym = getSelectedSymbol();
				if (sym) {
					fetchOwnedSharesForSymbol(sym).then(n => {
						if (n !== null) setOwnedShares(n);
					});
				}
			}

			buyBtn.addEventListener('click', (ev) => {
				ev.preventDefault();
				showBuy();
			});
			sellBtn.addEventListener('click', (ev) => {
				ev.preventDefault();
				showSell();
			});

			if (buyBtn.classList.contains('selectede')) showBuy();
			else if (sellBtn.classList.contains('selectede')) showSell();
			else showBuy();

			// live cost calculation as user types
			const shareInputs = Array.from(div.querySelectorAll('input[name="shares"], input#shares'));
			const estimatedEls = Array.from(div.querySelectorAll('#estimated-cost'));
			const marketEls = Array.from(div.querySelectorAll('#market-price'));

			function parsePriceFromMarket() {
				for (const m of marketEls) {
					const txt = (m.textContent || m.innerText || '').trim();
					if (!txt) continue;
					const num = Number(String(txt).replace(/[^0-9\-\.]+/g, ''));
					if (!Number.isNaN(num)) return num;
				}
				return 0;
			}

			function computeAndSetEstimated() {
				const price = parsePriceFromMarket();
				let shares = 0;
				if (shareInputs.length > 0) {
					const v = Number(shareInputs[0].value);
					shares = Number.isFinite(v) ? v : 0;
				}
				const est = Number(shares) * Number(price || 0);
				estimatedEls.forEach(el => {
					el.textContent = '$' + (Number.isFinite(est) ? est.toFixed(2) : '0.00');
				});
			}

			shareInputs.forEach(inp => {
				inp.addEventListener('input', computeAndSetEstimated);
				inp.addEventListener('change', computeAndSetEstimated);
			});

			// watch for price updates from websocket
			if (marketEls.length > 0) {
				const mo = new MutationObserver(() => computeAndSetEstimated());
				marketEls.forEach(m => mo.observe(m, { characterData: true, subtree: true, childList: true }));
			}

			computeAndSetEstimated();

			function getSelectedSymbol() {
				const sel = (localStorage.getItem('stocksim_selected') || '').toString().trim().toUpperCase();
				if (sel) return sel;
				const hdr = document.getElementById('stock-symbol');
				if (hdr) {
					let t = (hdr.textContent || hdr.innerText || '').trim();
					t = t.replace(/^\(|\)$/g, '').trim();
					if (t) return t.toUpperCase();
				}
				return null;
			}

			function getOwnedShares() {
				let el = document.getElementById('owned-shares');
				if (!el) return null;
				const v = Number(String(el.textContent || el.innerText || '').replace(/[^0-9\-\.]+/g, ''));
				if (Number.isFinite(v)) return Math.max(0, Math.floor(v));
				return null;
			}

			function setOwnedShares(n) {
				const el = div.querySelector('#owned-shares') || document.getElementById('owned-shares');
				if (!el) return;
				el.textContent = String(Number.isFinite(n) ? n : 0);
			}

			function clearFormMessages(form) {
				const old = form.querySelectorAll('.trade-msg');
				old.forEach(o => o.remove());
			}

			function showFormMessage(form, text, type = 'error') {
				clearFormMessages(form);
				const msg = document.createElement('div');
				msg.className = 'trade-msg';
				msg.style.marginTop = '8px';
				msg.style.padding = '8px 10px';
				msg.style.borderRadius = '6px';
				msg.style.fontSize = '13px';
				msg.style.maxWidth = '100%';
				if (type === 'error') {
					msg.style.background = 'rgba(176, 0, 32, 0.06)';
					msg.style.color = 'var(--red, #b00020)';
					msg.textContent = text;
				} else {
					msg.style.background = 'rgba(6, 95, 70, 0.06)';
					msg.style.color = 'var(--green, #046a38)';
					msg.textContent = text;
				}
				form.appendChild(msg);
				if (type === 'success') {
					setTimeout(() => { try { msg.remove(); } catch (e) {} }, 4000);
				}
			}

			async function fetchOwnedSharesForSymbol(symbol) {
				if (!symbol) return null;
				try {
					const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
					if (!meRes.ok) return null;
					const me = await meRes.json();
					const userId = me.user_id;
					if (!userId) return null;

					const res = await fetch('/api/portfolio?user_id=' + encodeURIComponent(userId), { credentials: 'same-origin' });
					if (!res.ok) return null;
					const pJson = await res.json();

					// handle different API response formats
					let respHoldings = [];
					if (Array.isArray(pJson.holdings)) respHoldings = pJson.holdings;
					else if (Array.isArray(pJson.data && pJson.data.holdings)) respHoldings = pJson.data.holdings;
					else if (Array.isArray(pJson)) respHoldings = pJson;
					else if (Array.isArray(pJson.data)) respHoldings = pJson.data;
					if (!Array.isArray(respHoldings) || respHoldings.length === 0) {
						respHoldings = [];
						if (Array.isArray(pJson.holdings)) respHoldings = pJson.holdings;
					}

					for (const h of respHoldings) {
						const sid = h.stock_id || h.stockId || h.stock || h.StockID || h.symbol || h.Stock || h.StockId;
						if (!sid) continue;
						if (String(sid).toUpperCase() === String(symbol).toUpperCase()) {
							const sh = (h.shares ?? h.qty ?? h.amount ?? h.position ?? 0);
							return Number(sh) || 0;
						}
					}
					return 0;
				} catch (err) {
					return null;
				}
			}

			async function performTrade(action, form) {
				const sharesInput = form.querySelector('input[name="shares"], input#shares');
				const confirmBtn = form.querySelector('.confirm-button');
				if (!sharesInput || !confirmBtn) {
					showFormMessage(form, 'Internal error: form fields missing', 'error');
					return;
				}

				const sharesVal = Number(sharesInput.value);
				if (!Number.isFinite(sharesVal) || sharesVal <= 0 || Math.floor(sharesVal) !== sharesVal) {
					showFormMessage(form, 'Enter a valid whole number of shares (> 0).', 'error');
					sharesInput.focus();
					return;
				}
				const shares = Math.floor(sharesVal);

				const symbol = getSelectedSymbol();
				if (!symbol) {
					showFormMessage(form, 'No stock selected.', 'error');
					return;
				}

				// make sure they actually own enough shares to sell
				if (action === 'sell') {
					let owned = await fetchOwnedSharesForSymbol(symbol);
					if (owned === null) {
						owned = getOwnedShares();
					}
					if (owned !== null && shares > owned) {
						showFormMessage(form, `You only own ${owned} shares — cannot sell ${shares}.`, 'error');
						return;
					}
				}

				const payload = {
					stock_id: symbol,
					action: action,
					shares: shares
				};

				confirmBtn.disabled = true;
				const origText = confirmBtn.textContent;
				confirmBtn.textContent = 'Processing...';
				clearFormMessages(form);

				try {
					const res = await fetch('/api/trade', {
						method: 'POST',
						credentials: 'same-origin',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(payload)
					});

					if (!res.ok) {
						let msgText = `Trade error (${res.status})`;
						try {
							const txt = await res.text();
							if (txt) msgText = txt;
						} catch (e) {}
						showFormMessage(form, msgText, 'error');
						return;
					}

					const data = await res.json();

					// try to get updated share count from trade response
					let newOwned = null;
					if (data && data.holdings && Array.isArray(data.holdings)) {
						for (const h of data.holdings) {
							const sid = h.stock_id || h.stockId || h.stock || h.stockID;
							if (!sid) continue;
							if (String(sid).toUpperCase() === String(symbol).toUpperCase()) {
								const sh = h.shares ?? h.qty ?? h.amount ?? h.position ?? 0;
								newOwned = Number(sh) || 0;
								break;
							}
						}
					}

					// if that didn't work, fetch fresh portfolio data
					if (newOwned === null) {
						try {
							const pRes = await fetch('/api/portfolio', { method: 'GET', credentials: 'same-origin' });
							if (pRes.ok) {
								const pJson = await pRes.json();
								let respHoldings = Array.isArray(pJson.holdings) ? pJson.holdings : (Array.isArray(pJson.data && pJson.data.holdings) ? pJson.data.holdings : []);
								if (!Array.isArray(respHoldings) && Array.isArray(pJson)) respHoldings = pJson;
								for (const h of respHoldings) {
									const sid = h.stock_id || h.stockId || h.stock || h.stockID;
									if (!sid) continue;
									if (String(sid).toUpperCase() === String(symbol).toUpperCase()) {
										const sh = h.shares ?? h.qty ?? h.amount ?? 0;
										newOwned = Number(sh) || 0;
										break;
									}
								}
							}
						} catch (e) {}
					}

					if (newOwned !== null) {
						setOwnedShares(newOwned);
					} else {
						const fetched = await fetchOwnedSharesForSymbol(symbol);
						if (fetched !== null) setOwnedShares(fetched);
					}

					computeAndSetEstimated();

					showFormMessage(form, `Trade executed: ${action.toUpperCase()} ${shares} ${symbol}`, 'success');
				} catch (err) {
					showFormMessage(form, `Request failed: ${err && err.message ? err.message : String(err)}`, 'error');
				} finally {
					confirmBtn.disabled = false;
					confirmBtn.textContent = origText || 'Trade Now';
				}
			}

			const buyConfirm = buyForm.querySelector('.confirm-button');
			const sellConfirm = sellForm.querySelector('.confirm-button');

			if (buyConfirm) {
				buyConfirm.addEventListener('click', (ev) => {
					ev.preventDefault();
					performTrade('buy', buyForm);
				});
			}
			if (sellConfirm) {
				sellConfirm.addEventListener('click', (ev) => {
					ev.preventDefault();
					performTrade('sell', sellForm);
				});
			}

			// load current holdings on page load
			(async () => {
				const sym = getSelectedSymbol();
				if (sym) {
					const n = await fetchOwnedSharesForSymbol(sym);
					if (n !== null) setOwnedShares(n);
				}
			})();
		});
	});
})();
