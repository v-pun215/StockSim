(function () {
  const POLL_INTERVAL_MS = (window.NEWS_NOTIFIER_POLL_INTERVAL && Number(window.NEWS_NOTIFIER_POLL_INTERVAL)) || 10000;
  const VIEW_URL = window.NEWS_NOTIFIER_VIEW_URL || '/news';
  const STORAGE_KEY = 'newsnotifier:lastSeenId';
  const API_URL = '/api/news?limit=1';

  function ensureContainer() {
    if (document.getElementById('news-notifier-style')) return;
    const style = document.createElement('style');
    style.id = 'news-notifier-style';
    style.textContent = `

`;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'news-notifier-root';
    document.body.appendChild(root);
  }

  function getSavedId() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }
  function saveId(id) {
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
    } catch (e) {}
  }

  async function fetchLatest() {
    try {
      const res = await fetch(API_URL, { cache: 'no-cache' });
      if (!res.ok) return null;
      const arr = await res.json();
      if (!Array.isArray(arr) || arr.length === 0) return null;
      const first = arr[0];
      const id = first.id !== undefined ? String(first.id) : (first.published_at || first.time || null);
      const title = first.title || (first.content ? (first.content.slice(0, 120) + (first.content.length > 120 ? '…' : '')) : 'News updated');
      return { id, title, raw: first };
    } catch (e) {
      return null;
    }
  }

  function showToast(title, onView) {
    ensureContainer();
    const root = document.getElementById('news-notifier-root');
    if (!root) return;

    const toast = document.createElement('div');
    toast.className = 'news-notifier-toast';

    const left = document.createElement('div');
    left.className = 'news-notifier-left';

    const t = document.createElement('div');
    t.className = 'news-notifier-title';
    t.textContent = 'News updated';

    const sub = document.createElement('div');
    sub.className = 'news-notifier-sub';
    sub.textContent = title;

    left.appendChild(t);
    left.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'news-notifier-actions';

    const btnView = document.createElement('button');
    btnView.className = 'news-notifier-btn';
    btnView.textContent = 'View';
    btnView.addEventListener('click', function (ev) {
      ev.stopPropagation();
      try { onView && onView(); } catch (e) {}
    });

    const btnClose = document.createElement('button');
    btnClose.className = 'news-notifier-close';
    btnClose.innerHTML = '&#10005;';
    btnClose.title = 'Dismiss';
    btnClose.addEventListener('click', function (ev) {
      ev.stopPropagation();
      hideToast(toast);
    });

    actions.appendChild(btnView);
    actions.appendChild(btnClose);

    toast.appendChild(left);
    toast.appendChild(actions);

    root.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.classList.add('show');
      });
    });

    const autoHide = setTimeout(() => hideToast(toast), 6000);

    function hideToast(el) {
      clearTimeout(autoHide);
      try {
        el.classList.remove('show');
        setTimeout(() => {
          if (el && el.parentNode) el.parentNode.removeChild(el);
        }, 240);
      } catch (e) {}
    }
  }

  let lastSeen = getSavedId();
  let initialRun = true;

  async function pollOnce() {
    const latest = await fetchLatest();
    if (!latest || !latest.id) {
      if (initialRun) initialRun = false;
      return;
    }
    const latestId = String(latest.id);
    if (initialRun) {
      lastSeen = latestId;
      saveId(latestId);
      initialRun = false;
      return;
    }
    if (!lastSeen || latestId !== lastSeen) {
      lastSeen = latestId;
      saveId(latestId);
      showToast(latest.title || 'News updated', function () {
        try {
          window.location.href = VIEW_URL;
        } catch (e) {
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      pollOnce();
      setInterval(pollOnce, POLL_INTERVAL_MS);
    });
  } else {
    pollOnce();
    setInterval(pollOnce, POLL_INTERVAL_MS);
  }
})();
