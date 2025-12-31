import { useState } from 'react';
import gamesData from './games.json';

function GameOverlay({ game, onCloseClick }) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className="game-overlay">
      <h2>{game.title}</h2>
      <p>{game.description}</p>
      <iframe src={game.url} frameBorder="0" onLoad={() => setIsLoading(false)} />
      {isLoading && (
        <div className="loading-indicator">
          <span>Loading...</span>
        </div>
      )}
      <button type="button" onClick={onCloseClick}>
        Close
      </button>
    </div>
  );
}

export default GameOverlay;
