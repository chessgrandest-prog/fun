import { useState } from 'react';
import gamesData from './games.json';

function GameCard({ game }) {
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  return (
    <div className="game-card">
      <h2>{game.title}</h2>
      <img src={game.image} alt={game.title} />
      <a href="#" onClick={() => setIsOverlayOpen(true)}>
        View Details
      </a>
      {isOverlayOpen && (
        <GameOverlay game={game} onCloseClick={() => setIsOverlayOpen(false)} />
      )}
    </div>
  );
}

export default GameCard;
