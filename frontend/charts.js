// charts.js
(() => {
	const chartContainer = document.querySelector('.chart');
	let portfolioChart = null;

	function getCssVariable(name, fallback) {
		const v = getComputedStyle(document.documentElement).getPropertyValue(name);
		return v ? v.trim() : fallback;
	}

	const holdings = [
		{ label: 'AAPL', value: 25 },
		{ label: 'NVDA', value: 200 },
		{ label: 'TSLA', value: 50 },
		{ label: 'AMZN', value: 30 },
		{ label: 'GOOG', value: 40 }
	];

	function ensureCanvas() {
		let canvas = chartContainer.querySelector('canvas#portfolioChart');
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.id = 'portfolioChart';
			canvas.style.display = 'block';
			canvas.style.width = '100%';
			canvas.style.height = '400px';
			canvas.style.padding = '0';
			canvas.style.margin = '0 auto';
			chartContainer.appendChild(canvas);
		}
		return canvas;
	}

	function createPortfolioChart() {
		const canvas = ensureCanvas();
		const portfolioCtx = canvas.getContext('2d');

		if (portfolioChart) portfolioChart.destroy();

		const primaryColor = getCssVariable('--primary-green', '#00b894');
		const darkGrey = getCssVariable('--dark-grey', '#343a40');

		const labels = holdings.map(h => h.label);
		const data = holdings.map(h => h.value);
		const bgColors = [
			primaryColor, '#3498db', '#9b59b6', '#e67e22', '#2ecc71',
			'#f1c40f', '#e74c3c', '#95a5a6', '#34495e', '#1abc9c'
		];

		portfolioChart = new Chart(portfolioCtx, {
			type: 'pie',
			data: {
				labels: labels,
				datasets: [{
					data: data,
					backgroundColor: bgColors,
					hoverOffset: 8,
					borderColor: getCssVariable('--white', '#ffffff'),
					borderWidth: 2
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				layout: {
					padding: 10
				},
				plugins: {
					legend: {
						position: 'right',
						labels: {
							font: {
								size: 12,
								family: 'Inter'
							},
							color: darkGrey,
							boxWidth: 20,
							padding: 8
						}
					},
					tooltip: {
						callbacks: {
							label: function (context) {
								let label = context.label || '';
								if (label) label += ': ';
								if (context.parsed !== null) label += context.parsed;
								return label + ' shares';
							}
						},
						backgroundColor: getCssVariable('--tooltip-bg', 'rgba(0,0,0,0.85)'),
						titleFont: { size: 15, weight: 'bold', family: 'Inter', color: getCssVariable('--tooltip-text', '#fff') },
						bodyFont: { size: 13, family: 'Inter', color: getCssVariable('--tooltip-text', '#fff') },
						padding: 12,
						caretSize: 6,
						cornerRadius: 8,
						displayColors: true
					}
				}
			}
		});
	}

	function init() {
		if (!chartContainer) return;
		createPortfolioChart();
	}

	window.addEventListener('resize', () => {
		if (portfolioChart) portfolioChart.resize();
	});

	document.addEventListener('DOMContentLoaded', init);
})();
