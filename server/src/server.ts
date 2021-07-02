import express from "express";
import { v4 as uuid } from "uuid";
import { Server } from "socket.io";
import http from "http";

import cors from "cors";

const app = express();
const httpServer = http.createServer(app);
app.use(cors());
const io = new Server(httpServer);

io.on("connection", (socket) => {
    console.log(`New user connected with new id: ${uuid()}`);
    socket.on("disconnect", () => {
        console.log(`User ${uuid} disconnected!`);
    })
})

app.get("/", (req, res) =>{
    return res.send(uuid());
} );

app.get("/", (req, res) => {
    
});
const port = 8000;


httpServer.listen(port, () => {console.log(`Listening on port ${port}`)});