import { io, Socket } from "socket.io-client";
import { Toast , Modal} from "bootstrap";
import { WavRecorder } from "./Recorder";
import { MuteState, SharingState, RemoteConnectionInfo } from "./types";
import * as c from "./constants";

import copy from 'copy-text-to-clipboard';


let localMicState: MuteState = "muted";
let localSpeakerState: MuteState = "unmuted";
let localCamSate: SharingState = "not-sharing";
let localSSState: SharingState = "not-sharing";

let currentMic: string;
let currentSpeaker: string;
let currentCam: string;

let deviceSelections: HTMLUListElement[] = [];

let entryModal: Modal;
let roomIdToJoin: string;

let localStream: MediaStream;
let remoteConnections: Map<string, RemoteConnectionInfo> = new Map();

// Free public STUN servers provided by Google.
const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
  }

const populateDeviceList= async () => {

    let [ micSelection, speakerSelection, camSelection] = deviceSelections; 
    deviceSelections.forEach(obj => {
        while (obj.firstChild) {
            obj.removeChild(obj.firstChild);
        }
    });

    console.log("Grabbing Media Devices");
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        devices.forEach(
            device => {
                console.log(device.label, device.kind, device.groupId)
                let a = document.createElement("a");
                a.className = "dropdown-item";
                a.id = device.deviceId;
                a.href = "#";
                a.innerText = device.label;
                if (device.kind == "audioinput") {
                    micSelection.appendChild(a);
                } else if (device.kind == "audiooutput") {
                    speakerSelection.appendChild(a);
                } else {
                    camSelection.appendChild(a);
                }
        });  
    } catch (err) {
        console.error(err);
    }
};

