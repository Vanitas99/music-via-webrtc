import { io, Socket } from "socket.io-client";
import { Toast } from "bootstrap";

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

let localStream: MediaStream;
let remoteStreams: MediaStream[] = [];

const MIC_MUTE_URL = "url(\"../Public/microphone-mute.svg\")";
const MIC_UNMUTE_URL = "url(\"../Public//microphone-unmute.svg\")";
const SPEAKER_MUTE_URL = "url(\"../Public/speaker-mute.svg\")";
const SPEAKER_UNMUTE_URL = "url(\"../Public/speaker-unmute.svg\")";

const ENABLED_COLOR = "rgb(152, 226, 41)";
const DISABLED_COLOR = "rgb(182, 0, 0)";

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

    let bMic = document.querySelector("#micButton") as HTMLButtonElement;
    bMic?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localMicState = localMicState == "muted" ? "unmuted" : "muted";
        ((document.querySelector('#localVideo') as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0].enabled = localMicState == "unmuted";

        element.style.backgroundImage = localMicState == "muted" ? MIC_MUTE_URL : MIC_UNMUTE_URL;
        element.style.backgroundColor = localMicState == "muted" ? DISABLED_COLOR : ENABLED_COLOR;
    });
    bMic.style.backgroundImage = MIC_MUTE_URL;
    bMic.style.backgroundColor = DISABLED_COLOR;

    let bSpeaker = document.querySelector("#speakerButton") as HTMLButtonElement;
    bSpeaker?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        
        localSpeakerState = localSpeakerState == "muted" ? "unmuted" : "muted";
        element.style.backgroundImage = localSpeakerState == "muted" ? SPEAKER_MUTE_URL : SPEAKER_UNMUTE_URL;
        element.style.backgroundColor = localSpeakerState == "muted" ? DISABLED_COLOR : ENABLED_COLOR;
    });
    bSpeaker.style.backgroundImage = SPEAKER_UNMUTE_URL;
    bSpeaker.style.backgroundColor = ENABLED_COLOR;


    let bScreenSharing = document.querySelector("#screenshareButton") as HTMLButtonElement;
    bScreenSharing?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localSSState = localSSState == "not-sharing" ? "sharing" : "not-sharing";
        element.style.backgroundColor = localSSState == "sharing" ? ENABLED_COLOR : "";
    });


    let bCam = document.querySelector("#camButton") as HTMLButtonElement;
    bCam?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localCamSate = localCamSate == "sharing" ? "not-sharing" : "sharing";
        element.style.backgroundColor = localCamSate == "sharing" ? ENABLED_COLOR : "";
        if (localCamSate == "sharing") {
            setLocalStream(true, {width: 1920, height: 1080
            });
        } else {
            (document.querySelector('#localVideo') as HTMLVideoElement).srcObject = null;
        }
    });
    deviceSelections.push(
        document.querySelector("#micSelection")!,
        document.querySelector("#speakerSelection")!, 
        document.querySelector("#camSelection")!
    );
    populateDeviceList();

    let bJoinRoom = document.querySelector("#joinRoom") as HTMLButtonElement;
    bJoinRoom.addEventListener("click", (e) => {
        if (socket.connected) {
            socket.on("you-joined-room", (roomId: string) => {
                console.log(`You joined room ${roomId}`);
            });
            const id = (document.querySelector("#roomId") as HTMLTextAreaElement).value;
            console.log(id);
            socket.emit("join-room", {id: id, state: localMicState});

        } else {
            alert("Not connected to webserver");
        }
    });

    let bCreateRoom = document.querySelector("#createRoom") as HTMLButtonElement;
    bCreateRoom.addEventListener("click", () => {
        if (socket.connected) {
            socket.on("new-room-created", (roomId: string) => {
                console.log(roomId);
                let toastElement = document.querySelector("#roomIdToast");
                let toastBody = document.querySelector("#roomIdToastBody");
                toastBody!.textContent = roomId;
                const toast = new Toast(toastElement!,{animation: true, delay: 10000});
                toast.show();
            });
            socket.emit("new-room");
        } else {
            alert("Not connected to webserver");
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

const addTrackToStream = (stream: MediaStream, track: MediaStreamTrack) => {

    stream.addTrack(track);
}

document.addEventListener("DOMContentLoaded", async () => {
    const socket = io('ws://localhost:9000/');
    setupUi(socket);
    try {
        await setLocalStream(true, {width: 100, height: 100});
        await setRemoteStream(remoteStream);
    } catch (err) {
        console.error(err);
    }
    console.log("Finished Loading");
});

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

