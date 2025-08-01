const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "https://cakmak-game.vercel.app",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Game state management
const rooms = new Map();
const players = new Map();

// Game logic
class GameRoom {
  constructor(roomId, roomName, creatorId) {
    this.roomId = roomId;
    this.roomName = roomName;
    this.players = [];
    this.currentTurn = 0;
    this.gameState = "waiting"; // waiting, playing, rps
    this.currentQuestion = null;
    this.currentReceiver = null;
    this.currentAnswer = null;
    this.rpsPlayers = [];
    this.rpsChoices = {};
    this.roundHistory = [];
    this.creatorId = creatorId; // Store the ID of the player who created the room
  }

  addPlayer(player) {
    if (this.players.length >= 8) return false; // Max 8 players
    this.players.push(player);
    return true;
  }

  removePlayer(playerId) {
    this.players = this.players.filter((p) => p.id !== playerId);
    if (this.players.length < 4 && this.gameState === "playing") {
      this.gameState = "waiting";
    }
  }

  startGame() {
    if (this.players.length >= 4) {
      this.gameState = "playing";
      // Start with a random player instead of always player 0
      this.currentTurn = Math.floor(Math.random() * this.players.length);
      return true;
    }
    return false;
  }

  getCurrentAsker() {
    return this.players[this.currentTurn];
  }

  nextTurn() {
    this.currentTurn = (this.currentTurn + 1) % this.players.length;
  }

  setQuestion(question, receiverId) {
    this.currentQuestion = question;
    this.currentReceiver = receiverId;
    this.gameState = "question_sent";
  }

  setAnswer(playerId) {
    this.currentAnswer = playerId;
    this.gameState = "rps";
    this.rpsPlayers = [this.currentReceiver, this.currentAnswer];
    // Ensure RPS choices are reset when a new RPS game starts
    this.rpsChoices = {};
  }

  setRPSChoice(playerId, choice) {
    this.rpsChoices[playerId] = choice;

    if (Object.keys(this.rpsChoices).length === 2) {
      return this.resolveRPS();
    }
    return null;
  }

  resolveRPS() {
    const [player1, player2] = this.rpsPlayers;
    const choice1 = this.rpsChoices[player1];
    const choice2 = this.rpsChoices[player2];

    const result = this.getRPSResult(choice1, choice2);

    // If it's a tie, only reset the choices and return the result
    if (result.tie) {
      this.rpsChoices = {};
      return result;
    }

    // Add to history
    this.roundHistory.push({
      question: this.currentQuestion,
      asker: this.getCurrentAsker().id,
      receiver: this.currentReceiver,
      answer: this.currentAnswer,
      rpsResult: result,
      revealed: result.receiverWins,
    });

    // Determine who asks the next question based on RPS result
    if (result.receiverWins) {
      // If Person B (receiver) wins, Person B gets the next turn
      this.currentTurn = this.players.findIndex(
        (p) => p.id === this.currentReceiver
      );
    } else {
      // If Person C (answer) wins, Person C gets the next turn
      this.currentTurn = this.players.findIndex(
        (p) => p.id === this.currentAnswer
      );
    }

    // Reset for next turn
    this.currentQuestion = null;
    this.currentReceiver = null;
    this.currentAnswer = null;
    this.rpsPlayers = [];
    this.rpsChoices = {};
    this.gameState = "playing";

    return result;
  }

  getRPSResult(choice1, choice2) {
    const beats = {
      rock: "scissors",
      paper: "rock",
      scissors: "paper",
    };

    if (choice1 === choice2) {
      return { winner: null, receiverWins: false, tie: true };
    }

    const answerWins = beats[choice2] === choice1; // answer'ın seçimi, receiver'a karşı kazanıyor mu?
    return {
      winner: answerWins ? this.currentAnswer : this.currentReceiver,
      receiverWins: !answerWins, // receiver kazanmışsa, soru gizli kalmalı
      tie: false,
    };
  }
}

