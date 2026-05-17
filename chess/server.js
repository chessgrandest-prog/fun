const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const uuidv4 = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'users.json');

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Persistent database
let users = {};

if (fs.existsSync(DATA_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Error reading users database:', err);
    users = {};
  }
}

function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// REST endpoints for Auth
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const normalizedUsername = username.trim().toLowerCase();
  if (users[normalizedUsername]) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    users[normalizedUsername] = {
      id: uuidv4(),
      username: username.trim(),
      passwordHash: hashedPassword,
      friends: [],
      rating: 1500,
      stats: { won: 0, lost: 0, drawn: 0 }
    };
    saveUsers();
    res.json({ success: true, message: 'Account created successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const user = users[normalizedUsername];
  if (!user) {
    return res.status(400).json({ error: 'Invalid username or password' });
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    return res.status(400).json({ error: 'Invalid username or password' });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      rating: user.rating,
      friends: user.friends,
      stats: user.stats
    }
  });
});

// Socket.io Real-time Social & Game engine
const activeConnections = {}; // socketId -> user details
const onlineUsers = {}; // userId -> socketId
const activeGames = {}; // gameId -> gameDetails

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register-active-user', (user) => {
    if (!user || !user.id) return;
    
    // Register mapping
    activeConnections[socket.id] = user;
    onlineUsers[user.id] = socket.id;
    
    // Notify all of updated online list
    broadcastOnlineStatus();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const user = activeConnections[socket.id];
    if (user) {
      delete onlineUsers[user.id];
      delete activeConnections[socket.id];
    }
    broadcastOnlineStatus();
  });

  // Fetch online list
  socket.on('get-online-users', () => {
    socket.emit('online-users-list', getOnlineUsersList());
  });

  // Add friend request
  socket.on('add-friend', ({ targetUsername }) => {
    const sender = activeConnections[socket.id];
    if (!sender) return;

    const normalizedTarget = targetUsername.trim().toLowerCase();
    const targetUser = users[normalizedTarget];

    if (!targetUser) {
      return socket.emit('notification', { type: 'error', message: `User "${targetUsername}" not found.` });
    }

    if (normalizedTarget === sender.username.toLowerCase()) {
      return socket.emit('notification', { type: 'error', message: 'You cannot add yourself as a friend.' });
    }

    // Add to sender's friend list if not already there
    const senderNorm = sender.username.toLowerCase();
    const senderDb = users[senderNorm];
    
    if (senderDb.friends.includes(targetUser.username)) {
      return socket.emit('notification', { type: 'error', message: `"${targetUser.username}" is already your friend.` });
    }

    senderDb.friends.push(targetUser.username);
    // Auto reciprocate friend for ease of playing local/dev
    if (!targetUser.friends.includes(senderDb.username)) {
      targetUser.friends.push(senderDb.username);
    }
    
    saveUsers();

    // Update client DB caches
    socket.emit('friend-added-success', { 
      friends: senderDb.friends,
      message: `Successfully added ${targetUser.username} as a friend!`
    });

    // Notify target user if online to update their friend list
    const targetSocketId = onlineUsers[targetUser.id];
    if (targetSocketId) {
      io.to(targetSocketId).emit('friend-added-notify', {
        friendName: senderDb.username,
        friends: targetUser.friends
      });
    }

    broadcastOnlineStatus();
  });

  // Challenge dynamic system
  socket.on('send-challenge', ({ targetUserId, timerDuration }) => {
    const challenger = activeConnections[socket.id];
    if (!challenger) return;

    const targetSocketId = onlineUsers[targetUserId];
    if (!targetSocketId) {
      return socket.emit('notification', { type: 'error', message: 'User is currently offline.' });
    }

    const challengeId = uuidv4();
    io.to(targetSocketId).emit('incoming-challenge', {
      challengeId,
      challenger: {
        id: challenger.id,
        username: challenger.username,
        rating: challenger.rating || 1500
      },
      timerDuration
    });

    socket.emit('challenge-sent', { challengeId, targetUserId });
  });

  socket.on('accept-challenge', ({ challengeId, challengerId, timerDuration }) => {
    const accepter = activeConnections[socket.id];
    if (!accepter) return;

    const challengerSocketId = onlineUsers[challengerId];
    if (!challengerSocketId) {
      return socket.emit('notification', { type: 'error', message: 'Challenger went offline.' });
    }

    const gameId = challengeId; // Reuse challengeId as gameId
    
    // Choose colors randomly
    const challengerColor = Math.random() < 0.5 ? 'w' : 'b';
    const accepterColor = challengerColor === 'w' ? 'b' : 'w';

    const gameDetails = {
      gameId,
      players: {
        white: challengerColor === 'w' ? challengerId : accepter.id,
        black: challengerColor === 'b' ? challengerId : accepter.id,
        whiteName: challengerColor === 'w' ? activeConnections[challengerSocketId].username : accepter.username,
        blackName: challengerColor === 'b' ? activeConnections[challengerSocketId].username : accepter.username,
      },
      timerDuration,
      status: 'active',
      moves: []
    };

    activeGames[gameId] = gameDetails;

    // Send game initiation details to both
    io.to(socket.id).emit('game-started', {
      gameId,
      yourColor: accepterColor,
      opponentName: activeConnections[challengerSocketId].username,
      opponentRating: activeConnections[challengerSocketId].rating || 1500,
      timerDuration,
      gameDetails
    });

    io.to(challengerSocketId).emit('game-started', {
      gameId,
      yourColor: challengerColor,
      opponentName: accepter.username,
      opponentRating: accepter.rating || 1500,
      timerDuration,
      gameDetails
    });
  });

  socket.on('decline-challenge', ({ challengerId }) => {
    const challengerSocketId = onlineUsers[challengerId];
    if (challengerSocketId) {
      const decliner = activeConnections[socket.id];
      io.to(challengerSocketId).emit('challenge-declined', {
        declinerName: decliner ? decliner.username : 'Opponent'
      });
    }
  });

  // Real-time Move Syncing
  socket.on('make-move', ({ gameId, move, fen }) => {
    const game = activeGames[gameId];
    if (!game) return;

    game.moves.push(move);
    
    // Find the opponent
    const sender = activeConnections[socket.id];
    const opponentId = game.players.white === sender.id ? game.players.black : game.players.white;
    const opponentSocketId = onlineUsers[opponentId];

    if (opponentSocketId) {
      io.to(opponentSocketId).emit('receive-move', { move, fen });
    }
  });

  // Game over / resignation sync
  socket.on('game-over-sync', ({ gameId, result, winnerId }) => {
    const game = activeGames[gameId];
    if (!game) return;

    game.status = 'finished';
    
    const sender = activeConnections[socket.id];
    const opponentId = game.players.white === sender.id ? game.players.black : game.players.white;
    const opponentSocketId = onlineUsers[opponentId];

    if (opponentSocketId) {
      io.to(opponentSocketId).emit('game-over-notify', { result, winnerId });
    }

    updateGameStats(game, winnerId);
    delete activeGames[gameId];
  });

  socket.on('resign', ({ gameId }) => {
    const game = activeGames[gameId];
    if (!game) return;

    game.status = 'finished';
    const sender = activeConnections[socket.id];
    const opponentId = game.players.white === sender.id ? game.players.black : game.players.white;
    const winnerId = opponentId;

    const opponentSocketId = onlineUsers[opponentId];
    if (opponentSocketId) {
      io.to(opponentSocketId).emit('game-over-notify', { result: 'resignation', winnerId });
    }
    socket.emit('game-over-notify', { result: 'resignation', winnerId });

    updateGameStats(game, winnerId);
    delete activeGames[gameId];
  });

  socket.on('offer-draw', ({ gameId }) => {
    const game = activeGames[gameId];
    if (!game) return;
    const sender = activeConnections[socket.id];
    const opponentId = game.players.white === sender.id ? game.players.black : game.players.white;
    const opponentSocketId = onlineUsers[opponentId];

    if (opponentSocketId) {
      io.to(opponentSocketId).emit('draw-offered');
    }
  });

  socket.on('accept-draw', ({ gameId }) => {
    const game = activeGames[gameId];
    if (!game) return;

    game.status = 'finished';
    const sender = activeConnections[socket.id];
    const opponentId = game.players.white === sender.id ? game.players.black : game.players.white;

    const opponentSocketId = onlineUsers[opponentId];
    if (opponentSocketId) {
      io.to(opponentSocketId).emit('game-over-notify', { result: 'draw_agreed', winnerId: null });
    }
    socket.emit('game-over-notify', { result: 'draw_agreed', winnerId: null });

    updateGameStats(game, null);
    delete activeGames[gameId];
  });
});

function updateGameStats(game, winnerId) {
  try {
    const wUser = Object.values(users).find(u => u.id === game.players.white);
    const bUser = Object.values(users).find(u => u.id === game.players.black);

    if (wUser && bUser) {
      if (winnerId === game.players.white) {
        wUser.stats.won++;
        bUser.stats.lost++;
        wUser.rating += 15;
        bUser.rating -= 15;
      } else if (winnerId === game.players.black) {
        bUser.stats.won++;
        wUser.stats.lost++;
        bUser.rating += 15;
        wUser.rating -= 15;
      } else {
        // Draw
        wUser.stats.drawn++;
        bUser.stats.drawn++;
      }
      saveUsers();
      broadcastOnlineStatus();
    }
  } catch (e) {
    console.error('Error updating game stats:', e);
  }
}

function getOnlineUsersList() {
  return Object.values(activeConnections).map(u => ({
    id: u.id,
    username: u.username,
    rating: u.rating
  }));
}

function broadcastOnlineStatus() {
  io.emit('online-users-list', getOnlineUsersList());
}

server.listen(PORT, () => {
  console.log(`NeonSkull Server running at http://localhost:${PORT}`);
});
