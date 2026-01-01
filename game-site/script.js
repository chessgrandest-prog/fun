/* ──────────────────────────────────────────────────────────────────────
   1️⃣ DOM ELEMENTS
   ────────────────────────────────────────────────────────────────────── */
const container = document.getElementById('games');
const header    = document.querySelector('header');

/* ──────────────────────────────────────────────────────────────────────
   2️⃣ LocalStorage helpers
   ────────────────────────────────────────────────────────────────────── */
const LS = {
  THEME:        'gamehub-theme',
  FAVORITES:    'gamehub-favs',
  getTheme: ()  => localStorage.getItem('gamehub-theme') ?? 'light',
  setTheme: (t) => localStorage.setItem('gamehub-theme', t),
  getFavs: ()   => JSON.parse(localStorage.getItem('gamehub-favs') || '{}'),
  setFavs: (d)  => localStorage.setItem('gamehub-favs', JSON.stringify(d)),
};

/* ──────────────────────────────────────────────────────────────────────
   3️⃣ Theme (Dark/Light) – persistent toggle
   ────────────────────────────────────────────────────────────────────── */
const applyTheme = t => document.documentElement.dataset.theme = t;
applyTheme(LS.getTheme());

const btnTheme = document.createElement('button');
btnTheme.className = 'toolbar-btn';
btnTheme.textContent = LS.getTheme() === 'light' ? '🌙 Dark' : '☀️ Light';
btnTheme.onclick = () => {
  const next = LS.getTheme() === 'light' ? 'dark' : 'light';
  LS.setTheme(next);
  applyTheme(next);
  btnTheme.textContent = next === 'light' ? '🌙 Dark' : '☀️ Light';
};
header.appendChild(btnTheme);

/* ──────────────────────────────────────────────────────────────────────
   4️⃣ Search input
   ────────────────────────────────────────────────────────────────────── */
const searchInput = document.createElement('input');
searchInput.id   = 'searchInput';
searchInput.type = 'text';
searchInput.placeholder = 'Search…';
searchInput.oninput = () => renderGames(filterGames(searchInput.value, allGames));
header.appendChild(searchInput);

/* ──────────────────────────────────────────────────────────────────────
   5️⃣ Random Game button
   ────────────────────────────────────────────────────────────────────── */
const btnRandom = document.createElement('button');
btnRandom.className = 'toolbar-btn';
btnRandom.textContent = '🎲 Random';
btnRandom.onclick = () => openRandom(allGames);
header.appendChild(btnRandom);

/* ── About button – open a clean copy of the site in about:blank ── */
const btnAbout = document.createElement('button');
btnAbout.className = 'toolbar-btn';
btnAbout.textContent = 'ℹ️ About';