// Socket.IO event handlers
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Handle chat messages
  socket.on(
    "send-chat-message",
    ({ roomId, message, senderId, senderName }) => {
      const room = rooms.get(roomId);
      if (room) {
        const chatMessage = {
          senderId,
          senderName,
          text: message,
          timestamp: new Date().toLocaleTimeString(),
        };

        io.to(roomId).emit("chat-message", chatMessage);
      }
    }
  );

  // Join room
  socket.on("join-room", ({ roomId, roomName, playerName }) => {
    let room = rooms.get(roomId);

    if (!room) {
      room = new GameRoom(roomId, roomName, socket.id);
      rooms.set(roomId, room);
    }

    const player = {
      id: socket.id,
      name: playerName,
      roomId: roomId,
    };

    if (room.addPlayer(player)) {
      players.set(socket.id, player);
      socket.join(roomId);

      io.to(roomId).emit("player-list-update", {
        players: room.players,
        gameState: room.gameState,
        currentTurn: room.currentTurn,
        rpsPlayers: room.rpsPlayers || [],
      });

      socket.emit("room-joined", { roomId, roomName });
    } else {
      socket.emit("error", { message: "Room is full or invalid" });
    }
  });

  // Start game
  socket.on("start-game", ({ roomId }) => {
    const room = rooms.get(roomId);
    // Check if the player trying to start the game is the room creator
    if (room && socket.id === room.creatorId && room.startGame()) {
      io.to(roomId).emit("game-started", {
        currentTurn: room.currentTurn,
        currentAsker: room.getCurrentAsker(),
      });
    } else if (room && socket.id !== room.creatorId) {
      // Notify the player that only the room creator can start the game
      socket.emit("error", {
        message: "Only the room creator can start the game",
      });
    }
  });

  // Ask question
  socket.on("ask-question", ({ roomId, question, receiverId }) => {
    const room = rooms.get(roomId);
    if (room && room.getCurrentAsker().id === socket.id) {
      room.setQuestion(question, receiverId);

      // Send question to receiver
      io.to(receiverId).emit("question-received", {
        question,
        asker: room.getCurrentAsker().name,
      });

      // Notify all players that question was sent
      io.to(roomId).emit("question-sent", {
        asker: room.getCurrentAsker().name,
        receiver: room.players.find((p) => p.id === receiverId)?.name,
      });
    }
  });

  // Select answer
  socket.on("select-answer", ({ roomId, answerId }) => {
    const room = rooms.get(roomId);
    if (room && room.currentReceiver === socket.id) {
      room.setAnswer(answerId);

      // Get player names for clarity
      const receiverName = room.players.find(
        (p) => p.id === room.currentReceiver
      )?.name;
      const answerName = room.players.find(
        (p) => p.id === room.currentAnswer
      )?.name;

      // Notify all players about the answer selection
      io.to(roomId).emit("answer-selected", {
        receiverName,
        answerName,
      });

      // Notify the selected player
      io.to(answerId).emit("rps-challenge", {
        challenger: receiverName,
      });

      // Notify all players that RPS is starting
      io.to(roomId).emit("rps-start", {
        player1: receiverName,
        player2: answerName,
        rpsPlayers: room.rpsPlayers,
      });
    }
  });

  // RPS choice
  socket.on("rps-choice", ({ roomId, choice }) => {
    const room = rooms.get(roomId);
    if (room && room.rpsPlayers.includes(socket.id)) {
      const result = room.setRPSChoice(socket.id, choice);

      if (result) {
        // Oyuncu bilgileri
        const receiver = room.players.find(
          (p) => p.id === room.currentReceiver
        );
        const answer = room.players.find((p) => p.id === room.currentAnswer);
        const nextAsker = room.getCurrentAsker();

        const receiverName = receiver?.name;
        const answerName = answer?.name;

        const receiverChoice = room.rpsChoices[room.currentReceiver];
        const answerChoice = room.rpsChoices[room.currentAnswer];

        // Sonucu yorumla
        const winner = room.players.find((p) => p.id === result.winner);
        const asker = room.roundHistory.at(-1)?.asker;
        const questionText = room.roundHistory.at(-1)?.question;

        let messageText = "";
        console.log(result);
        if (result.tie) {
          messageText = `🤝 Beraberlik! Taş-Kağıt-Makas tekrar oynanacak.`;
        } else if (result.receiverWins) {
          messageText = `🏆 ${winner.name} kazandı! Soru gizli kalacak.`;
        } else {
          messageText = `🏆 ${winner.name} kazandı! Soru: "${questionText}"`;
        }

        // ✅ Bu kez mesaj kazanan oyuncunun adıyla gönderiliyor
        io.to(roomId).emit("chat-message", {
          senderId: winner.id,
          senderName: winner.name,
          text: messageText,
          timestamp: new Date().toLocaleTimeString(),
        });

        // RPS sonucu gönder
        io.to(roomId).emit("rps-result", {
          result,
          question: { question: questionText },
          currentAsker: nextAsker,
          receiverName,
          answerName,
          receiverChoice,
          answerChoice,
        });

        // Beraberlik değilse sıradaki oyuncuyu güncelle
        if (!result.tie) {
          io.to(roomId).emit("player-list-update", {
            players: room.players,
            gameState: room.gameState,
            currentTurn: room.currentTurn,
            rpsPlayers: room.rpsPlayers || [],
          });
        }
      }
    }
  });

  // Skip question
  socket.on("skip-question", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.getCurrentAsker().id === socket.id) {
      room.nextTurn();
      io.to(roomId).emit("turn-skipped", {
        currentAsker: room.getCurrentAsker(),
      });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player) {
      const room = rooms.get(player.roomId);
      if (room) {
        room.removePlayer(socket.id);

        if (room.players.length === 0) {
          rooms.delete(player.roomId);
        } else {
          io.to(player.roomId).emit("player-list-update", {
            players: room.players,
            gameState: room.gameState,
            currentTurn: room.currentTurn,
          });
        }
      }
      players.delete(socket.id);
    }
    console.log("User disconnected:", socket.id);
  });
});

// API routes
app.get("/api/rooms", (req, res) => {
  const roomList = Array.from(rooms.values()).map((room) => ({
    id: room.roomId,
    name: room.roomName,
    playerCount: room.players.length,
    gameState: room.gameState,
  }));
  res.json(roomList);
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
