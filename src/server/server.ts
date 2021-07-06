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

const port = process.env.PORT || 5500;
let rooms: Map<string, RoomState> = new Map();

console.log(path.resolve());

const app = express();
const httpServer = http.createServer(app);
app.use(cors());
app.use("/Public", express.static(path.join(path.resolve() ,'/Public')));
app.use("/index.js", express.static(path.join(path.resolve(), "dist/index.js")));
app.use("/room/Public", express.static(path.join(path.resolve() ,'/Public')));
app.use("/room/index.js", express.static(path.join(path.resolve(), "dist/index.js")));

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

    socket.on("join-room", (id: string, userName: string, state: MuteState) => {
        
        if (!rooms.has(id)) {
            socket.emit("err-room-not-found");
            return;
        }
        rooms.get(id)?.users.push({id: socket.id, name: userName, audio: state});
        socket.join(id);
        console.log(`User ${socket.id} joined Room ${id}`);
        socket.emit("you-joined-room", id);
        socket.broadcast.emit("new-participant", { userId: socket.id, roomId: id, userName: "Test Name", audio: state });
    });

    socket.on("webrtc-offer", (sdp: string, roomId: string) => {
        console.log(`Received Call Offer from ${socket.id}`);
        console.log(sdp);
        socket.broadcast.emit("webrtc-offer", sdp, roomId);
    });

    socket.on("webrtc-answer", (sdp: string, roomId: string) => {
        console.log(`Received Call Answer from ${socket.id}`);
        socket.broadcast.emit("webrtc-answer", sdp, roomId);
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
    })
    setupUser(socket);
})

app.get("/", (req, res) => {
    res.sendFile(path.join(path.resolve(), "/dist/index.html"));
});

app.get("/room/:roomId", (req, res) => {
    const urlWithRoomId = url.format({pathname: "/", query: {"roomId": req.params.roomId}})
    res.redirect(urlWithRoomId);
});

httpServer.listen(port, () => {console.log(`Listening on port ${port}`)});