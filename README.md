# Cakmak Game Server

Backend server for the Cakmak Game - a real-time multiplayer social interaction game.

## Features

- Real-time multiplayer game using Socket.IO
- Room management (create, join, leave)
- Turn-based gameplay
- Rock-paper-scissors mechanics
- Secret question and answer system
- Player management and disconnection handling

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/cakmak-game
NODE_ENV=development
```

3. Run the server:
```bash
# Development mode
npm run dev

# Production mode
npm start
```

## Socket.IO Events

### Client to Server
- `join-room`: Join a game room
- `start-game`: Start the game (requires 4+ players)
- `ask-question`: Send a secret question to another player
- `select-answer`: Select a player as the answer
- `rps-choice`: Make rock-paper-scissors choice
- `skip-question`: Skip current turn

### Server to Client
- `room-joined`: Confirmation of room join
- `player-list-update`: Updated player list and game state
- `game-started`: Game has started
- `question-received`: Secret question received (receiver only)
- `question-sent`: Question sent notification
- `rps-challenge`: RPS challenge notification
- `rps-start`: RPS round starting
- `rps-result`: RPS result and next turn
- `secret-revealed`: Secret question revealed to all
- `turn-skipped`: Turn skipped notification
- `error`: Error messages

## API Endpoints

- `GET /api/rooms`: Get list of active rooms

## Game Flow

1. Players join a room (4-8 players)
2. Game starts when 4+ players are ready
3. Current player asks a secret question to another player
4. Receiver selects someone as the answer
5. Receiver and selected player play rock-paper-scissors
6. If receiver wins: secret stays private
7. If receiver loses: secret is revealed to all
8. Next player's turn 