const setupUi = (socket: Socket) => {

    $("#toggleSidebar").on("click", (e) => {
        console.log("Toggle Sidebar");
        $("#sidebar").toggleClass("active");
    });
    let bMic = $("#micButton");
    bMic?.on('click', (e) => {
        const element = e.target;
        localMicState = localMicState == "muted" ? "unmuted" : "muted";
        //((document.querySelector('#localVideo') as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0].enabled = localMicState == "unmuted";
        localStream.getAudioTracks()[0].enabled = localMicState == "unmuted";
        console.log(localStream);
        socket.emit("change-mute-state", localMicState);

        element.style.backgroundImage = localMicState == "muted" ? c.MIC_MUTE_URL : c.MIC_UNMUTE_URL;
        element.style.backgroundColor = localMicState == "muted" ? c.DISABLED_COLOR : c.ENABLED_COLOR;
    });
    bMic.css("backgroundColor", c.MIC_MUTE_URL);
    bMic.css("backgroundColor", c.DISABLED_COLOR);

    let bSpeaker = $("#speakerButton");
    bSpeaker?.on('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        
        localSpeakerState = localSpeakerState == "muted" ? "unmuted" : "muted";
        element.style.backgroundImage = localSpeakerState == "muted" ? c.SPEAKER_MUTE_URL : c.SPEAKER_UNMUTE_URL;
        element.style.backgroundColor = localSpeakerState == "muted" ? c.DISABLED_COLOR : c.ENABLED_COLOR;

        remoteConnections.forEach(conn => {
            conn.stream.getAudioTracks().forEach(track => {
                track.enabled = localSpeakerState == "unmuted";
            })
        })
    });
    bSpeaker.css("backgroundImage", c.SPEAKER_UNMUTE_URL);
    bSpeaker.css("backgroundColor", c.ENABLED_COLOR);


    let bScreenSharing = $("#screenshareButton");
    bScreenSharing?.on('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localSSState = localSSState == "not-sharing" ? "sharing" : "not-sharing";
        element.style.backgroundColor = localSSState == "sharing" ? c.ENABLED_COLOR : "";
    });


    let bCam = $("#camButton");
    bCam?.on('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localCamSate = localCamSate == "sharing" ? "not-sharing" : "sharing";
        element.style.backgroundColor = localCamSate == "sharing" ? c.ENABLED_COLOR : "";
        localStream.getVideoTracks().forEach(track => {
            track.enabled = localCamSate == "sharing";
        });
    });
    deviceSelections.push(
        $("#activeEntryModal").find("#micSelection").get()[0] as HTMLUListElement,
        $("#activeEntryModal").find("#speakerSelection").get()[0] as HTMLUListElement, 
        $("#activeEntryModal").find("#camSelection").get()[0] as HTMLUListElement
    );
    
    populateDeviceList();

    $("#selectMic").on("click", () => {
        $(".dropdown-toggle").dropdown();
    });

    let bJoinRoom = $(".joinRoom");
    bJoinRoom.on("click", (_) => {
        if (socket.connected) {
            socket.on("you-joined-room", async (roomId: string) => {
                console.log(`You joined room ${roomId}`);
                try {
                    await setLocalStream(true, {width: 1920, height: 1080});
                } catch (err) {
                    console.error(err);
                }
                entryModal.hide();
                entryModal.dispose();
                $("#meetingIdSpan").text(roomId);
            });
            const id = roomIdToJoin ? roomIdToJoin : $("#roomId").val();
            const userName = $("#activeEntryModal").find("input").val();
            console.log(id);
            console.log(userName);
            socket.emit("join-room", id, userName, localMicState);

        } else {
            alert("Not connected to webserver");
        }
    });

    let bCreateRoom = $("#createRoom");
    bCreateRoom.on("click", (_) => {
        if (socket.connected) {
            socket.on("new-room-created", async (roomId: string) => {
                console.log(roomId);
                try {
                    await setLocalStream(true, {width: 1920, height: 1080});
                } catch (err) {
                    console.error(err);
                }
                entryModal.hide();
                entryModal.dispose();
                $("#meetingIdSpan").text(roomId);
            });
            const userName = $("#activeEntryModal").find("input").val();
            if (!userName) {
                alert("You have to enter a Username!");
                return;
            }
            socket.emit("new-room", userName, localMicState);
        } else {
           
        }
    });

    let bCopyLink = $('#copyLink');
    bCopyLink.on("click", (_) => {
        const id = $("#meetingIdSpan").text();
        let inviteLink: string = "";
        inviteLink += c.isDev ? "http://localhost:5500/room/" : "https://music-via-webrtc.herokuapp.com/room/";
        inviteLink += id;
        if (!copy(inviteLink)) alert("Failed to copy Link");
    });

    socket.on("err-join-room", (msg: string) => {
        alert(msg);
    })

    socket.on("webrtc-offer", async (userId: string, userName: string, sdp: string) => {
        console.log("Received Offer from Room Owner!");
        let remoteSdp : RTCSessionDescriptionInit = JSON.parse(sdp);
        try {
            await setLocalStream(true, {width: 1920, height: 1080});
            let conn = setupPeerConnection(socket, {userId: userId, userName: userName});
            await conn.setRemoteDescription(remoteSdp);
            await sendAnwser(conn, socket);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on("webrtc-answer", async (userId: string, sdp: string) => {
        let remoteSdp: RTCSessionDescriptionInit = JSON.parse(sdp);
        console.log("Received Answer from Participant: " + sdp);
        await remoteConnections.get(userId)!.connection.setRemoteDescription(remoteSdp);
    });

    socket.on("new-participant", async (userId: string, userName:string, state: MuteState) => {
            console.log(`User ${userName} (${userId}) joined the room`);
            let conn = setupPeerConnection(socket, {userId: userId, userName: userName});
            await sendOffer(conn, socket);
            
    });
    socket.on("participant-left", (id: string) => {
        console.log("Participant left: " + id);
        remoteConnections.get(id)!.connection.close();
        remoteConnections.delete(id);
        $("#remoteVideo-" + id).remove();
    });
    socket.on("user-changed-mute-state", (userId: string, newState: MuteState) => {
        console.log("Mute State Change");
        remoteConnections.get(userId)!.muteState = newState;
        setMuteInUi(userId);
    });

};

const setMuteInUi = (id: string) => {
    (remoteConnections.get(id)!.muteState == "muted") 
        ? $("#remoteMuteIcon-" + id).fadeIn() 
        : $("#remoteMuteIcon-" + id).fadeOut();  
};

const setLocalStream = async (audio: boolean, {width, height}: {width: number, height: number}) => {
    try {
        const audioEnabled = localMicState == "unmuted";
        const videoEnabled = localCamSate == "sharing";
        localStream = await navigator.mediaDevices.getUserMedia({audio: {autoGainControl: false, noiseSuppression: false}, video: {width: width, height: height}});
        console.log(localStream.getTracks());
        localStream.getAudioTracks()[0].enabled = audioEnabled;
        localStream.getVideoTracks()[0].enabled = videoEnabled;
        (document.querySelector('#localVideo') as HTMLVideoElement).srcObject = localStream;
        console.log(localStream);
    } catch(err ) {
        console.log(err);
    };
};

const addTrackToStream = (stream: MediaStream, track: MediaStreamTrack) => {
    stream.addTrack(track);
    console.log(stream.getTracks());
}

const setupPeerConnection = (socket: Socket, {userId, userName} : {userId: string, userName: string}) : RTCPeerConnection => {
    let conn = new RTCPeerConnection(iceServers);
    const remoteStream = new MediaStream();
    remoteConnections.set(userId, {
        connection: conn,
        muteState: "muted",
        stream: remoteStream,
        userName: userName,
        recorder: null
    });

    setInterval(() => getStats(conn,"audio","inbound-rtp"), 1000);

    const newVidHtml = 
    `<div id="remoteVideo-${userId}" class="col-6 d-flex justify-content-center videos" style="position:relative; box-shadow: 0 0 20px  rgb(0, 0, 0) ">`+
                    `<video autoplay playsinline style="margin: auto; height: 100%; width: 100%;"></video>` + 
                    `<img id="remoteMuteIcon-${userId}" src="../Public/microphone-mute.svg" style=" width: 5%; height: 5%; "></img>`+
                    `<span style="font-size: 1.25em; background-color: #0d6efd; color: white; position: absolute; bottom: 0; left: 0; padding: 0.2em">${userName}</span>` +
                `</div>`;
    $("#videoContainer").append(newVidHtml);
    ($(`#remoteVideo-${userId}`).find("video")[0] as HTMLMediaElement).srcObject = remoteStream;

    const newRecordingEntry = `<option value=${userId}>${userName}</option>`;
    $("#recordingSelection").append(newRecordingEntry);
    
    localStream.getTracks().forEach(track => {
        conn.addTrack(track);
    });

    conn.ontrack = (trackEvent) => {
        console.log("Received new Tracks from Remote Peer");
        console.log(trackEvent.track);
        const remoteStream = remoteConnections.get(userId)!.stream;
        console.log(remoteStream);
        addTrackToStream(remoteStream, trackEvent.track);
    }
    conn.onnegotiationneeded = e => {
        console.log("Negotiation is needed!");
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

const sendOffer = async (rtcPeerConnection: RTCPeerConnection, socket: Socket) => {
    let sessionDescription;
    try {
        sessionDescription = await rtcPeerConnection.createOffer();
        rtcPeerConnection.setLocalDescription(sessionDescription);
        console.log(sessionDescription.sdp);
        const myUserName = $(".user-name-input").val();
        socket.emit('webrtc-offer', JSON.stringify(sessionDescription), myUserName);

    } catch (error) {
      console.error(error);
      return;
    }

  };

const sendAnwser = async (rtcPeerConnection: RTCPeerConnection, socket: Socket) => {
    let sessionDescription: RTCSessionDescriptionInit;
    try {
        sessionDescription = await rtcPeerConnection.createAnswer();
        rtcPeerConnection.setLocalDescription(sessionDescription);
        socket.emit("webrtc-answer", JSON.stringify(sessionDescription));

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
    modal.attr("id", "activeEntryModal");
    entryModal = new Modal(modal![0], { "backdrop": "static", "keyboard": false });
    entryModal.show();
};


const setupJoinModal = () => {
    const modal = $("#joinRoomModal");
    modal.attr("id", "activeEntryModal");
    entryModal = new Modal(modal![0], { "backdrop": "static", "keyboard": false });
    entryModal.show();
};

const  setupWebsocketConnection = () => {
    const socket = io();
    socket.on("connect", () => { onSocketConnection("connected"); });
    socket.on("disconnect", () => { onSocketConnection("error"); });
    return socket;
};


const setupExperimentalFeatures = (socket: Socket) => {
    $("#playAudioTrack").on("click", (_) => {

    });
    $("#stopAudioTrack").on("click", (_) => {

    });
    $("#openAudioTrack").on("click", (_) => {
        $("#file-input").trigger("click");
    });

    $("#recordingSelection").append()


    $("#startRecording").on("click", (_) => {
        const selectedPeer = $("#recordingSelection").val() as string;
        console.log(selectedPeer);
        if (selectedPeer && remoteConnections.get(selectedPeer)?.recorder == null) {
            let peerStream = remoteConnections.get(selectedPeer)?.stream;
            let peerRecorder = new WavRecorder(peerStream!);
            remoteConnections.get(selectedPeer)!.recorder = peerRecorder;
        }
        const recorder =  remoteConnections.get(selectedPeer)?.recorder;
        if (recorder) {
            recorder.start();
            console.log(`Started local recording of User ${selectedPeer}`);
        }
    });

    $("#stopRecording").on("click", (_) => {
        const selectedPeer = $("#recordingSelection").val() as string;
        console.log(selectedPeer);
        let peerRecorder = remoteConnections.get(selectedPeer)?.recorder;
        if (peerRecorder) {
            peerRecorder.stop();
            console.log(`Stopped local recording of User ${selectedPeer}`);
        }
    });

};

const getStats = async (conn: RTCPeerConnection, kind: "audio" | "video" ,type: RTCStatsType) => {
    let statsOutput = "";
    try {
        const stats = await conn.getStats(null);
  
        stats?.forEach(report => {
            if (report.type === type && report.kind === kind) {
                Object.keys(report).forEach(statName => {
                statsOutput += `<strong>${statName}:</strong> ${report[statName]}<br>\n`;
                });
          }
        });
    } catch(err) {
        console.log(err);
    } 
    $("#codecStatsText").html(statsOutput);
  };

document.addEventListener("DOMContentLoaded", async () => {
    
    console.log("Production: " + !c.isDev);

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
    setupExperimentalFeatures(socket);

    console.log("Finished Loading");
});


