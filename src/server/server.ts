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
type SocketID = string;

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

/*

 */
let userToRoomMap: Map<UserID, RoomID> = new Map();

/*
 *   Zunächst wird die von Socket.io generierte ID des Websockets als UserID genutzt.  
 *  Falls ein User die Verbindung zum Server verliert, z.b. in Folge von starkem Packetverlust,
 *   wird bei einem Reconnect ein neuer Socket mit entsprechend anderer ID erstellt. Dem zufole 
 *  muss die der UserID (also die ID des alten Sockets) der des neuen Sockets zugeordnet werde.
 */
let socketToUserIDMap: Map<SocketID, UserID> = new Map();

console.log(path.resolve());

const app = express();
const httpServer = http.createServer(app);
app.use(cors());
app.use("/Public", express.static(path.join(path.resolve() ,'/Public')));
app.use("/index.js", express.static(path.join(path.resolve(), "dist/index.js")));
app.use("/sidebar.css", express.static(path.join(path.resolve(), "dist/sidebar.css")))
app.use("/Public/Sounds",  express.static(path.join(path.resolve() ,'/Public/Sounds')));

const io = new Server(httpServer);

const getUserId = (id: SocketID) : UserID => {
    if (!socketToUserIDMap.has(id)) return "";
    return socketToUserIDMap.get(id)!;
};

const deleteUnusedRooms = async () => {
    rooms.forEach(async (_, roomId: RoomID) => {
        const socketRoomName = 'room-' + roomId;
        const sockets = await io.in(socketRoomName).fetchSockets();
        console.log('ROOM: ' + roomId + " " + sockets.length + " Sockets")
        if (sockets.length == 0) {
            rooms.delete(roomId);
            console.log("Deleting room " + roomId);
        }
    })
};

const setupUser = (socket: Socket) => {
    socketToUserIDMap.set(socket.id, socket.id);

    socket.on("disconnect", (_) => {
        console.log(`User ${getUserId(socket.id)} disconnected!`);
    });

    socket.on("user-reconnected", (userId: string) => {
        console.log(`User ${userId} reconnected! New Socket ID is ${socket.id} but we still use old Socket ID as User ID!`);
        if (socketToUserIDMap.has(userId)) {
            socketToUserIDMap.set(socket.id, userId);
            const roomName = "room-" + userToRoomMap.get(userId);
            socket.join(roomName);
        }
    });

    socket.on("new-room", (userName: string, state: MuteState) => {
        let newUsers = new Map<UserID, UserInfo>();
        const userId = getUserId(socket.id);
        newUsers.set(userId, {name: userName, audio: state});
        const newRoomId = uuid();
        rooms.set(newRoomId,{users: newUsers});
        userToRoomMap.set(userId, newRoomId);
        socket.join('room-' + newRoomId);
        console.log(`User ${userId} created new Room with id ${newRoomId}`);
        console.log(rooms.forEach((val, key) => {console.log(key)}));
        socket.emit("new-room-created", newRoomId, userId);
    });

    socket.on("change-mute-state", (state: MuteState) => {
        const userId = getUserId(socket.id);
        if (userToRoomMap.has(userId)) {
            const roomId = 'room-' + userToRoomMap.get(userId);
            socket.to(roomId).emit("user-changed-mute-state", userId, state);
        }
    });

    socket.on("join-room", (roomId: string, userName: string, state: MuteState) => {

        if (!rooms.has(roomId)) {
            socket.emit("err-join-room", "Room does not exist!");
            return;
        }
        if (rooms.get(roomId)?.users.size! >= MAX_USER_PER_ROOM) {
            socket.emit("err-join-room", "Room is already full!");
            return;
        }
        const userId = getUserId(socket.id);
        rooms.get(roomId)?.users.set(userId, {name: userName, audio: state});
        userToRoomMap.set(userId, roomId);
        // Socket.io kann Websockets in sogenannten Rooms unterbringen und in diesem Room 
        // Broadcast Nachrichten verschicken.
        socket.join("room-" + roomId);
        console.log(`User ${userId} joined Room ${roomId}`);
        socket.to('room-' + roomId).emit("new-participant", userId, userName, state);
        socket.emit("you-joined-room", roomId, userId);
    });

    socket.on("leave-room", () => {
        const userId = getUserId(socket.id);
        if (userToRoomMap.has(userId)) {
            const roomId = userToRoomMap.get(userId);
            if (roomId) {
                console.log(`User ${userId} successfully left the room ${roomId}`);
                socket.to('room-' + roomId).emit("participant-left", userId);
                userToRoomMap.delete(userId);
                rooms.get(roomId)!.users.delete(userId);
                if (rooms.get(roomId)?.users.size == 0) {
                    rooms.delete(roomId);
                }
                socket.leave('room-' + roomId);
            }
        }
    });

    socket.on("initial-webrtc-offer", (userIdToSendTo: string, sdp: string, userName: string) => {
        const userId = getUserId(socket.id);
        console.log(`Received Call Offer from ${userId}`);
        if (userToRoomMap.has(userId)) {
            socket.broadcast.to(userIdToSendTo).emit("initial-webrtc-offer", userId, userName, sdp);
        }
    });

    socket.on('webrtc-offer', (userIdToSendTo: string, sdp: string) => {
        const userId = getUserId(socket.id);
        console.log(`Received negotiation offer from ${userId}`);
        if (userToRoomMap.has(userId)) {
            socket.broadcast.to(userIdToSendTo).emit("webrtc-offer", userId, sdp);
        }
    });
    
    /* Wenn Nutzer eine Webrtc Answer schickt, ist dieser ein einfacher Teilnehmer, der dem Raum
     * über einen Link oder durch Eingabe der RoomID in der UI beigetreten ist. 
     * Dementsprechend wird das SDP an alle Sockets im Room außer den sendenden Socket geschickt.
     */
    socket.on("webrtc-answer", (userIdToSendTo: string, sdp: string) => {
        const userId = getUserId(socket.id);
        console.log(`Received Call Answer from ${userId}`);
        if (userToRoomMap.has(userId)) {
            socket.broadcast.to(userIdToSendTo).emit("webrtc-answer", userId, sdp);
        }
    });

    socket.on("ice-candidates", (userIdToSendTo: string, candidate: string) => {
        const userId = getUserId(socket.id);
        console.log(`Received Ice Candidates from ${userId} | Send to ${userIdToSendTo}`);
        socket.broadcast.to(userIdToSendTo).emit("ice-candidates", candidate);
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

/* Wenn ein Nutzer über diese URL connected, dann wird er auf die "/" Route umgeleitet,
 * auf welcher er dann HTML und JS gesendet bekommt. Durch den URL Parameter roomId weiß die UI,
 * dass der Nutzer diesem Raum beitreten möchte und zeigt entsprechendes HTML an.
 */
app.get("/room/:roomId", (req, res) => {
    const urlWithRoomId = url.format({pathname: "/", query: {"roomId": req.params.roomId}})
    res.redirect(urlWithRoomId);
});

setInterval(() => deleteUnusedRooms() ,5000);

httpServer.listen(PORT, () => {console.log(`Listening on port ${PORT}`)});