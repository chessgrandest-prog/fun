import { useState } from 'react';
import gamesData from './games.json';

function IndexPage() {
  const [games, setGames] = useState(gamesData);

  return (
    <div className="index-page">
      {games.map((game) => (
        <GameCard game={game} key={game.title} />
      ))}
    </div>
  );
}

export default IndexPage;
