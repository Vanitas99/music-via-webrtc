import express, { Router } from "express";
import { v4 as uuid } from "uuid";
import { Server, Socket } from "socket.io";
import http from "http";
import path from 'path';
import cors from "cors";
import url from 'url';

type MuteState = "muted" | "unmuted";
type UserID = string;
type RoomID = string;

type UserInfo = {
    name: string,
    audio: MuteState
}

type RoomState = {
    users: Map<UserID, UserInfo>;
}

const PORT = process.env.PORT || 5500;
const MAX_USER_PER_ROOM = 2;

let rooms: Map<RoomID, RoomState> = new Map();
let userRoomMap: Map<UserID, RoomID> = new Map();

console.log(path.resolve());

const app = express();
const httpServer = http.createServer(app);
app.use(cors());
app.use("/Public", express.static(path.join(path.resolve() ,'/Public')));
app.use("/index.js", express.static(path.join(path.resolve(), "dist/index.js")));
app.use("/sidebar.css", express.static(path.join(path.resolve(), "dist/sidebar.css")))
app.use("/Public/Sounds",  express.static(path.join(path.resolve() ,'/Public/Sounds')));

const io = new Server(httpServer);

const setupUser = (socket: Socket) => {

    socket.on("disconnect", () => {
        if (userRoomMap.has(socket.id)) {
            const roomId = userRoomMap.get(socket.id)!;
            io.to('room-' + roomId).emit("participant-left", socket.id);
            socket.leave('room-' + roomId);
            userRoomMap.delete(socket.id);
            rooms.get(roomId)?.users.delete(socket.id); 
            console.log(`User ${socket.id} has left the room ${roomId}`);
        }
        console.log(`User ${socket.id} disconnected!`);
    });

    socket.on("new-room", (userName: string, state: MuteState) => {
        let newUsers = new Map<UserID, UserInfo>();
        newUsers.set(socket.id, {name: userName, audio: state});
        const newRoomId = uuid();
        rooms.set(newRoomId,{users: newUsers});
        userRoomMap.set(socket.id, newRoomId);
        socket.join('room-' + newRoomId);
        console.log(`User ${socket.id} created new Room with id ${newRoomId}`);
        socket.emit("new-room-created", newRoomId);
    });

    socket.on("change-mute-state", (state: MuteState) => {
        if (userRoomMap.has(socket.id)) {
            const roomId = 'room-' + userRoomMap.get(socket.id);
            socket.to(roomId).emit("user-changed-mute-state", socket.id, state);
        }
    });

    socket.on("join-room", (id: string, userName: string, state: MuteState) => {

        if (!rooms.has(id)) {
            socket.emit("err-join-room", "Room does not exist!");
            return;
        }
        if (rooms.get(id)?.users.size! >= MAX_USER_PER_ROOM) {
            socket.emit("err-join-room", "Room is already full!");
            return;
        }
        rooms.get(id)?.users.set(socket.id, {name: userName, audio: state});
        userRoomMap.set(socket.id, id);
        // Socket.io kann Websockets in sogenannten Rooms unterbringen und in diesem Room 
        // Broadcast Nachrichten verschicken.
        socket.join("room-" + id);
        console.log(`User ${socket.id} joined Room ${id}`);
        socket.to('room-' + id).emit("new-participant", socket.id, userName, state);
        socket.emit("you-joined-room", id);
    });

    // Wenn ein Nutzer einen Webrtc Offer schickt, dann ist dieser Ersteller des Raumes,
    // bzw. der jenige der den Anruf startet. Dementsprechend wird dieser Offer an alle Sockets im 
    // Websocket Room gebroadcastet.
    socket.on("webrtc-offer", (sdp: string, userName: string) => {
        console.log(`Received Call Offer from ${socket.id}`);
        if (userRoomMap.has(socket.id)) {
            const roomId = 'room-' + userRoomMap.get(socket.id);
            socket.to(roomId).emit("webrtc-offer", socket.id, userName, sdp);
        }
    });

    // Wenn Nutzer eine Webrtc Answer schickt, ist dieser ein einfacher Teilnehmer, der dem Raum
    // über einen Link oder durch Eingabe der RoomID in der UI beigetreten ist. 
    // Dementsprechend wird das SDP an alle Sockets im Room außer den sendenden Socket geschickt.
    socket.on("webrtc-answer", (sdp: string) => {
        console.log(`Received Call Answer from ${socket.id}`);
        if (userRoomMap.has(socket.id)) {
            const roomId = 'room-' + userRoomMap.get(socket.id);
            socket.to(roomId).emit("webrtc-answer", socket.id, sdp);
        }
    });

    socket.on("ice-candidates", (candidate: string) => {
        console.log(`Received Ice Candidates from ${socket.id}`);
        socket.broadcast.emit("ice-candidates", candidate);
    });
}

io.on("connection", (socket) => {
    console.log(`New user connected with new id: ${socket.id}`);
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