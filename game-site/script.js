/* ------------------ 1️⃣ DOM ELEMENTS ------------------ */
const container = document.getElementById('games');
const header    = document.querySelector('header');

/* ------------------ 2️⃣ Local‑Storage helpers ------------------ */
const LS = {
  THEME:        'gamehub-theme',
  FAVORITES:    'gamehub-favs',
  getTheme: ()  => localStorage.getItem('gamehub-theme') ?? 'light',
  setTheme: (t) => localStorage.setItem('gamehub-theme', t),
  getFavs: ()   => JSON.parse(localStorage.getItem('gamehub-favs') || '{}'),
  setFavs: (d)  => localStorage.setItem('gamehub-favs', JSON.stringify(d)),
};

/* ------------------ 3️⃣ Theme (Dark/Light) ------------------ */
const applyTheme = theme => document.documentElement.dataset.theme = theme;
applyTheme(LS.getTheme());

const toggleTheme = () => {
  const next = LS.getTheme() === 'light' ? 'dark' : 'light';
  LS.setTheme(next);
  applyTheme(next);
  btnTheme.textContent = next === 'light' ? '🌙 Dark' : '☀️ Light';
};
const btnTheme = document.createElement('button');
btnTheme.className = 'toolbar-btn';
btnTheme.textContent = LS.getTheme() === 'light' ? '🌙 Dark' : '☀️ Light';
btnTheme.onclick = toggleTheme;
header.appendChild(btnTheme);

/* ------------------ 4️⃣ Search ------------------ */
const searchInput = document.createElement('input');
searchInput.id   = 'searchInput';
searchInput.type = 'text';
searchInput.placeholder = 'Search…';
searchInput.oninput = () => renderGames(filterGames(searchInput.value, allGames));
header.appendChild(searchInput);

/* ------------------ 5️⃣ Random Game ------------------ */
const btnRandom = document.createElement('button');
btnRandom.className = 'toolbar-btn';
btnRandom.textContent = '🎲 Random';
btnRandom.onclick = () => openRandom(allGames);
header.appendChild(btnRandom);

/* ------------------ 6️⃣ About Page ------------------ */
const btnAbout = document.createElement('button');
btnAbout.className = 'toolbar-btn';
btnAbout.textContent = 'ℹ️ About';
btnAbout.onclick = () => window.open('about.html', '_blank');
header.appendChild(btnAbout);

/* ------------------ 7️⃣ Favorites ------------------ */
const toggleFavorite = (card, url) => {
  const favs = LS.getFavs();
  if (favs[url]) delete favs[url]; else favs[url] = true;
  LS.setFavs(favs);
  updateCardFavorite(card, favs[url]);
};

const updateCardFavorite = (card, isFav) => {
  const star = card.querySelector('.favorite');
  star.classList.toggle('fav-active', isFav);
};

/* ------------------ 8️⃣ Card Builder ------------------ */
const buildCard = game => {
  const card = document.createElement('a');
  card.href = `viewer.html?src=${encodeURIComponent(game.url)}`;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.className = 'card';

  /* Star icon (favorite) */
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  star.setAttribute('viewBox', '0 0 24 24');
  star.className = 'favorite';
  star.innerHTML =
    '<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>';
  star.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(card, game.url);
  };
  card.appendChild(star); // will be positioned absolutely

  /* Image & title */
  card.innerHTML += `
    <img src="${game.image}" alt="${game.title}" loading="lazy">
    <div class="card-title">${game.title}</div>`;

  /* Image load handling */
  const img = card.querySelector('img');
  img.addEventListener('load', () => img.classList.add('loaded'));
  img.addEventListener('error', () => {
    img.src = 'placeholder.png';
    img.classList.add('loaded');
  });

  /* Set initial favorite state */
  const favs = LS.getFavs();
  updateCardFavorite(card, favs[game.url]);

  return card;
};

/* ------------------ 9️⃣ Random / Search helpers ------------------ */
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

/* ------------------ 10️⃣ Rendering ------------------ */
let allGames = [];

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
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  games.forEach(g => frag.appendChild(buildCard(g)));
  container.appendChild(frag);
}
