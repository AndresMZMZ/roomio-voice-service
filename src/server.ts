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

const meetings: Meetings = {};
// NUEVO: Mapeo de socket.id -> {userId, meetingId}
const socketToUser = new Map<string, SocketData>();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

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

  socket.on(
    'signal',
    (data: { to: string; from: string; signalData: any }) => {
      const { to, from, signalData } = data;
      
      // CORRECTO: Buscar el socket.id del usuario destino
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

  socket.on('disconnect', () => {
    console.log('🔌 Socket disconnected:', socket.id);
  });
});

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