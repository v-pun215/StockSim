document.addEventListener('DOMContentLoaded', function () {
    const API_NEWS = '/api/news';

    const containers = {
        technology: document.getElementById('tech-news'),
        industrial: document.getElementById('indust-news'),
        healthcare: document.getElementById('healthcare-news'),
        other: document.getElementById('other-news')
    };

    function createNewsCard(item) {
        const card = document.createElement('div');
        card.className = 'home-card';

        const heading = document.createElement('h2');
        heading.textContent = item.title || 'No title';

        const website = document.createElement('p');
        website.className = 'news-website';
        website.textContent = item.source || 'Unknown source';

        const hr = document.createElement('hr');

        const content = document.createElement('p');
        content.className = 'news-content';
        content.textContent = item.content || 'No content';

        card.appendChild(heading);
        card.appendChild(website);
        card.appendChild(hr);
        card.appendChild(content);

        return card;
    }

    function createNoNewsCard() {
        const card = document.createElement('div');
        card.className = 'home-card';
        const p = document.createElement('p');
        p.textContent = 'No news yet';
        p.style.color = '#6b7280';
        card.appendChild(p);
        return card;
    }

    function getContainer(category) {
        const cat = (category || '').toLowerCase();
        if (cat === 'technology') return containers.technology;
        if (cat === 'industrial') return containers.industrial;
        if (cat === 'healthcare') return containers.healthcare;
        return containers.other;
    }

    async function loadNews() {
        try {
            const res = await fetch(API_NEWS);
            if (!res.ok) throw new Error('Failed to fetch news');
            const newsArr = await res.json();
            if (!Array.isArray(newsArr)) return;

            Object.values(containers).forEach(container => {
                container.querySelectorAll('.home-card').forEach(c => c.remove());
            });

            const hasNews = { technology: false, industrial: false, healthcare: false, other: false };

            newsArr.forEach(item => {
                const container = getContainer(item.category);
                container.appendChild(createNewsCard(item));

                const cat = (item.category || '').toLowerCase();
                if (cat === 'technology') hasNews.technology = true;
                else if (cat === 'industrial') hasNews.industrial = true;
                else if (cat === 'healthcare') hasNews.healthcare = true;
                else hasNews.other = true;
            });

            if (!hasNews.technology) containers.technology.appendChild(createNoNewsCard());
            if (!hasNews.industrial) containers.industrial.appendChild(createNoNewsCard());
            if (!hasNews.healthcare) containers.healthcare.appendChild(createNoNewsCard());
            if (!hasNews.other) containers.other.appendChild(createNoNewsCard());

        } catch (err) {
            console.error('Error loading news:', err);

            Object.values(containers).forEach(container => {
                container.querySelectorAll('.home-card').forEach(c => c.remove());
                container.appendChild(createNoNewsCard());
            });
        }
    }

    loadNews();
});
