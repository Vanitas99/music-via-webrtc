import { io, Socket } from "socket.io-client";
import { Toast , Modal} from "bootstrap";
import { connect } from "http2";
import { Stream } from "stream";

let isDev = process.env.NODE_ENV != "production";

type MuteState = "muted" | "unmuted";
type SharingState = "sharing" | "not-sharing";

let localMicState: MuteState = "muted";
let localSpeakerState: MuteState = "unmuted";
let localCamSate: SharingState = "not-sharing";
let localSSState: SharingState = "not-sharing";

let currentMic: string;
let currentSpeaker: string;
let currentCam: string;

let connections: RTCPeerConnection[] = [];
let remoteStream = new MediaStream();
let deviceSelections: HTMLUListElement[] = [];

let entryModal: Modal;
let roomIdToJoin: string;

let localStream: MediaStream;
let remoteStreams: MediaStream[] = [];

const API_URL = location.origin.replace('http', 'ws');

const MIC_MUTE_URL = "url(\"../Public/microphone-mute.svg\")";
const MIC_UNMUTE_URL = "url(\"../Public//microphone-unmute.svg\")";
const SPEAKER_MUTE_URL = "url(\"../Public/speaker-mute.svg\")";
const SPEAKER_UNMUTE_URL = "url(\"../Public/speaker-unmute.svg\")";

const ENABLED_COLOR = "rgb(152, 226, 41)";
const DISABLED_COLOR = "rgb(182, 0, 0";

// Free public STUN servers provided by Google.
const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ],
  }

const populateDeviceList= async () => {

    let [ micSelection, speakerSelection, camSelection] = deviceSelections; 
    deviceSelections.forEach(obj => {
        while (obj.firstChild) {
            obj.removeChild(obj.firstChild);
        }
    });

    const devices = await navigator.mediaDevices.enumerateDevices();
    devices.forEach( 
        device => {
            console.log(device.label, device.kind, device.groupId)
            let newEntry = document.createElement("li");
            let a = document.createElement("a");
            a.className = "dropdown-item ";
            a.id = device.deviceId;
            a.href = "#";
            a.innerText = device.label;
            newEntry.appendChild(a);
            if (device.kind == "audioinput") {
                micSelection.appendChild(newEntry);
            } else if (device.kind == "audiooutput") {
                speakerSelection.appendChild(newEntry);
            } else {
                camSelection.appendChild(newEntry);
            }
    });  
};


