/* ═══════════════════════════════════════════════════════════
   GHOST ARCADE — Core Logic
   Game loading, search, tabs, favorites, recently played,
   and Ghost Mode (about:blank tab cloaking)
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── Constants ───
    const STORAGE = {
        favorites: 'ghostArcade_favorites',
        recent: 'ghostArcade_recent',
    };
    const MAX_RECENT = 20;

    // ─── State ───
    let allGames = [];
    let currentTab = 'all';
    let favorites = loadJSON(STORAGE.favorites, []);
    let recentlyPlayed = loadJSON(STORAGE.recent, []);

    // ─── DOM Refs ───
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const gameGrid = $('#gameGrid');
    const loadingGrid = $('#loadingGrid');
    const searchInput = $('#searchInput');
    const emptyState = $('#emptyState');
    const ghostModeBtn = $('#ghostModeBtn');
    const ghostIndicator = $('#ghostIndicator');
    const tabButtons = $$('.tab');

    // ═══════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        setupGhostMode();
        setupSearch();
        setupTabs();
        await loadGames();
        renderGames();
    }

    // ═══════════════════════════════════════════════════════════
    // GAME LOADING
    // ═══════════════════════════════════════════════════════════
    async function loadGames() {
        try {
            const res = await fetch('games.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            allGames = await res.json();
        } catch (err) {
            console.error('Failed to load games:', err);
            allGames = [];
        }
        // Hide skeleton loader
        if (loadingGrid) loadingGrid.hidden = true;
    }

    // ═══════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════
    function getProxyUrl(url) {
        if (window.location.protocol === 'file:') return url;
        return '/proxy?url=' + encodeURIComponent(url);
    }

    function renderGames() {
        const query = searchInput.value.toLowerCase().trim();
        let games = getGamesForTab();

        // Apply search filter
        if (query) {
            games = games.filter(g => g.title.toLowerCase().includes(query));
        }

        // Empty state
        if (games.length === 0) {
            gameGrid.innerHTML = '';
            emptyState.hidden = false;
            updateEmptyState();
            return;
        }

        emptyState.hidden = true;
        gameGrid.innerHTML = games.map(createCardHTML).join('');
        attachCardListeners();

        // Stagger entrance animation
        gameGrid.querySelectorAll('.game-card').forEach((card, i) => {
            card.style.animationDelay = `${i * 0.06}s`;
        });
    }

    function createCardHTML(game) {
        const isFav = favorites.includes(game.url);
        const favFill = isFav ? 'currentColor' : 'none';
        const favClass = isFav ? ' active' : '';

        return `
        <article class="game-card" data-url="${esc(game.url)}" data-title="${esc(game.title)}" data-image="${esc(game.image)}">
            <div class="card-image-wrap">
                <img class="card-image"
                     src="${esc(getProxyUrl(game.image))}"
                     alt="${esc(game.title)}"
                     loading="lazy"
                     onerror="this.style.display='none'">
                <div class="card-image-overlay"></div>

                <button class="card-play-btn" aria-label="Play ${esc(game.title)}">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>

                <button class="card-fav-btn${favClass}" aria-label="${isFav ? 'Remove from' : 'Add to'} favorites">
                    <svg viewBox="0 0 24 24" fill="${favFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </button>
            </div>

            <div class="card-info">
                <h3 class="card-title">${escHTML(game.title)}</h3>
            </div>
        </article>`;
    }

    function attachCardListeners() {
        gameGrid.querySelectorAll('.game-card').forEach(card => {
            const url = card.dataset.url;
            const title = card.dataset.title;
            const image = card.dataset.image;

            // Play button
            card.querySelector('.card-play-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                playGame(url, title, image);
            });

            // Favorite button
            card.querySelector('.card-fav-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFavorite(url);
            });

            // Whole card click
            card.addEventListener('click', () => {
                playGame(url, title, image);
            });
        });
    }

    function getGamesForTab() {
        switch (currentTab) {
            case 'recent':
                // Map recent entries to full game objects, preserving order
                return recentlyPlayed
                    .map(r => allGames.find(g => g.url === r.url) || r)
                    .filter(Boolean);
            case 'favorites':
                return allGames.filter(g => favorites.includes(g.url));
            default:
                return allGames;
        }
    }

    function updateEmptyState() {
        const icon = $('.empty-state__icon');
        const title = $('.empty-state__title');
        const text = $('.empty-state__text');
        if (!icon) return;

        if (searchInput.value.trim()) {
            icon.textContent = '🔍';
            title.textContent = 'No matches';
            text.textContent = 'Try a different search term.';
        } else if (currentTab === 'recent') {
            icon.textContent = '🕐';
            title.textContent = 'No recent games';
            text.textContent = 'Start playing to see your history here!';
        } else if (currentTab === 'favorites') {
            icon.textContent = '💜';
            title.textContent = 'No favorites yet';
            text.textContent = 'Click the heart on any game to save it here.';
        } else {
            icon.textContent = '👻';
            title.textContent = 'No games found';
            text.textContent = 'Check back later for new games.';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SEARCH
    // ═══════════════════════════════════════════════════════════
    function setupSearch() {
        let timer;
        searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(renderGames, 180);
        });
    }

    // ═══════════════════════════════════════════════════════════
    // TABS
    // ═══════════════════════════════════════════════════════════
    function setupTabs() {
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                tabButtons.forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                currentTab = btn.dataset.tab;
                renderGames();
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // FAVORITES
    // ═══════════════════════════════════════════════════════════
    function toggleFavorite(url) {
        const idx = favorites.indexOf(url);
        if (idx > -1) {
            favorites.splice(idx, 1);
        } else {
            favorites.push(url);
        }
        saveJSON(STORAGE.favorites, favorites);
        renderGames();
    }

    // ═══════════════════════════════════════════════════════════
    // RECENTLY PLAYED
    // ═══════════════════════════════════════════════════════════
    function addRecent(url, title, image) {
        recentlyPlayed = recentlyPlayed.filter(r => r.url !== url);
        recentlyPlayed.unshift({ url, title, image, playedAt: Date.now() });
        if (recentlyPlayed.length > MAX_RECENT) {
            recentlyPlayed = recentlyPlayed.slice(0, MAX_RECENT);
        }
        saveJSON(STORAGE.recent, recentlyPlayed);
    }

    // ═══════════════════════════════════════════════════════════
    // NAVIGATION
    // ═══════════════════════════════════════════════════════════
    function playGame(url, title, image) {
        addRecent(url, title, image);
        // Preserve ghost mode param if active
        const params = new URLSearchParams(window.location.search);
        const ghostParam = params.get('ghost') === '1' ? '&ghost=1' : '';
        window.location.href = `play.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}${ghostParam}`;
    }

    // ═══════════════════════════════════════════════════════════
    // GHOST MODE
    // ═══════════════════════════════════════════════════════════
    function setupGhostMode() {
        const params = new URLSearchParams(window.location.search);

        // If loaded inside ghost mode (about:blank iframe), show indicator
        if (params.get('ghost') === '1') {
            ghostIndicator.hidden = false;
            if (ghostModeBtn) ghostModeBtn.style.display = 'none';
            return;
        }

        // Otherwise show the ghost mode button
        if (ghostModeBtn) {
            ghostModeBtn.addEventListener('click', activateGhostMode);
        }
    }

    function activateGhostMode() {
        // Build URL with ghost flag
        const ghostUrl = new URL(window.location.href);
        ghostUrl.searchParams.set('ghost', '1');

        // Open about:blank tab and inject iframe
        const win = window.open('about:blank', '_blank');
        if (!win) {
            showPopupBlockedMessage();
            return;
        }

        win.document.open();
        win.document.write(
            '<!DOCTYPE html>' +
            '<html><head>' +
            '<title>Google</title>' +
            '<link rel="icon" href="https://www.google.com/favicon.ico">' +
            '<style>*{margin:0;padding:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none}</style>' +
            '</head><body>' +
            '<iframe src="' + ghostUrl.href + '" allow="fullscreen" allowfullscreen></iframe>' +
            '</body></html>'
        );
        win.document.close();

        // Try to close the original tab; fallback to showing a message
        window.close();
        // If window.close() didn't work (tab wasn't opened by script):
        setTimeout(() => {
            document.title = 'Google';
            setGoogleFavicon();
            document.body.innerHTML =
                '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;' +
                'font-family:Inter,sans-serif;background:#0a0a12;color:rgba(255,255,255,0.6);gap:12px;text-align:center;padding:24px">' +
                '<span style="font-size:48px">👻</span>' +
                '<h2 style="color:#00e5ff;font-size:20px">Ghost Mode Activated</h2>' +
                '<p style="max-width:320px;line-height:1.6">Your game hub is now open in a cloaked tab. You can safely close this tab.</p>' +
                '</div>';
        }, 300);
    }

    function showPopupBlockedMessage() {
        // Create a temporary toast notification
        const toast = document.createElement('div');
        toast.style.cssText =
            'position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:14px 24px;' +
            'background:rgba(255,45,123,0.12);border:1px solid rgba(255,45,123,0.3);border-radius:12px;' +
            'color:#ff2d7b;font-size:13px;font-weight:600;z-index:9999;backdrop-filter:blur(12px);' +
            'animation:fade-in 0.3s ease;font-family:Inter,sans-serif';
        toast.textContent = '⚠️ Please allow pop-ups for Ghost Mode to work!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    function setGoogleFavicon() {
        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        link.href = 'https://www.google.com/favicon.ico';
    }

    // ═══════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════
    function esc(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escHTML(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function loadJSON(key, fallback) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : fallback;
        } catch {
            return fallback;
        }
    }

    function saveJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Storage full or blocked — silently fail
        }
    }

})();