btnAbout.onclick = () => {
  const blank = window.open('', '_blank');

  // Minimal page – header **and** an empty #games container
  const page = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Game Hub – About</title>
        <link rel="stylesheet" href="style.css">
        <!-- Re‑run the original JS – it will create the toolbar, grid, etc. -->
        <script src="script.js" defer></script>
      </head>
      <body>
        <header></header>
        <div id="games"></div>   <!-- <div id="games"> is required -->
      </body>
    </html>
  `;

  blank.document.open();
  blank.document.write(page);
  blank.document.close();

  /* ---------- After the new tab is ready, patch the links ---------------- */
  blank.addEventListener('load', () => {
    const openGameInBlank = href => {
      const win = window.open('', '_blank');
      win.document.write(`
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <title>Playing… ${href}</title>
            <link rel="stylesheet" href="style.css">
          </head>
          <body style="margin:0;">
            <iframe src="${href}" style="width:100%;height:100%;border:0;"></iframe>
          </body>
        </html>
      `);
      win.document.close();
    };

    const links = blank.document.querySelectorAll('#games a');
    links.forEach(a => {
      const realHref = a.getAttribute('href');
      a.removeAttribute('href');
      a.style.cursor = 'pointer';
      a.addEventListener('click', () => openGameInBlank(realHref));
    });
  });
};

header.appendChild(btnAbout);

/* ──────────────────────────────────────────────────────────────────────
   7️⃣ Favorites – only mark when the user clicks the star
   ────────────────────────────────────────────────────────────────────── */
const toggleFavorite = (card, url) => {
  const favs = LS.getFavs();
  if (favs[url]) delete favs[url]; else favs[url] = true;
  LS.setFavs(favs);
  updateCardFavorite(card, !!favs[url]);   // !! ensures a boolean
};

const updateCardFavorite = (card, isFav) => {
  const star = card.querySelector('svg.favorite');
  if (!star) return;
  star.classList.toggle('fav-active', isFav);
};

/* ──────────────────────────────────────────────────────────────────────
   8️⃣ Build a single card (no innerHTML mutation)
   ────────────────────────────────────────────────────────────────────── */
const buildCard = game => {
  const card = document.createElement('a');
  card.href = `viewer.html?src=${encodeURIComponent(game.url)}`;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.className = 'card';

  /* Star icon – SVG needs an explicit class attribute */
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  star.setAttribute('viewBox', '0 0 24 24');
  star.setAttribute('class', 'favorite');          // <-- guarantees a CSS class
  star.innerHTML =
    '<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>';
  star.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(card, game.url);
  };
  card.appendChild(star);        // absolutely positioned by CSS

  /* Image */
  const img = document.createElement('img');
  img.src = game.image;
  img.alt = game.title;
  img.loading = 'lazy';
  img.className = 'card-img';
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    img.src = 'placeholder.png';
    img.classList.add('loaded');
  });
  card.appendChild(img);

  /* Title */
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = game.title;
  card.appendChild(title);

  /* Initialise favourite state from localStorage */
  const favs = LS.getFavs();
  updateCardFavorite(card, !!favs[game.url]);

  return card;
};

/* ──────────────────────────────────────────────────────────────────────
   9️⃣ Random / Search helpers
   ────────────────────────────────────────────────────────────────────── */
const openRandom = games => {
  if (!games.length) return;
  const r = games[Math.floor(Math.random() * games.length)];
  window.open(`viewer.html?src=${encodeURIComponent(r.url)}`, '_blank');
};

const filterGames = (query, games) => {
  const q = query.trim().toLowerCase();
  if (!q) return games;
  return games.filter(g => g.title.toLowerCase().includes(q));
};

/* ──────────────────────────────────────────────────────────────────────
   1️⃣0️⃣ Rendering the grid
   ────────────────────────────────────────────────────────────────────── */
let allGames = [];
let showOnlyFavs = false;     // start by showing everything

fetch('games.json')
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .catch(err => {
    console.error('Could not load games.json', err);
    container.innerHTML =
      '<p>Failed to load games. <a href="games.json">Try again?</a></p>';
    return [];
  })
  .then(games => {
    allGames = games;
    renderGames(games);
  });

function renderGames(games) {
  /* If “Favorites‑Only” is active, strip out all non‑fav cards first */
  if (showOnlyFavs) {
    const favs = LS.getFavs();
    games = games.filter(g => favs[g.url]);
  }

  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  games.forEach(g => frag.appendChild(buildCard(g)));
  container.appendChild(frag);
}

/* ──────────────────────────────────────────────────────────────────────
   ★  “Favorites‑Only” toggle button
   ────────────────────────────────────────────────────────────────────── */
const btnFavOnly = document.createElement('button');
btnFavOnly.className = 'toolbar-btn';
btnFavOnly.textContent = '★ All';
btnFavOnly.onclick = () => {
  showOnlyFavs = !showOnlyFavs;
  btnFavOnly.textContent = showOnlyFavs ? '★ Show All' : '★ All';
  renderGames(filterGames(searchInput.value, allGames));
};
header.appendChild(btnFavOnly);
