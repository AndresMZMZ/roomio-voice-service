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


const meetings: Meetings = {};

io.on('connection', (socket) => {
  console.log('New connection:', socket.id)

  socket.on('join-meeting', (meetingId: MeetingId, userId: UserId) => {
    socket.join(meetingId)
    if (!meetings[meetingId]) meetings[meetingId] = [];
    meetings[meetingId].push(userId)

    socket.to(meetingId).emit('user-connected', userId)

    console.log(`User ${userId} joined meeting ${meetingId}`)

  })

  socket.on(
    'signal',
    (data: { to: string; from: string; signalData: any }) => {
      const { to, from, signalData } = data
      io.to(to).emit('signal', { from, signalData });
    }
  )

  socket.on('disconnecting', () => {
    for (const meetingId of socket.rooms) {
      if (meetings[meetingId]) {
        meetings[meetingId] = meetings[meetingId].filter(id => id !== socket.id)
        socket.to(meetingId).emit('user-disconnected', socket.id)

      }
    }
  })
})

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
  })
})


server.listen(PORT, () =>
  console.log(`Voice backend running on port ${PORT}`)
);

