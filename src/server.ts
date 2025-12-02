/**
 * @fileoverview
 * Socket.io event configuration for handling voice transmission.
 * Integrated with its own TURN server in order to enable voice transmission.
 */

import express, { Request, Response } from "express";
import { Server } from "socket.io";
import cors from "cors";
import http from "http";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Tipos para salas y participantes
type MeetingId = string;
type UserId = string;

interface Meetings {
  [meetingId: string]: UserId[];
}

interface SocketData {
  userId: UserId;
  meetingId: MeetingId;
}

/**
 * Stores the meetings with their users.
 *
 * Structure:
 * ```ts
 * {
 *    [meetingId: string]: string[] // Array of userIds
 * }
 * ```
 *
 * Each meetingId represents a room, and each userId corresponds to a
 * participant currently inside that room.
 */
const meetings: Meetings = {};

/**
 * Maps each socket.id to its corresponding user and meeting metadata
 * 
 * Structure:
 * ``` ts
 * Map<socketId: string, { userId: string, meetingId: string }
 * ```
 * 
 * This is required because WebRTC signaling is done by userId, not socket.id
 */
const socketToUser = new Map<string, SocketData>();

/**
 * Configures all websocket events for the server in regard to voice transmission
 * and signals.
 * Including:
 *  - User joining a meeting
 *  - WebRTC signaling exchange
 *  - User disconnection
 *  - Cleanup of meeting/user mappings
 * 
 * The server ensures that events are emitted using `userId`, not socket.id,
 * so the client application remains abstracted from socket internals.
 * @param {Server} io - The Socket.io server instance
 * @returns {void}
 */
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  /**
   * User joins a meeting
   * 
   * Steps performed:
   * 1. Socket joins its meeting using meetingId
   * 2. Maps socketId -> { userId, meetingId } for lookup
   * 3. Adds the userId to the meeting user list
   * 4. Notifies other participants of the new user via `user-connected`
   * 
   * @event join-meeting
   * @param {MeetingId} meetingId - Unique ID of the Meeting
   * @param {UserId} userId - Identifier of the user joining
   */
  socket.on('join-meeting', (meetingId: MeetingId, userId: UserId) => {
    socket.join(meetingId);
    
    // NUEVO: Guardar el mapeo socket.id -> userData
    socketToUser.set(socket.id, { userId, meetingId });
    
    if (!meetings[meetingId]) meetings[meetingId] = [];
    meetings[meetingId].push(userId);

    // CORRECTO: Emitir userId, no socket.id
    socket.to(meetingId).emit('user-connected', userId);

    console.log(`User ${userId} joined meeting ${meetingId}`);
  });

  /**
   * Handles WebRTC signaling messages exchanged between users.
   * 
   * The client sends:
   * ```ts
   * {
   *  to: string,
   *  from: string,
   *  signalData: any
   * }
   * ```
   * 
   * The backend:
   * 1. Looks up the socket.id of the target user using `socketToUser`.
   * 2. Emits a `signal` event directly to that socket
   * 
   * @event signal
   * @param {{ to: string, from: string, signalData: any }} data
   */
  socket.on(
    'signal',
    (data: { to: string; from: string; signalData: any }) => {
      const { to, from, signalData } = data;
      
      const targetSocketId = Array.from(socketToUser.entries())
        .find(([_, data]) => data.userId === to)?.[0];
      
      if (targetSocketId) {
        io.to(targetSocketId).emit('signal', { from, signalData });
        console.log(`📡 Signal from ${from} to ${to}`);
      } else {
        console.warn(`⚠️ Target user ${to} not found`);
      }
    }
  );


  /**
   * 
   * Triggered before a socket fully disconects.
   * 
   * Used to:
   * 1. Retrieve the user metadata from socketToUser
   * 2. Remove the userId from the meeting list
   * 3. Notify other users in the room via `user-disconnected`
   * 4. Clean up socketToUser mapping
   */
  socket.on('disconnecting', () => {
    // CORRECTO: Obtener el userId del mapeo
    const userData = socketToUser.get(socket.id);
    
    if (userData) {
      const { userId, meetingId } = userData;
      
      if (meetings[meetingId]) {
        // Remover por userId, no por socket.id
        meetings[meetingId] = meetings[meetingId].filter(id => id !== userId);
        
        // Emitir userId, no socket.id
        socket.to(meetingId).emit('user-disconnected', userId);
        
        console.log(`👋 User ${userId} left meeting ${meetingId}`);
      }
      
      // Limpiar el mapeo
      socketToUser.delete(socket.id);
    }
  });

  /**
   * Triggered once the socket is fully disconnected.
   * Used only for logging.
   * 
   * @event disconnect
   */
  socket.on('disconnect', () => {
    console.log('🔌 Socket disconnected:', socket.id);
  });
});

/**
 * Provides TURN/STUN configuration neccesary for P2P connections
 * 
 * Endpoint: GET /voice-config
 * 
 * Returns:
 * ``` json
 * {
 *  "iceServers": [
 *   { "urls": "stun:stun.l.google.com:19302" },
 *   { 
 *     "urls": "turn:<TURN_URL>",
 *     "username": "<TURN_USER>",
 *     "credential": "<TURN_PASS>"
 *   }
 *  ]
 * }
 * ```
 * 
 * The TURN credentials are loaded from environment variables
 */
app.get('/voice-config', (req: Request, res: Response) => {
  res.json({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: `turn:${process.env.TURN_URL}`,
        username: process.env.TURN_USER,
        credential: process.env.TURN_PASS,
      }
    ]
  });
});

server.listen(PORT, () =>
  console.log(`🎤 Voice backend running on port ${PORT}`)
);