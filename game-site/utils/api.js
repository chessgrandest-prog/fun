import axios from 'axios';

const API_URL = 'https://my-json-server.typicode.com/your-username/games-data';

export const fetchGamesData = async () => {
  try {
    const response = await axios.get(API_URL);
    return response.data;
  } catch (error) {
    console.error('Failed to fetch games data', error);
  }
};
