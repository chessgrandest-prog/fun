/* Grab the container */
const container = document.getElementById('games');

/* Fetch the JSON file */
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
    if (!games.length) return;

    const frag = document.createDocumentFragment();

    games.forEach(game => {
      /* Validate the entry */
      if (!game.url || !game.title || !game.image) {
        console.warn('Skipping malformed game entry', game);
        return;
      }

      /* Build a link that opens the viewer */
      const card = document.createElement('a');
      card.href = `viewer.html?src=${encodeURIComponent(game.url)}`;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.className = 'card';

      card.innerHTML = `
        <img src="${game.image}" alt="${game.title}" loading="lazy">
        <div class="card-title">${game.title}</div>`;

      /* Fade‑in image when loaded */
      const img = card.querySelector('img');
      img.addEventListener('load', () => img.classList.add('loaded'));
      img.addEventListener('error', () => {
        img.src = 'placeholder.png';
        img.classList.add('loaded');
      });

      frag.appendChild(card);
    });

    container.appendChild(frag);
  });
