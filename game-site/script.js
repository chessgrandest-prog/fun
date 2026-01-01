/* Grab the container */
const container = document.getElementById('games');

/* Dark‑mode toggle logic */
const themeToggle = document.getElementById('themeToggle');

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
}
const saved = localStorage.getItem('theme') || 'light';
setTheme(saved);

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  setTheme(next);
});

/* Fetch games.json and build cards */
fetch('games.json')
  .then(r => r.ok ? r.json() : Promise.reject('bad'))
  .catch(err => {
    console.error('Could not load games.json', err);
    container.textContent = 'Failed to load games.';
    return [];
  })
  .then(games => {
    games.forEach(game => {
      const card = document.createElement('a');
      card.href = `viewer.html?src=${encodeURIComponent(game.url)}`;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.className = 'card';

      /* Card markup with flip & favorite button */
      card.innerHTML = `
        <div class="card-inner">
          <div class="card-front">
            <img src="${game.image}" alt="${game.title}">
            <div class="card-title">${game.title}</div>
            <button class="favBtn" title="Add to favorites">☆</button>
          </div>
          <div class="card-back">
            <div class="card-title">${game.title}</div>
            <p style="padding:1rem; text-align:center;">Click to play!</p>
          </div>
        </div>
      `;

      /* Favorite button functionality */
      const favBtn = card.querySelector('.favBtn');
      const stored = JSON.parse(localStorage.getItem('favorites') || '[]');
      const isFav = stored.includes(game.title);
      favBtn.textContent = isFav ? '★' : '☆';

      favBtn.addEventListener('click', e => {
        e.stopPropagation();  // keep the link working
        const idx = stored.indexOf(game.title);
        if (idx === -1) {
          stored.push(game.title);
          favBtn.textContent = '★';
        } else {
          stored.splice(idx, 1);
          favBtn.textContent = '☆';
        }
        localStorage.setItem('favorites', JSON.stringify(stored));
      });

      container.appendChild(card);
    });
  });
