// script.js (modified)

const container = document.getElementById('games');

fetch('games.json')
  .then(r => r.json())
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

      card.innerHTML = `
        <img src="${game.image}" alt="${game.title}">
        <div class="card-title">${game.title}</div>
      `;
      container.appendChild(card);
    });
  });
