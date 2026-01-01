/* Grab the container and header elements */
const container = document.getElementById('games');
const header   = document.querySelector('header');

/* -------  Helpers ------- */
const STORAGE_KEYS = {
  THEME: 'gamehub-theme',
  FAVORITES: 'gamehub-favs',
};

const setTheme = theme => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
};

const getTheme = () => localStorage.getItem(STORAGE_KEYS.THEME) || 'light';

const toggleTheme = () => {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  setTheme(next);
};

/* Load persisted theme on start */
setTheme(getTheme());

/* -------  Favorite logic ------- */
const loadFavorites = () => {
  const json = localStorage.getItem(STORAGE_KEYS.FAVORITES);
  return json ? JSON.parse(json) : {};
};

const saveFavorites = favs => localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favs));

const toggleFavorite = (card, gameUrl) => {
  const favs = loadFavorites();
  if (favs[gameUrl]) delete favs[gameUrl];
  else favs[gameUrl] = true;
  saveFavorites(favs);
  updateCardFavorite(card, favs[gameUrl]);
};

const updateCardFavorite = (card, isFav) => {
  const star = card.querySelector('.favorite');
  if (isFav) star.classList.add('fav-active');
  else star.classList.remove('fav-active');
};

/* -------  Search logic ------- */
const filterGames = (query, games) => {
  const q = query.trim().toLowerCase();
  if (!q) return games;
  return games.filter(g => g.title.toLowerCase().includes(q));
};

/* -------  UI Building ------- */
const buildCard = game => {
  const card = document.createElement('a');
  card.href = `viewer.html?src=${encodeURIComponent(game.url)}`;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.className = 'card';

  /* Favorite icon */
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  star.setAttribute('viewBox', '0 0 24 24');
  star.className = 'favorite';
  star.innerHTML = `<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>`;
  card.appendChild(star);

  /* Game title and image */
  card.innerHTML += `
    <img src="${game.image}" alt="${game.title}" loading="lazy">
    <div class="card-title">${game.title}</div>`;
  card.appendChild(star); // star appended after image/title

  /* Handle image load for fade‑in */
  const img = card.querySelector('img');
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    img.src = 'placeholder.png';
    img.classList.add('loaded');
  });

  /* Star click */
  star.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    toggleFavorite(card, game.url);
  });

  /* Set initial favorite state */
  const favs = loadFavorites();
  updateCardFavorite(card, favs[game.url]);

  return card;
};

/* -------  Random game ------- */
const openRandom = (games) => {
  if (!games.length) return;
  const rand = games[Math.floor(Math.random() * games.length)];
  window.open(`viewer.html?src=${encodeURIComponent(rand.url)}`, '_blank');
};

/* -------  Search button logic ------- */
const handleSearch = () => {
  const query = document.getElementById('searchInput').value;
  renderGames(filterGames(query, allGames));
};

/* -------  Build toolbar buttons ------- */
const buildToolbar = games => {
  /* Theme toggle */
  const btnTheme = document.createElement('button');
  btnTheme.className = 'toolbar-btn';
  btnTheme.textContent = getTheme() === 'light' ? '🌙 Dark' : '☀️ Light';
  btnTheme.onclick = () => {
    toggleTheme();
    btnTheme.textContent = getTheme() === 'light' ? '🌙 Dark' : '☀️ Light';
  };
  header.appendChild(btnTheme);

  /* Search input */
  const search = document.createElement('input');
  search.id = 'searchInput';
  search.type = 'text';
  search.placeholder = 'Search…';
  search.oninput = handleSearch;
  header.appendChild(search);

  /* Random game button */
  const btnRandom = document.createElement('button');
  btnRandom.className = 'toolbar-btn';
  btnRandom.textContent = '🎲 Random';
  btnRandom.onclick = () => openRandom(games);
  header.appendChild(btnRandom);
};

/* -------  Main rendering ------- */
let allGames = [];

fetch('games.json')
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .catch(err => {
    console.error('Could not load games.json', err);
    container.innerHTML =
      `<p>Failed to load games. <a href="games.json">Try again?</a></p>`;
    return [];
  })
  .then(games => {
    allGames = games;
    buildToolbar(games);
    renderGames(games);
  });

function renderGames(games) {
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  games.forEach(game => frag.appendChild(buildCard(game)));
  container.appendChild(frag);
}
