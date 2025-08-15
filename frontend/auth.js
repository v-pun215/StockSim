(async function() {
    async function getMe() {
        try {
            const res = await fetch('http://localhost:8080/api/auth/me', {
                credentials: 'include'
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    async function signup(username) {
        const res = await fetch('http://localhost:8080/api/auth/signup', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        if (!res.ok) throw new Error('signup failed');
        return await res.json();
    }

    async function ensureUser() {
        let user = await getMe();
        if (user) {
            console.log('current user:', user);
            window.CURRENT_USER = user;
            return user;
        }

        // ask username
        let name = localStorage.getItem('stocksim_username') || '';
        while (!name) {
            name = prompt('Enter a username (no spaces, 1-64 chars):', '');
            if (name === null) return null; // user cancelled
            if (name) {
                name = name.trim();
                if (name.length > 64) { alert('Too long'); name = ''; continue; }
                // try signup
                try {
                    const created = await signup(name);
                    localStorage.setItem('stocksim_username', name);
                    window.CURRENT_USER = created;
                    return created;
                } catch (err) {
                    alert('Signup failed, try another name or refresh.');
                    name = '';
                }
            }
        }
    }

    // run on page load
    document.addEventListener('DOMContentLoaded', () => {
        ensureUser().then(u => {
            if (u) {
                // plan to add username in ui
                const el = document.getElementById('username-display');
                if (el) el.textContent = u.username;
            }
        });
    });
})();

