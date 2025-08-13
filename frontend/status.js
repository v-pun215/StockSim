
const headingEl = document.querySelector('.home-card.status .heading');
const timerEl = document.querySelector('.home-card.status .timer');
const compStartEl = document.getElementById('comp-start');
const compEndEl = document.getElementById('comp-end');

let startTime = null;
let endTime = null;
let statusInterval = null;

async function fetchStatus() {
	try {
		const res = await fetch('http://localhost:8080/api/status');
		if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
		const data = await res.json();

		startTime = new Date(data.start).getTime();
		endTime = new Date(data.end).getTime();

		compStartEl.textContent = formatTime(new Date(startTime));
		compEndEl.textContent = formatTime(new Date(endTime));

		updateTimer();
		if (statusInterval) clearInterval(statusInterval);
		statusInterval = setInterval(updateTimer, 1000);
	} catch (err) {
		console.error('Error fetching status:', err);
		headingEl.textContent = 'Error loading status';
		timerEl.textContent = '--:--:--';
	}
}

function updateTimer() {
	const now = Date.now();

	if (now < startTime) {
		headingEl.textContent = 'Starts in';
		timerEl.textContent = formatDuration(startTime - now);
	} else if (now >= startTime && now <= endTime) {
		headingEl.textContent = 'Time left';
		timerEl.textContent = formatDuration(endTime - now);
	} else {
		headingEl.textContent = 'Competition ended';
		timerEl.textContent = '00:00:00';
		clearInterval(statusInterval);
	}
}
function formatDuration(ms) {
	let totalSeconds = Math.floor(ms / 1000);
	let hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
	let minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
	let seconds = String(totalSeconds % 60).padStart(2, '0');
	return `${hours}:${minutes}:${seconds}`;
}
function formatTime(date) {
	let h = String(date.getHours()).padStart(2, '0');
	let m = String(date.getMinutes()).padStart(2, '0');
	return `${h}:${m}`;
}

fetchStatus();