const setupUi = (socket: Socket) => {

    let bMic = $("#micButton");
    bMic?.on('click', (e) => {
        const element = e.target;
        localMicState = localMicState == "muted" ? "unmuted" : "muted";
        ((document.querySelector('#localVideo') as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0].enabled = localMicState == "unmuted";

        element.style.backgroundImage = localMicState == "muted" ? MIC_MUTE_URL : MIC_UNMUTE_URL;
        element.style.backgroundColor = localMicState == "muted" ? DISABLED_COLOR : ENABLED_COLOR;
    });
    bMic.css("backgroundColor", MIC_MUTE_URL);
    bMic.css("backgroundColor", DISABLED_COLOR);

    let bSpeaker = $("#speakerButton");
    bSpeaker?.on('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        
        localSpeakerState = localSpeakerState == "muted" ? "unmuted" : "muted";
        element.style.backgroundImage = localSpeakerState == "muted" ? SPEAKER_MUTE_URL : SPEAKER_UNMUTE_URL;
        element.style.backgroundColor = localSpeakerState == "muted" ? DISABLED_COLOR : ENABLED_COLOR;

        remoteStreams.forEach(stream => {
            stream.getAudioTracks().forEach(track => {
                track.enabled = localSpeakerState == "unmuted";
            })
        })
    });
    bSpeaker.css("backgroundImage", SPEAKER_UNMUTE_URL);
    bSpeaker.css("backgroundColor", ENABLED_COLOR);


    let bScreenSharing = $("#screenshareButton");
    bScreenSharing?.on('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localSSState = localSSState == "not-sharing" ? "sharing" : "not-sharing";
        element.style.backgroundColor = localSSState == "sharing" ? ENABLED_COLOR : "";
    });


    let bCam = $("#camButton");
    bCam?.on('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localCamSate = localCamSate == "sharing" ? "not-sharing" : "sharing";
        element.style.backgroundColor = localCamSate == "sharing" ? ENABLED_COLOR : "";
        localStream.getVideoTracks().forEach(track => {
            track.enabled = localCamSate == "sharing";
        });
    });
    deviceSelections.push(
        document.querySelector("#micSelection")!,
        document.querySelector("#speakerSelection")!, 
        document.querySelector("#camSelection")!
    );
    populateDeviceList();

    let bJoinRoom = $(".joinRoom");
    bJoinRoom.on("click", (e) => {
        if (socket.connected) {
            socket.on("you-joined-room", (roomId: string) => {
                console.log(`You joined room ${roomId}`);
                entryModal.hide();
                entryModal.dispose();
            });
            const id = roomIdToJoin ? roomIdToJoin : $("#roomId").val();
            const userName = $(".user-name-input").val();
            console.log(id);
            console.log(userName);
            socket.emit("join-room", id, userName, localMicState);

        } else {
            alert("Not connected to webserver");
        }
    });

    let bCreateRoom = $("#createRoom");
    bCreateRoom.on("click", () => {
        if (socket.connected) {
            socket.on("new-room-created", (roomId: string) => {
                console.log(roomId);
                entryModal.hide();
                entryModal.dispose();
            });
            const userName = $(".user-name-input").val();
            socket.emit("new-room", userName, localMicState);
        } else {
           
        }
    });

    socket.on("err-room-not-found", () => {
        alert("Room does not exist!");
    })

    socket.on("webrtc-offer", async (sdp: string, roomId: string) => {
        console.log("Received Offer from Room Owner!");
        let remoteSdp : RTCSessionDescriptionInit = JSON.parse(sdp);
        let conn = setupPeerConnection(socket);
        connections.push(conn);
        try {
            await conn.setRemoteDescription(remoteSdp);
            await sendAnwser(conn, socket, roomId);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on("webrtc-answer", async (sdp: string, roomId: string) => {
        let remoteSdp: RTCSessionDescriptionInit = JSON.parse(sdp);
        console.log("Received Answer from Participant: " + sdp);
        await connections[0].setRemoteDescription(remoteSdp);
    });

    socket.on("new-participant", async ({ userId, roomId, userName, audio }
        : {userId: string, roomId: string, userName: string, audio: MuteState}) => {
            console.log(`User ${userName} (${userId}) joined the room ${roomId}`);
            let conn = setupPeerConnection(socket);
            connections.push(conn);
            await sendOffer(conn, socket, roomId);
            
    });
    socket.on("participant-left", (id: string) => {
        console.log("Participant left: " + id);
    });

}

const setLocalStream = async (audio: boolean, {width, height}: {width: number, height: number}) => {
    try {
        const audioEnabled = localMicState == "unmuted";
        const videoEnabled = localCamSate == "sharing";
        localStream = await navigator.mediaDevices.getUserMedia({video: {width: width, height: height}, audio: audio});
        localStream.getAudioTracks()[0].enabled = audioEnabled;
        localStream.getVideoTracks()[0].enabled = videoEnabled;
        (document.querySelector('#localVideo') as HTMLVideoElement).srcObject = localStream;
    } catch(err ) {
        console.log(err);
    };
};

const setRemoteStream = (stream: MediaStream) => {
    (document.querySelector('#remoteVideo') as HTMLVideoElement).srcObject = stream;
};

const removeRemoteStream = () => {
    (document.querySelector('#remoteVideo') as HTMLVideoElement).srcObject = null;
};

const addTrackToStream = (stream: MediaStream, track: MediaStreamTrack) => {

    stream.addTrack(track);
}

const setupPeerConnection = (socket: Socket) : RTCPeerConnection => {
    let conn = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach(track => {
        conn.addTrack(track);
    });
    conn.ontrack = (trackEvent) => {
        console.log(trackEvent);
        addTrackToStream(remoteStream, trackEvent.track);
    }
    conn.onnegotiationneeded = e => {
        if (conn.signalingState != "stable") return;
      }
    conn.onicecandidate = async (e) => {
        if (e.candidate) {
            socket.emit("ice-candidates", JSON.stringify(e.candidate));
        }
    }

    socket.on("ice-candidates", (candidate: string) => {
        const iceCandidate : RTCIceCandidateInit = JSON.parse(candidate);
        console.log(`Received Peer Ice Candidate ${iceCandidate}`);
        conn.addIceCandidate(iceCandidate);
    })

    return conn;
}

const sendOffer = async (rtcPeerConnection: RTCPeerConnection, socket: Socket, roomId: string) => {
    let sessionDescription;
    try {
        sessionDescription = await rtcPeerConnection.createOffer();
        rtcPeerConnection.setLocalDescription(sessionDescription);
        console.log(sessionDescription.sdp);
        socket.emit('webrtc-offer', JSON.stringify(sessionDescription), roomId);

    } catch (error) {
      console.error(error);
      return;
    }

  };


const sendAnwser = async (rtcPeerConnection: RTCPeerConnection, socket: Socket, roomId: string ) => {
    let sessionDescription: RTCSessionDescriptionInit;
    try {
        sessionDescription = await rtcPeerConnection.createAnswer();
        rtcPeerConnection.setLocalDescription(sessionDescription);
        socket.emit("webrtc-answer", JSON.stringify(sessionDescription), roomId);

    } catch (error) {
        console.error(error);
        return;
    }
};

const onSocketConnection = (state: "connected" | "error") => {
    let toastElement = $("#connectionToast");
    if (state == "connected") {
        $("#connectionToastHeader").addClass("bg-success");
        $("#connectionToast").addClass("bg-success");
        $("#connectionToastBody").text("You are connected to the webserver!");

    } else {
        $("#connectionToastHeader").addClass("bg-danger");
        $("#connectionToast").addClass("bg-danger");
        $("#connectionToastBody").text("You are not connected to the webserver!");

    }  
    const toast = new Toast(toastElement[0],{animation: true, delay: 10000});
    toast.hide();
    toast.show();
};

const setupGeneralModal = () => {
    const modal = $("#generalModal");
    entryModal = new Modal(modal![0], { "backdrop": "static", "keyboard": false });
    entryModal.show();
};


const setupJoinModal = () => {
    const modal = $("#joinRoomModal");
    entryModal = new Modal(modal![0], { "backdrop": "static", "keyboard": false });
    entryModal.show();
};

const  setupWebsocketConnection = () => {
    const socket = io();
    socket.on("connect", () => { onSocketConnection("connected"); });
    socket.on("disconnect", () => { onSocketConnection("error"); });
    return socket;
};

document.addEventListener("DOMContentLoaded", async () => {
    const roomId = new URLSearchParams(window.location.search).get("roomId");
    if (roomId) {
        console.log("We have joined Room via URL");
        roomIdToJoin = roomId;
        setupJoinModal();
    } else {
        setupGeneralModal();
    }

    const socket = setupWebsocketConnection();
    setupUi(socket);

    try {
        await setLocalStream(true, {width: 100, height: 100});
        await setRemoteStream(remoteStream);
    } catch (err) {
        console.error(err);
    }

    console.log("Finished Loading");
});


