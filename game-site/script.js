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
    container.textContent = 'Failed to load games.';
    return [];
  })
  .then(games => {
    games.forEach(game => {
      /* Build a link that opens the viewer */
      const card = document.createElement('a');
      card.href = `viewer.html?src=${encodeURIComponent(game.url)}`;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.className = 'card';

      card.innerHTML = `
        <img src="${game.image}" alt="${game.title}">
        <div class="card-title">${game.title}</div>
      `;
      container.appendChild(card);
    });
  });
