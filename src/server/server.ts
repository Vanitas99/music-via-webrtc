import express, { Router } from "express";
import { v4 as uuid } from "uuid";
import { Server, Socket } from "socket.io";
import http from "http";
import path from 'path';
import cors from "cors";
import url from 'url';

type MuteState = "muted" | "unmuted";
type User = {
    id: string,
    name: string,
    audio: MuteState
}

type RoomState = {
    users: User[];
}

const PORT = process.env.PORT || 5500;
const MAX_USER_PER_ROOM = 2;

let rooms: Map<string, RoomState> = new Map();

console.log(path.resolve());

const app = express();
const httpServer = http.createServer(app);
app.use(cors());
app.use("/Public", express.static(path.join(path.resolve() ,'/Public')));
app.use("/index.js", express.static(path.join(path.resolve(), "dist/index.js")));

const io = new Server(httpServer);

const setupUser = (socket: Socket) => {

    socket.on("new-room", (userName: string, state: MuteState) => {
        let users: User[] = [{audio: state, id:socket.id, name: userName}];
        const newId = uuid();
        rooms.set(newId,{users});
        socket.join(newId);
        console.log(`User ${socket.id} created new Room with id ${newId}`);
        socket.emit("new-room-created", newId);
    });

    socket.on("change-mute-state", (state: MuteState) => {
        socket.broadcast.emit("user-changed-mute-state", socket.id, state);
    });

    socket.on("join-room", (id: string, userName: string, state: MuteState) => {

        if (!rooms.has(id)) {
            socket.emit("err-join-room", "Room does not exist!");
            return;
        }
        if (rooms.get(id)?.users?.length! >= 2) {
            socket.emit("err-join-room", "Room is already full!");
            return;
        }
        rooms.get(id)?.users.push({id: socket.id, name: userName, audio: state});
        // Socket.io kann Websockets in sogenannten Rooms unterbringen und in diesem Room 
        // Broadcast Nachrichten verschicken.
        socket.join(id);
        console.log(`User ${socket.id} joined Room ${id}`);
        socket.emit("you-joined-room", id);
        socket.broadcast.emit("new-participant", socket.id, userName, state);
    });

    // Wenn ein Nutzer einen Webrtc Offer schickt, dann ist dieser Ersteller des Raumes,
    // bzw. der jenige der den Anruf startet. Dementsprechend wird dieser Offer an alle Sockets im 
    // Websocket Room gebroadcastet.
    socket.on("webrtc-offer", (sdp: string, userName: string) => {
        console.log(`Received Call Offer from ${socket.id}`);
        socket.broadcast.emit("webrtc-offer", socket.id, userName, sdp);
    });

    // Wenn Nutzer eine Webrtc Answer schickt, ist dieser ein einfacher Teilnehmer, der dem Raum
    // über einen Link oder durch Eingabe der RoomID in der UI beigetreten ist. 
    // Dementsprechend wird das SDP an alle Sockets im Room außer den sendenden Socket geschickt.
    socket.on("webrtc-answer", (sdp: string) => {
        console.log(`Received Call Answer from ${socket.id}`);
        socket.broadcast.emit("webrtc-answer", socket.id, sdp);
    });

    socket.on("ice-candidates", (candidate: string) => {
        console.log(`Received Ice Candidates from ${socket.id}`);
        socket.broadcast.emit("ice-candidates", candidate);
    });
}

io.on("connection", (socket) => {
    console.log(`New user connected with new id: ${socket.id}`);
    socket.on("disconnect", () => {
        socket.broadcast.emit("participant-left", socket.id);
        console.log(`User ${socket.id} disconnected!`);
    });
    // Jede neue Websocket Verbindung repräsentiert einen Nutzer
    setupUser(socket);
})

app.get("/", (req, res) => {
    res.sendFile(path.join(path.resolve(), "/dist/index.html"));
});

// Wenn ein Nutzer über diese URL connected, dann wird er auf die "/" Route umgeleitet,
// auf welcher er dann HTML und JS gesendet bekommt. Durch den URL Parameter roomId weiß die UI,
// dass der Nutzer diesem Raum beitreten möchte und zeigt entsprechendes HTML an.
app.get("/room/:roomId", (req, res) => {
    const urlWithRoomId = url.format({pathname: "/", query: {"roomId": req.params.roomId}})
    res.redirect(urlWithRoomId);
});

httpServer.listen(PORT, () => {console.log(`Listening on port ${PORT}`)});