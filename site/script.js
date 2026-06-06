/* ═══════════════════════════════════════════════════════════
   GHOST ARCADE — Core Logic
   Includes custom accents, settings, view layout toggle,
   custom game uploads, keyboard navigation, and toast system
   ═══════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── Constants & Storage Keys ───
    const STORAGE = {
        favorites: 'ghostArcade_favorites',
        recent: 'ghostArcade_recent',
        settings: 'ghostArcade_settings',
        customGames: 'ghostArcade_custom_games'
    };
    const MAX_RECENT = 20;

    const DEFAULT_SETTINGS = {
        accentColor: '#00e5ff',
        cardSize: 'medium',
        layoutMode: 'grid',
        parallaxEnabled: true,
        decoyPreset: 'google-drive',
        tabTitle: 'Google Drive',
        tabFavicon: 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png',
        panicKey: '`',
        panicCtrl: true,
        panicRedirect: 'https://www.google.com',
        autoGhost: false,
        customDecoyImage: '',
        cursorStyle: 'ring',
        cursorColor: 'match',
        bgEffect: 'orbs',
        lightningFrequency: 5,
        bgDensity: 5
    };

    // ─── State ───
    let allGames = [];
    let currentTab = 'all';
    let favorites = loadJSON(STORAGE.favorites, []);
    let recentlyPlayed = loadJSON(STORAGE.recent, []);
    let settings = loadJSON(STORAGE.settings, DEFAULT_SETTINGS);
    let customGames = loadJSON(STORAGE.customGames, []);

    // Merge default settings keys if they don't exist
    settings = { ...DEFAULT_SETTINGS, ...settings };

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

    // Toolbar buttons
    const settingsBtn = $('#settingsBtn');
    const randomGameBtn = $('#randomGameBtn');
    const viewToggleBtn = $('#viewToggleBtn');
    const viewToggleIcon = $('#viewToggleIcon');

    // Settings Modal DOM
    const settingsModal = $('#settingsModal');
    const closeSettingsBtn = $('#closeSettingsBtn');
    const modalTabBtns = $$('.modal-tab-btn');
    const settingsSections = $$('.settings-section');

    // Settings Form Inputs
    const cardSizeSelect = $('#cardSizeSelect');
    const parallaxToggle = $('#parallaxToggle');
    const decoyPresetSelect = $('#decoyPresetSelect');
    const tabTitleInput = $('#tabTitleInput');
    const tabFaviconInput = $('#tabFaviconInput');
    const panicCtrlCheckbox = $('#panicCtrlCheckbox');
    const panicKeyInput = $('#panicKeyInput');
    const panicRedirectInput = $('#panicRedirectInput');
    const autoGhostToggle = $('#autoGhostToggle');
    const customDecoyImageGroup = $('#customDecoyImageGroup');
    const customDecoyImageInput = $('#customDecoyImageInput');
    const customDecoyPreview = $('#customDecoyPreview');

    // Cursor & Background Settings Inputs
    const cursorStyleSelect = $('#cursorStyleSelect');
    const bgEffectSelect = $('#bgEffectSelect');
    const customCursorColorInput = $('#customCursorColorInput');
    const lightningFreqSlider = $('#lightningFreqSlider');
    const bgDensitySlider = $('#bgDensitySlider');
    
    const groupLightningFreq = $('#groupLightningFreq');
    const groupBgDensity = $('#groupBgDensity');

    // Custom game upload form
    const customGameForm = $('#customGameForm');
    const customGamesList = $('#customGamesList');

    // Backup & Reset Buttons
    const exportSettingsBtn = $('#exportSettingsBtn');
    const importSettingsFile = $('#importSettingsFile');
    const resetAllDataBtn = $('#resetAllDataBtn');

    // Toast Container
    const toastContainer = $('#toastContainer');

    // ═══════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════
    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        applySettings();
        initCustomCursor();
        initLightning();
        setupGhostMode();
        setupPanicKey();
        setupSearch();
        setupTabs();
        setupToolbarActions();
        setupSettingsModal();
        setupCustomGamesPanel();
        setupKeyboardNavigation();
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

        // Merge custom games and mark them as custom
        const processedCustom = customGames.map(g => ({ ...g, isCustom: true }));
        allGames = allGames.concat(processedCustom);

        // Hide skeleton loader
        if (loadingGrid) loadingGrid.hidden = true;
    }

    // ═══════════════════════════════════════════════════════════
    // SETTINGS APPLICATION
    // ═══════════════════════════════════════════════════════════
    function applySettings() {
        // 1. Accent Color
        applyAccentColor(settings.accentColor);

        // 2. Card Size
        const cardSizes = { small: '180px', medium: '260px', large: '320px' };
        document.documentElement.style.setProperty('--card-size', cardSizes[settings.cardSize] || cardSizes.medium);

        // 3. Layout Mode
        if (settings.layoutMode === 'list') {
            gameGrid.classList.add('game-grid--list');
            setViewToggleIconToList(true);
        } else {
            gameGrid.classList.remove('game-grid--list');
            setViewToggleIconToList(false);
        }

        // 4. Tab Masking (Applied globally if active in ghost mode or always enabled)
        const params = new URLSearchParams(window.location.search);
        const isGhost = params.get('ghost') === '1' || settings.autoGhost;
        if (isGhost) {
            document.title = settings.tabTitle;
            setCustomFavicon(settings.tabFavicon);
        }

        // Populating Settings Inputs to match state
        if (cardSizeSelect) cardSizeSelect.value = settings.cardSize;
        if (parallaxToggle) parallaxToggle.checked = settings.parallaxEnabled;
        if (decoyPresetSelect) decoyPresetSelect.value = settings.decoyPreset;
        
        if (customDecoyImageGroup) {
            if (settings.decoyPreset === 'custom-image') {
                customDecoyImageGroup.style.display = 'block';
                if (settings.customDecoyImage && customDecoyPreview) {
                    customDecoyPreview.src = settings.customDecoyImage;
                    customDecoyPreview.style.display = 'block';
                }
            } else {
                customDecoyImageGroup.style.display = 'none';
            }
        }

        if (tabTitleInput) tabTitleInput.value = settings.tabTitle;
        if (tabFaviconInput) tabFaviconInput.value = settings.tabFavicon;
        if (panicCtrlCheckbox) panicCtrlCheckbox.checked = settings.panicCtrl;
        if (panicKeyInput) panicKeyInput.value = settings.panicKey;
        if (panicRedirectInput) panicRedirectInput.value = settings.panicRedirect;
        if (autoGhostToggle) autoGhostToggle.checked = settings.autoGhost;

        if (cursorStyleSelect) cursorStyleSelect.value = settings.cursorStyle || 'none';
        if (bgEffectSelect) bgEffectSelect.value = settings.bgEffect || 'none';
        if (lightningFreqSlider) lightningFreqSlider.value = settings.lightningFrequency || 5;
        if (bgDensitySlider) bgDensitySlider.value = settings.bgDensity || 5;

        applyCursorColor();
        updateCursorState();
        if (typeof updateBgEffectState === 'function') updateBgEffectState();

        // Show/Hide relevant settings
        if (groupLightningFreq && groupBgDensity) {
            groupLightningFreq.style.display = settings.bgEffect === 'lightning' ? 'block' : 'none';
            groupBgDensity.style.display = (settings.bgEffect === 'matrix' || settings.bgEffect === 'starfield') ? 'block' : 'none';
        }

        // Auto-ghost launcher redirection
        if (settings.autoGhost && params.get('ghost') !== '1' && window.location.pathname.includes('/ghost-ui')) {
            activateGhostMode();
        }
    }

    function applyAccentColor(hex) {
        document.documentElement.style.setProperty('--accent-cyan', hex);
        document.documentElement.style.setProperty('--glow-cyan', hexToRgba(hex, 0.35));
        document.documentElement.style.setProperty('--border-hover', hexToRgba(hex, 0.25));

        // Update active swatch state
        $$('.color-swatch').forEach(sw => {
            if (sw.dataset.color.toLowerCase() === hex.toLowerCase()) {
                sw.classList.add('active');
            } else {
                sw.classList.remove('active');
            }
        });
    }

    function hexToRgba(hex, alpha) {
        let c;
        if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
            c = hex.substring(1).split('');
            if (c.length === 3) {
                c = [c[0], c[0], c[1], c[1], c[2], c[2]];
            }
            c = '0x' + c.join('');
            return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${alpha})`;
        }
        return `rgba(0, 229, 255, ${alpha})`;
    }

    function setCustomFavicon(url) {
        let link = document.querySelector("link[rel*='icon']");
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        link.href = url || 'https://www.google.com/favicon.ico';
    }

    function setViewToggleIconToList(isList) {
        if (!viewToggleIcon) return;
        if (isList) {
            // list icon active, show grid icon
            viewToggleIcon.innerHTML = `
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
            `;
        } else {
            // grid icon active, show list icon
            viewToggleIcon.innerHTML = `
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            `;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // RENDERING
    // ═══════════════════════════════════════════════════════════
    function getProxyUrl(url) {
        if (!url) return '';
        if (url.startsWith('/proxy/')) return url;
        if (window.location.protocol === 'file:') return url;
        return '/proxy/' + url;
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

        // Stagger entrance animation if not in list view
        if (settings.layoutMode !== 'list') {
            gameGrid.querySelectorAll('.game-card').forEach((card, i) => {
                card.style.animationDelay = `${i * 0.04}s`;
            });
        }
    }

    function createCardHTML(game) {
        const isFav = favorites.includes(game.url);
        const favFill = isFav ? 'currentColor' : 'none';
        const favClass = isFav ? ' active' : '';
        const isCustom = game.isCustom || false;

        const imgUrl = game.image || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%23101018"><rect width="100" height="100"/><text x="50%" y="55%" font-size="40" text-anchor="middle" dominant-baseline="middle">🎮</text></svg>';

        return `
        <article class="game-card" data-url="${esc(game.url)}" data-title="${esc(game.title)}" data-image="${esc(imgUrl)}" tabindex="0">
            <div class="card-image-wrap">
                <img class="card-image"
                     src="${esc(imgUrl)}"
                     alt="${esc(game.title)}"
                     loading="lazy"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22 fill=%22%23101018%22><rect width=%22100%22 height=%22100%22/><text x=%2250%%22 y=%2255%%22 font-size=%2240%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22>🎮</text></svg>';">
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

            <div class="game-card-actions" style="display:none;">
                <button class="card-play-btn" aria-label="Play ${esc(game.title)}" title="Play game">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
                <button class="card-fav-btn${favClass}" aria-label="${isFav ? 'Remove from' : 'Add to'} favorites" title="Favorite">
                    <svg viewBox="0 0 24 24" fill="${favFill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </button>
                ${isCustom ? `
                <button class="card-del-btn" aria-label="Delete custom game" title="Delete custom game">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
                    </svg>
                </button>
                ` : ''}
            </div>
        </article>`;
    }

    function attachCardListeners() {
        gameGrid.querySelectorAll('.game-card').forEach(card => {
            const url = card.dataset.url;
            const title = card.dataset.title;
            const image = card.dataset.image;

            // Play button clicks (supports grid overlay and list view button)
            card.querySelectorAll('.card-play-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    playGame(url, title, image);
                });
            });

            // Favorite button clicks (supports grid overlay and list view button)
            card.querySelectorAll('.card-fav-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleFavorite(url);
                });
            });

            // Delete button clicks for custom games
            const delBtn = card.querySelector('.card-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteCustomGame(url);
                });
            }

            // Whole card click triggers play
            card.addEventListener('click', () => {
                playGame(url, title, image);
            });

            // 3D Parallax Tilt listeners
            card.addEventListener('mousemove', handleCardMouseMove);
            card.addEventListener('mouseleave', handleCardMouseLeave);
        });
    }

    function getGamesForTab() {
        switch (currentTab) {
            case 'recent':
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
    // TOOLBAR ACTIONS
    // ═══════════════════════════════════════════════════════════
    function setupToolbarActions() {
        // Settings Button toggle
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                settingsModal.classList.add('active');
            });
        }

        // View Mode toggle
        if (viewToggleBtn) {
            viewToggleBtn.addEventListener('click', () => {
                settings.layoutMode = settings.layoutMode === 'grid' ? 'list' : 'grid';
                saveJSON(STORAGE.settings, settings);
                applySettings();
                renderGames();
                showToast(`Switched to ${settings.layoutMode} view mode`, 'info');
            });
        }

        // Random Game Button
        if (randomGameBtn) {
            randomGameBtn.addEventListener('click', () => {
                const games = allGames;
                if (games.length === 0) {
                    showToast('No games loaded to select randomly.', 'error');
                    return;
                }
                const randIndex = Math.floor(Math.random() * games.length);
                const game = games[randIndex];
                showToast(`Launching random game: ${game.title} 🎲`, 'success');
                setTimeout(() => {
                    playGame(game.url, game.title, game.image);
                }, 8000); // give them a moment to read the toast
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SETTINGS MODAL INTERACTION
    // ═══════════════════════════════════════════════════════════
    function setupSettingsModal() {
        if (!settingsModal) return;

        // Close modal handlers
        closeSettingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('active');
        });

        // Close on clicking backdrop
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.remove('active');
            }
        });

        // Modal tab switcher
        modalTabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                modalTabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const targetTab = btn.dataset.settingsTab;
                settingsSections.forEach(sect => {
                    if (sect.id === `sect-${targetTab}`) {
                        sect.classList.add('active');
                    } else {
                        sect.classList.remove('active');
                    }
                });
            });
        });

        // Color Swatches Selection
        $$('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                const color = swatch.dataset.color;
                settings.accentColor = color;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast('Accent color updated!', 'success');
            });
        });

        // Custom Color Picker input
        const customColorInput = $('#customColorInput');
        if (customColorInput) {
            customColorInput.addEventListener('input', (e) => {
                const color = e.target.value;
                settings.accentColor = color;
                saveJSON(STORAGE.settings, settings);
                applySettings();
            });
            customColorInput.addEventListener('change', (e) => {
                showToast('Custom accent color saved!', 'success');
            });
        }

        // Card Size Selection
        if (cardSizeSelect) {
            cardSizeSelect.addEventListener('change', (e) => {
                settings.cardSize = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast(`Grid card size changed to ${settings.cardSize}`, 'info');
            });
        }

        // Parallax Tilt toggle
        if (parallaxToggle) {
            parallaxToggle.addEventListener('change', (e) => {
                settings.parallaxEnabled = e.target.checked;
                saveJSON(STORAGE.settings, settings);
                showToast(settings.parallaxEnabled ? 'Parallax card tilt enabled' : 'Parallax card tilt disabled', 'info');
            });
        }

        // Decoy Preset selection
        if (decoyPresetSelect) {
            decoyPresetSelect.addEventListener('change', (e) => {
                settings.decoyPreset = e.target.value;
                
                if (settings.decoyPreset === 'custom-image') {
                    settings.tabTitle = 'Portal';
                    settings.tabFavicon = '';
                } else {
                    settings.tabTitle = 'My Drive - Google Drive';
                    settings.tabFavicon = 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png';
                }

                if (tabTitleInput) tabTitleInput.value = settings.tabTitle;
                if (tabFaviconInput) tabFaviconInput.value = settings.tabFavicon;

                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast(`Decoy preset changed to ${settings.decoyPreset.replace('-', ' ')}`, 'success');
            });
        }

        if (customDecoyImageInput) {
            customDecoyImageInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;

                        // Downscale if too large to fit in localStorage
                        const MAX_WIDTH = 1920;
                        const MAX_HEIGHT = 1080;
                        
                        if (width > height) {
                            if (width > MAX_WIDTH) {
                                height *= MAX_WIDTH / width;
                                width = MAX_WIDTH;
                            }
                        } else {
                            if (height > MAX_HEIGHT) {
                                width *= MAX_HEIGHT / height;
                                height = MAX_HEIGHT;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        // Compress to 70% quality JPEG
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                        settings.customDecoyImage = dataUrl;
                        saveJSON(STORAGE.settings, settings);
                        applySettings();
                        showToast('Custom screenshot saved!', 'success');
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
        }

        // Custom Tab title input
        if (tabTitleInput) {
            tabTitleInput.addEventListener('input', (e) => {
                settings.tabTitle = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
            });
        }

        // Custom Tab favicon input
        if (tabFaviconInput) {
            tabFaviconInput.addEventListener('input', (e) => {
                settings.tabFavicon = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
            });
        }

        // Panic key recorder
        if (panicKeyInput) {
            panicKeyInput.addEventListener('keydown', (e) => {
                e.preventDefault();
                // Avoid using mod keys by themselves
                if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

                settings.panicKey = e.key;
                panicKeyInput.value = e.key;
                saveJSON(STORAGE.settings, settings);
                showToast(`Panic keybind updated to ${settings.panicCtrl ? 'Ctrl+' : ''}${e.key.toUpperCase()}`, 'success');
            });
        }

        if (panicCtrlCheckbox) {
            panicCtrlCheckbox.addEventListener('change', (e) => {
                settings.panicCtrl = e.target.checked;
                saveJSON(STORAGE.settings, settings);
                showToast(`Panic keybind updated to ${settings.panicCtrl ? 'Ctrl+' : ''}${settings.panicKey.toUpperCase()}`, 'success');
            });
        }

        // Panic Redirect Destination
        if (panicRedirectInput) {
            panicRedirectInput.addEventListener('input', (e) => {
                settings.panicRedirect = e.target.value;
                saveJSON(STORAGE.settings, settings);
            });
        }

        // Auto Ghost Mode
        if (autoGhostToggle) {
            autoGhostToggle.addEventListener('change', (e) => {
                settings.autoGhost = e.target.checked;
                saveJSON(STORAGE.settings, settings);
                showToast(settings.autoGhost ? 'Auto Ghost Mode activated' : 'Auto Ghost Mode disabled', 'info');
                if (settings.autoGhost) {
                    applySettings();
                }
            });
        }

        // Cursor Style Select
        if (cursorStyleSelect) {
            cursorStyleSelect.addEventListener('change', (e) => {
                settings.cursorStyle = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast('Cursor style updated', 'info');
            });
        }

        // Custom Cursor Swatches
        $$('.color-swatch-cursor').forEach(swatch => {
            swatch.addEventListener('click', () => {
                settings.cursorColor = swatch.dataset.cursorColor;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast('Cursor color updated!', 'success');
            });
        });

        // Custom Cursor Color Input
        if (customCursorColorInput) {
            customCursorColorInput.addEventListener('input', (e) => {
                settings.cursorColor = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
            });
            customCursorColorInput.addEventListener('change', () => {
                showToast('Custom cursor color saved!', 'success');
            });
        }

        // Background Effect Select
        if (bgEffectSelect) {
            bgEffectSelect.addEventListener('change', (e) => {
                settings.bgEffect = e.target.value;
                saveJSON(STORAGE.settings, settings);
                applySettings();
                showToast('Background effect updated', 'info');
            });
        }

        // Lightning Frequency Slider
        if (lightningFreqSlider) {
            lightningFreqSlider.addEventListener('input', (e) => {
                settings.lightningFrequency = parseInt(e.target.value);
                saveJSON(STORAGE.settings, settings);
            });
            lightningFreqSlider.addEventListener('change', () => {
                showToast('Lightning frequency updated!', 'success');
            });
        }

        // Density Slider
        if (bgDensitySlider) {
            bgDensitySlider.addEventListener('input', (e) => {
                settings.bgDensity = parseInt(e.target.value);
                saveJSON(STORAGE.settings, settings);
            });
            bgDensitySlider.addEventListener('change', () => {
                showToast('Effect density updated!', 'success');
            });
        }

        // Backup Actions
        if (exportSettingsBtn) {
            exportSettingsBtn.addEventListener('click', exportSettingsData);
        }

        if (importSettingsFile) {
            importSettingsFile.addEventListener('change', importSettingsData);
        }

        if (resetAllDataBtn) {
            resetAllDataBtn.addEventListener('click', factoryResetAll);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CUSTOM GAMES PANEL
    // ═══════════════════════════════════════════════════════════
    function setupCustomGamesPanel() {
        if (!customGameForm) return;

        customGameForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = $('#customTitle').value.trim();
            const url = $('#customUrl').value.trim();
            const image = $('#customImage').value.trim();

            if (!title || !url) {
                showToast('Please fill out Title and URL fields.', 'error');
                return;
            }

            // check if URL already exists
            if (allGames.some(g => g.url === url) || customGames.some(g => g.url === url)) {
                showToast('A game with this URL already exists.', 'error');
                return;
            }

            const newGame = { title, url, image, isCustom: true };
            customGames.push(newGame);
            saveJSON(STORAGE.customGames, customGames);

            // Add to live games catalog
            allGames.push(newGame);

            // Reset Form fields
            customGameForm.reset();

            // Refresh DOM layouts
            renderGames();
            populateCustomGamesSettingsList();
            showToast(`Custom game "${title}" added!`, 'success');
        });

        populateCustomGamesSettingsList();
    }

    function populateCustomGamesSettingsList() {
        if (!customGamesList) return;

        if (customGames.length === 0) {
            customGamesList.innerHTML = `<div class="settings-desc" style="font-style: italic;">No custom games uploaded yet.</div>`;
            return;
        }

        customGamesList.innerHTML = customGames.map((game, i) => `
            <div class="custom-game-list-item">
                <div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px;">
                    ${escHTML(game.title)}
                    <span style="display:block; font-size:10px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;">
                        ${escHTML(game.url)}
                    </span>
                </div>
                <button type="button" data-index="${i}" class="delete-custom-game-btn" title="Delete game">🗑️</button>
            </div>
        `).join('');

        customGamesList.querySelectorAll('.delete-custom-game-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.index, 10);
                if (!isNaN(idx) && customGames[idx]) {
                    const deleted = customGames.splice(idx, 1)[0];
                    saveJSON(STORAGE.customGames, customGames);

                    // Remove from active runtime games
                    allGames = allGames.filter(g => g.url !== deleted.url);

                    renderGames();
                    populateCustomGamesSettingsList();
                    showToast(`Custom game "${deleted.title}" deleted`, 'success');
                }
            });
        });
    }

    function deleteCustomGame(url) {
        const game = customGames.find(g => g.url === url);
        if (!game) return;

        if (confirm(`Are you sure you want to delete the custom game "${game.title}"?`)) {
            customGames = customGames.filter(g => g.url !== url);
            saveJSON(STORAGE.customGames, customGames);

            allGames = allGames.filter(g => g.url !== url);
            renderGames();
            populateCustomGamesSettingsList();
            showToast(`Custom game deleted`, 'success');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // KEYBOARD NAVIGATION
    // ═══════════════════════════════════════════════════════════
    function setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            // Check settings modal state
            const isModalOpen = settingsModal && settingsModal.classList.contains('active');

            // Escape closes settings modal
            if (e.key === 'Escape' && isModalOpen) {
                settingsModal.classList.remove('active');
                return;
            }

            // Keyboard navigation in grid: arrows and controls
            const cards = Array.from(gameGrid.querySelectorAll('.game-card'));
            if (cards.length === 0) return;

            const activeEl = document.activeElement;
            const activeIndex = cards.indexOf(activeEl);

            // If user typing in inputs/forms, do not hijack keys
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                return;
            }

            let nextIndex = -1;

            if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (activeIndex === -1) nextIndex = 0;
                else nextIndex = Math.min(activeIndex + 1, cards.length - 1);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (activeIndex === -1) nextIndex = 0;
                else nextIndex = Math.max(activeIndex - 1, 0);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (activeIndex === -1) {
                    nextIndex = 0;
                } else if (settings.layoutMode === 'list') {
                    nextIndex = Math.min(activeIndex + 1, cards.length - 1);
                } else {
                    const cols = getGridColumnCount();
                    nextIndex = Math.min(activeIndex + cols, cards.length - 1);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (activeIndex === -1) {
                    nextIndex = 0;
                } else if (settings.layoutMode === 'list') {
                    nextIndex = Math.max(activeIndex - 1, 0);
                } else {
                    const cols = getGridColumnCount();
                    nextIndex = Math.max(activeIndex - cols, 0);
                }
            } else if (e.key.toLowerCase() === 'f' && activeIndex !== -1) {
                // Favorite focused game
                e.preventDefault();
                const card = cards[activeIndex];
                toggleFavorite(card.dataset.url);
                showToast(`Favorites updated for "${card.dataset.title}"`, 'success');
            }

            if (nextIndex !== -1) {
                cards[nextIndex].focus();
                // Add focused visual outline helper class
                cards.forEach(c => c.classList.remove('kbd-focused'));
                cards[nextIndex].classList.add('kbd-focused');
            }
        });

        // Add visual listener to clear visual focus classes on mouse hover
        gameGrid.addEventListener('focusin', (e) => {
            const card = e.target.closest('.game-card');
            if (card) {
                $$('.game-card').forEach(c => c.classList.remove('kbd-focused'));
                card.classList.add('kbd-focused');
            }
        });

        gameGrid.addEventListener('focusout', (e) => {
            const card = e.target.closest('.game-card');
            if (card) {
                card.classList.remove('kbd-focused');
            }
        });
    }

    function getGridColumnCount() {
        const cards = Array.from(gameGrid.querySelectorAll('.game-card'));
        if (cards.length <= 1) return 1;

        const firstTop = cards[0].offsetTop;
        let cols = 0;
        for (let i = 0; i < cards.length; i++) {
            if (cards[i].offsetTop === firstTop) {
                cols++;
            } else {
                break;
            }
        }
        return cols || 1;
    }

    // ═══════════════════════════════════════════════════════════
    // 3D PARALLAX CARD TILT
    // ═══════════════════════════════════════════════════════════
    function handleCardMouseMove(e) {
        if (!settings.parallaxEnabled) return;
        const card = e.currentTarget;
        const rect = card.getBoundingClientRect();
        
        // Mouse coordinate offsets from card center
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;

        // Angle tilt calculations
        const maxRotation = 14; // degrees
        const rotX = -(y / (rect.height / 2)) * maxRotation;
        const rotY = (x / (rect.width / 2)) * maxRotation;

        card.style.transform = `perspective(800px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;
        card.style.boxShadow = `0 15px 35px rgba(0, 0, 0, 0.4), 0 0 15px var(--glow-cyan)`;
    }

    function handleCardMouseLeave(e) {
        const card = e.currentTarget;
        card.style.transform = '';
        card.style.boxShadow = '';
    }

    // ═══════════════════════════════════════════════════════════
    // TOAST NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════
    function showToast(message, type = 'info') {
        if (!toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.textContent = message;

        toastContainer.appendChild(toast);

        // Fade out after 2.5 seconds
        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('transitionend', () => {
                toast.remove();
            }, { once: true });
            // Safety fallback in case transitionend doesn't fire
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 600);
        }, 2500);
    }

    // ═══════════════════════════════════════════════════════════
    // IMPORT / EXPORT / RESET DATA
    // ═══════════════════════════════════════════════════════════
    function exportSettingsData() {
        const data = {
            favorites: favorites,
            recent: recentlyPlayed,
            settings: settings,
            customGames: customGames
        };

        const jsonString = JSON.stringify(data, null, 4);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `ghost-arcade-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Backup file downloaded successfully!', 'success');
    }

    function importSettingsData(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (evt) {
            try {
                const parsed = JSON.parse(evt.target.result);
                
                // basic validation
                if (parsed.settings || parsed.favorites || parsed.customGames) {
                    if (parsed.settings) localStorage.setItem(STORAGE.settings, JSON.stringify(parsed.settings));
                    if (parsed.favorites) localStorage.setItem(STORAGE.favorites, JSON.stringify(parsed.favorites));
                    if (parsed.recent) localStorage.setItem(STORAGE.recent, JSON.stringify(parsed.recent));
                    if (parsed.customGames) localStorage.setItem(STORAGE.customGames, JSON.stringify(parsed.customGames));

                    showToast('Settings restored successfully! Reloading...', 'success');
                    setTimeout(() => {
                        window.location.reload();
                    }, 1200);
                } else {
                    showToast('Invalid backup file structure.', 'error');
                }
            } catch (err) {
                showToast('Failed to parse backup JSON file.', 'error');
            }
        };
        reader.readAsText(file);
    }

    function factoryResetAll() {
        if (confirm('⚠️ WARNING: This will permanently wipe all your custom settings, favorites lists, game logs, and added games. Are you absolutely sure?')) {
            localStorage.removeItem(STORAGE.favorites);
            localStorage.removeItem(STORAGE.recent);
            localStorage.removeItem(STORAGE.settings);
            localStorage.removeItem(STORAGE.customGames);

            showToast('All local data wiped. Resetting page...', 'error');
            setTimeout(() => {
                window.location.reload();
            }, 1200);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CORE LOGIC (Tabs, Search, Favorites, Play, Panic)
    // ═══════════════════════════════════════════════════════════
    function setupSearch() {
        if (!searchInput) return;
        searchInput.addEventListener('input', () => renderGames());
    }

    function setupTabs() {
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentTab = btn.dataset.tab || 'all';
                renderGames();
            });
        });
    }

    function toggleFavorite(url) {
        if (favorites.includes(url)) {
            favorites = favorites.filter(f => f !== url);
        } else {
            favorites.push(url);
        }
        saveJSON(STORAGE.favorites, favorites);
        renderGames();
    }

    function playGame(url, title, image) {
        recentlyPlayed = recentlyPlayed.filter(g => g.url !== url);
        recentlyPlayed.unshift({ url, title, image, lastPlayed: Date.now() });
        if (recentlyPlayed.length > MAX_RECENT) recentlyPlayed.pop();
        saveJSON(STORAGE.recent, recentlyPlayed);
        window.location.href = `play.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
    }

    function setupPanicKey() {
        document.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
                if (activeEl.id === 'panicKeyInput') return; // let the input capture it
            }
            if (e.key.toLowerCase() === settings.panicKey.toLowerCase()) {
                if (!settings.panicCtrl || e.ctrlKey) {
                    e.preventDefault();
                    window.location.replace(settings.panicRedirect);
                }
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // GHOST MODE / TAB CLOAKING
    // ═══════════════════════════════════════════════════════════
    function setupGhostMode() {
        const params = new URLSearchParams(window.location.search);

        let isCloaked = params.get('ghost') === '1';
        try {
            if (window.self !== window.top) isCloaked = true;
        } catch (e) {
            isCloaked = true; // Cross-origin access error means it's in an iframe
        }

        if (isCloaked) {
            ghostIndicator.hidden = false;
            if (ghostModeBtn) ghostModeBtn.style.display = 'none';
            return;
        }

        if (ghostModeBtn) {
            ghostModeBtn.addEventListener('click', activateGhostMode);
        }
    }

    function activateGhostMode() {
        const ghostUrl = new URL(window.location.href);
        ghostUrl.searchParams.set('ghost', '1');

        const win = window.open('about:blank', '_blank');
        if (!win) {
            showPopupBlockedMessage();
            return;
        }

        win.document.open();
        win.document.write(
            '<!DOCTYPE html>' +
            '<html><head>' +
            '<title>' + esc(settings.tabTitle) + '</title>' +
            '<link rel="icon" href="' + esc(settings.tabFavicon) + '">' +
            '<style>*{margin:0;padding:0;overflow:hidden}iframe{width:100vw;height:100vh;border:none}</style>' +
            '</head><body>' +
            '<iframe src="' + ghostUrl.href + '" allow="fullscreen"></iframe>' +
            '</body></html>'
        );
        win.document.close();

        // Redirect original tab
        window.close();
        setTimeout(() => {
            window.location.replace(settings.panicRedirect);
        }, 500);
    }

    function showPopupBlockedMessage() {
        showToast('⚠️ Please allow pop-ups for Ghost Mode cloak tab to open!', 'error');
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
            // Storage full or blocked
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CUSTOM CURSOR LOGIC
    // ═══════════════════════════════════════════════════════════
    let cursorContainer = null;
    let cursorDot = null, cursorRing = null, cursorOrb = null, cursorCyber = null, cursorSimple = null;
    let cursorRingX = 0, cursorRingY = 0;
    let cursorMouseX = 0, cursorMouseY = 0;
    let cursorHasMoved = false;

    function initCustomCursor() {
        cursorContainer = $('#cursorContainer');
        cursorDot = $('#cursorDot');
        cursorRing = $('#cursorRing');
        cursorOrb = $('#cursorOrb');
        cursorCyber = $('#cursorCyber');
        cursorSimple = $('#cursorSimple');

        if (!cursorContainer) return;
        cursorContainer.hidden = false;

        window.addEventListener('mousemove', (e) => {
            if (settings.cursorStyle === 'none') return;
            cursorMouseX = e.clientX;
            cursorMouseY = e.clientY;

            if (!cursorHasMoved) {
                cursorRingX = cursorMouseX;
                cursorRingY = cursorMouseY;
                cursorHasMoved = true;
                updateCursorVisibility(true);
            }

            if (settings.cursorStyle === 'ring') {
                if (cursorDot) { cursorDot.style.left = `${cursorMouseX}px`; cursorDot.style.top = `${cursorMouseY}px`; }
            } else if (settings.cursorStyle === 'orb') {
                if (cursorOrb) { cursorOrb.style.left = `${cursorMouseX}px`; cursorOrb.style.top = `${cursorMouseY}px`; }
            } else if (settings.cursorStyle === 'cyber') {
                if (cursorCyber) { cursorCyber.style.left = `${cursorMouseX}px`; cursorCyber.style.top = `${cursorMouseY}px`; }
            } else if (settings.cursorStyle === 'simple') {
                if (cursorSimple) { cursorSimple.style.left = `${cursorMouseX}px`; cursorSimple.style.top = `${cursorMouseY}px`; }
            }
        });

        window.addEventListener('mousedown', () => { document.body.classList.add('cursor-clicking'); });
        window.addEventListener('mouseup', () => { document.body.classList.remove('cursor-clicking'); });

        document.addEventListener('mouseover', (e) => {
            if (settings.cursorStyle === 'none') return;
            const target = e.target;
            if (target && (target.closest('button') || target.closest('a') || target.closest('.game-card') || target.closest('input') || target.closest('select') || target.closest('.color-swatch') || target.closest('.color-swatch-cursor') || target.closest('.custom-color-btn'))) {
                document.body.classList.add('cursor-hovering');
            }
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target;
            if (target && (target.closest('button') || target.closest('a') || target.closest('.game-card') || target.closest('input') || target.closest('select') || target.closest('.color-swatch') || target.closest('.color-swatch-cursor') || target.closest('.custom-color-btn'))) {
                document.body.classList.remove('cursor-hovering');
            }
        });

        document.addEventListener('mouseenter', () => { if (settings.cursorStyle !== 'none' && cursorHasMoved) updateCursorVisibility(true); });
        document.addEventListener('mouseleave', () => { updateCursorVisibility(false); });

        cursorTick();
    }

    function updateCursorVisibility(visible) {
        const opacity = visible ? '1' : '0';
        if (cursorDot) cursorDot.style.opacity = (settings.cursorStyle === 'ring') ? opacity : '0';
        if (cursorRing) cursorRing.style.opacity = (settings.cursorStyle === 'ring') ? opacity : '0';
        if (cursorOrb) cursorOrb.style.display = (settings.cursorStyle === 'orb' && visible) ? 'block' : 'none';
        if (cursorCyber) cursorCyber.style.display = (settings.cursorStyle === 'cyber' && visible) ? 'block' : 'none';
        if (cursorSimple) cursorSimple.style.display = (settings.cursorStyle === 'simple' && visible) ? 'block' : 'none';
    }

    function cursorTick() {
        if (settings.cursorStyle === 'ring' && cursorHasMoved && cursorRing) {
            cursorRingX += (cursorMouseX - cursorRingX) * 0.15;
            cursorRingY += (cursorMouseY - cursorRingY) * 0.15;
            cursorRing.style.left = `${cursorRingX}px`;
            cursorRing.style.top = `${cursorRingY}px`;
        } else if (settings.cursorStyle === 'cyber' && cursorHasMoved && cursorCyber && !document.body.classList.contains('cursor-clicking')) {
            const dx = cursorMouseX - cursorRingX;
            const dy = cursorMouseY - cursorRingY;
            cursorRingX += dx * 0.2;
            cursorRingY += dy * 0.2;
            const speed = Math.sqrt(dx*dx + dy*dy);
            const rot = Math.min(speed * 2, 45);
            cursorCyber.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
        } else if (settings.cursorStyle === 'cyber') {
            cursorRingX = cursorMouseX;
            cursorRingY = cursorMouseY;
        }
        requestAnimationFrame(cursorTick);
    }

    function updateCursorState() {
        if (settings.cursorStyle !== 'none') {
            document.body.classList.add('custom-cursor-active');
            if (cursorHasMoved) updateCursorVisibility(true);
        } else {
            document.body.classList.remove('custom-cursor-active');
            updateCursorVisibility(false);
        }
        
        // Also ensure background effect updates when settings apply
        if (typeof updateBgEffectState === 'function' && document.readyState === 'complete') updateBgEffectState();
    }

    function applyCursorColor() {
        const hex = settings.cursorColor === 'match' ? settings.accentColor : settings.cursorColor;
        document.documentElement.style.setProperty('--cursor-color', hex);
        document.documentElement.style.setProperty('--cursor-glow', hexToRgba(hex, 0.35));

        $$('.color-swatch-cursor').forEach(sw => {
            if (settings.cursorColor === 'match' && sw.dataset.cursorColor === 'match') sw.classList.add('active');
            else if (sw.dataset.cursorColor.toLowerCase() === settings.cursorColor.toLowerCase()) sw.classList.add('active');
            else sw.classList.remove('active');
        });
    }

    // ═══════════════════════════════════════════════════════════
    // BACKGROUND EFFECTS MANAGER
    // ═══════════════════════════════════════════════════════════
    let effectsCanvas = null;
    let effectsCtx = null;
    let bgAnimationFrame = null;
    let activeBgEffect = 'none';

    function initLightning() {
        effectsCanvas = $('#effectsCanvas');
        if (!effectsCanvas) return;
        effectsCtx = effectsCanvas.getContext('2d');
        window.addEventListener('resize', resizeEffectsCanvas);
        resizeEffectsCanvas();
        updateBgEffectState();
    }

    function resizeEffectsCanvas() {
        if (!effectsCanvas) return;
        effectsCanvas.width = window.innerWidth;
        effectsCanvas.height = window.innerHeight;
        if (activeBgEffect === 'matrix') initMatrix();
    }

    function updateBgEffectState() {
        const effect = settings.bgEffect || 'none';
        
        // Show/hide default orbs based on selection. 'orbs' is handled by CSS, not canvas.
        const bgEffectsContainer = $('.bg-effects');
        if (bgEffectsContainer) {
            const orbs = bgEffectsContainer.querySelectorAll('.bg-orb');
            orbs.forEach(orb => orb.style.display = effect === 'orbs' ? 'block' : 'none');
        }
        
        // Guard: effectsCanvas may not be initialized yet (called from applySettings before initLightning)
        if (!effectsCanvas) return;

        if (effect === activeBgEffect) return;
        stopCurrentBgEffect();
        activeBgEffect = effect;

        if (effect === 'none' || effect === 'orbs') return;

        effectsCanvas.style.opacity = '1';
        if (effect === 'lightning') startLightning();
        else if (effect === 'matrix') startMatrix();
        else if (effect === 'starfield') startStarfield();
    }

    function stopCurrentBgEffect() {
        if (effectsCanvas) effectsCanvas.style.opacity = '0';
        if (bgAnimationFrame) { cancelAnimationFrame(bgAnimationFrame); bgAnimationFrame = null; }
        if (lightningTimeout) { clearTimeout(lightningTimeout); lightningTimeout = null; }
        activeStrikes = [];
    }

    // --- Lightning ---
    let lightningTimeout = null;
    let activeStrikes = [];

    class Strike {
        constructor(w, h) {
            this.startX = Math.random() * w * 0.8 + w * 0.1;
            this.startY = 0;
            this.endX = this.startX + (Math.random() - 0.5) * (w * 0.3);
            this.endY = h * (0.8 + Math.random() * 0.2);
            this.childBolts = [];
            this.mainBolt = this.generateBolt(this.startX, this.startY, this.endX, this.endY, 2);
            this.maxLife = 15 + Math.random() * 20;
            this.life = this.maxLife;
            this.opacity = 1;
        }
        generateBolt(x1, y1, x2, y2, limit) {
            const segments = [];
            segments.push({ x: x1, y: y1 });
            let curX = x1, curY = y1;
            const steps = 15 + Math.random() * 15;
            const stepY = (y2 - y1) / steps;
            for (let i = 1; i < steps; i++) {
                curY += stepY;
                curX += (Math.random() - 0.5) * 40;
                segments.push({ x: curX, y: curY });
                if (limit > 0 && Math.random() < 0.1) {
                    const bx = curX + (Math.random() - 0.5) * 150;
                    const by = curY + Math.random() * (y2 - curY);
                    this.childBolts.push(this.generateBolt(curX, curY, bx, by, limit - 1));
                }
            }
            segments.push({ x: x2, y: y2 });
            return segments;
        }
        draw(ctx, color, glowColor) {
            if (Math.random() < 0.15) this.opacity = 0.1;
            else if (Math.random() < 0.3) this.opacity = 0.8 + Math.random() * 0.2;
            else this.opacity = (this.life / this.maxLife) * 0.8 + 0.2;
            
            ctx.save();
            ctx.globalAlpha = this.opacity;
            const allPaths = [this.mainBolt, ...this.childBolts];
            
            ctx.strokeStyle = color;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 20;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            allPaths.forEach(path => {
                ctx.beginPath();
                ctx.lineWidth = path === this.mainBolt ? 4 : 2;
                ctx.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
                ctx.stroke();
            });
            
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#ffffff';
            allPaths.forEach(path => {
                ctx.beginPath();
                ctx.lineWidth = path === this.mainBolt ? 1.5 : 0.75;
                ctx.moveTo(path[0].x, path[0].y);
                for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
                ctx.stroke();
            });
            ctx.restore();
        }
        update() { this.life--; return this.life > 0; }
    }

    function startLightning() {
        scheduleNextStrike();
        lightningTick();
    }

    function scheduleNextStrike() {
        if (activeBgEffect !== 'lightning') return;
        let freq = settings.lightningFrequency || 5;
        let t = 11 - freq;
        const nextTime = (t * t * 100) + Math.random() * (t * t * 200);
        lightningTimeout = setTimeout(() => {
            activeStrikes.push(new Strike(effectsCanvas.width, effectsCanvas.height));
            if (Math.random() < 0.4) {
                setTimeout(() => { if (activeBgEffect === 'lightning') activeStrikes.push(new Strike(effectsCanvas.width, effectsCanvas.height)); }, 200 + Math.random() * 300);
            }
            scheduleNextStrike();
        }, nextTime);
    }

    function lightningTick() {
        if (activeBgEffect !== 'lightning') return;
        effectsCtx.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height);
        
        const color = settings.accentColor || '#00e5ff';
        const glowColor = hexToRgba(color, 0.8);
        
        activeStrikes = activeStrikes.filter(strike => {
            const alive = strike.update();
            if (alive) strike.draw(effectsCtx, color, glowColor);
            return alive;
        });
        
        let drawFlash = false;
        activeStrikes.forEach(strike => {
            if (strike.life === strike.maxLife - 1 || strike.life === strike.maxLife - 3) drawFlash = true;
        });
        
        if (drawFlash) {
            effectsCtx.fillStyle = hexToRgba(color, 0.08);
            effectsCtx.fillRect(0, 0, effectsCanvas.width, effectsCanvas.height);
        }
        bgAnimationFrame = requestAnimationFrame(lightningTick);
    }

    // --- Matrix ---
    let matrixColumns = [];
    let matrixFontSize = 16;
    function initMatrix() {
        if (!effectsCanvas) return;
        const columns = Math.floor(effectsCanvas.width / matrixFontSize) + 1;
        matrixColumns = [];
        for (let i=0; i<columns; i++) {
            matrixColumns[i] = Math.random() * -100; // Start offscreen
        }
    }
    function startMatrix() {
        initMatrix();
        matrixTick();
    }
    function matrixTick() {
        if (activeBgEffect !== 'matrix') return;
        effectsCtx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        effectsCtx.fillRect(0, 0, effectsCanvas.width, effectsCanvas.height);
        
        const color = settings.accentColor || '#00e5ff';
        effectsCtx.fillStyle = color;
        effectsCtx.font = matrixFontSize + 'px monospace';
        
        const density = settings.bgDensity || 5;
        const dropSpeed = 0.5 + (density * 0.15);

        for (let i = 0; i < matrixColumns.length; i++) {
            const char = String.fromCharCode(0x30A0 + Math.random() * 96);
            const x = i * matrixFontSize;
            const y = matrixColumns[i] * matrixFontSize;
            
            effectsCtx.fillText(char, x, y);
            if (y > effectsCanvas.height && Math.random() > 0.975) matrixColumns[i] = 0;
            matrixColumns[i] += dropSpeed;
        }
        bgAnimationFrame = requestAnimationFrame(matrixTick);
    }

    // --- Starfield ---
    let stars = [];
    function startStarfield() {
        stars = [];
        const density = settings.bgDensity || 5;
        const count = 50 + (density * 25);
        for (let i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * effectsCanvas.width,
                y: Math.random() * effectsCanvas.height,
                size: Math.random() * 2,
                speed: 0.1 + Math.random() * 0.5,
                opacity: Math.random()
            });
        }
        starfieldTick();
    }
    function starfieldTick() {
        if (activeBgEffect !== 'starfield') return;
        effectsCtx.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height);
        
        const color = settings.accentColor || '#00e5ff';
        const density = settings.bgDensity || 5;
        const globalSpeed = 0.5 + (density * 0.1);

        stars.forEach(star => {
            star.y -= star.speed * globalSpeed;
            // Parallax
            star.x += (effectsCanvas.width / 2 - cursorMouseX) * 0.0005 * star.speed;
            
            if (star.y < 0) {
                star.y = effectsCanvas.height;
                star.x = Math.random() * effectsCanvas.width;
            }
            if (star.x < 0) star.x = effectsCanvas.width;
            if (star.x > effectsCanvas.width) star.x = 0;
            
            star.opacity += (Math.random() - 0.5) * 0.05;
            if (star.opacity < 0.1) star.opacity = 0.1;
            if (star.opacity > 1) star.opacity = 1;

            effectsCtx.fillStyle = hexToRgba(color, star.opacity);
            effectsCtx.beginPath();
            effectsCtx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            effectsCtx.fill();
        });
        bgAnimationFrame = requestAnimationFrame(starfieldTick);
    }

})();
