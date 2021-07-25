import { io, Socket } from "socket.io-client";
import { Toast , Modal} from "bootstrap";
import { WavRecorder } from "./Recorder";
import { MuteState, SharingState, RemoteConnectionInfo , OpusCodecParameters} from "./types";
import * as c from "./constants";

import * as sdpUtils from "sdp-transform";

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

let filePlayback : {
    buffer: AudioBuffer | null,
    dest: MediaStreamAudioDestinationNode | null,
    currentSource: AudioBufferSourceNode | null,
    ctx: AudioContext;
} = {buffer: null, dest: null, currentSource: null, ctx: new window.AudioContext()};


// Diese Variable wird genutzt, um bei einer neuen Verhandlung der Verbindung (engl. Negotiation),
// z.b durch Änderung von Paramtern oder Hinzufügen neuer MediaStreamTracks (audio, video),
// eventuelle Data Races zu verhindern. Falls beide Peers gleichzeitig versuchen die Verbindung neu 
// auszuhandlen (onnegotiationneeded), d.h. beide einen webrtc-offer senden, dann wird der "nette" Peer
// seinen Verhandlungsversuch abbrechen und erst versuchen neu zu verhandeln, wenn die Verbindung in einem
// stabilen Zustand ist. (RTCPeerConnection.signalingState == "stable")!
let amIPolite: boolean;

// Kostenlose Stun Server von Google. Nicht mehr als 2 nutzen.
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
        localStream.getAudioTracks()[0].enabled = localMicState == "unmuted";
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
            conn.mainStream.getAudioTracks().forEach(track => {
                track.enabled = localSpeakerState == "unmuted";
            })
            conn.additionalStreams.forEach(stream => {
                stream.stream.getTracks().forEach(track => {
                    track.enabled = localSpeakerState == "unmuted";
                })
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

    socket.on("initial-webrtc-offer", async (userId: string, userName: string, sdp: string) => {
        console.log("Received Inital Offer");
        let remoteSdp : RTCSessionDescriptionInit = JSON.parse(sdp);
        console.log(remoteSdp.sdp);
        amIPolite = true;
        try {
            await setLocalStream(true, {width: 1920, height: 1080});
            let conn = setupPeerConnection(socket, {userId: userId, userName: userName});
            await conn.setRemoteDescription(remoteSdp);
            await sendAnwser(conn, socket);
            remoteConnections.get(userId)!.callStarted = true;
        } catch (err) {
            console.error(err);
        }
    });

    socket.on("webrtc-offer", async (userId: string, sdp: string) => {
        console.log("Received Negotiation Offer");
        const remoteSdp : RTCSessionDescriptionInit = JSON.parse(sdp);
        const conn = remoteConnections.get(userId)?.connection;
        if (!conn) return;

        if (conn.signalingState != "stable") {
            if (!amIPolite) return;
            try {
                await Promise.all([
                    conn.setLocalDescription({type: "rollback"}),
                    conn.setRemoteDescription(remoteSdp)
                ]);
            } catch (err) {
                console.error(err);
            } 
        } else {
            try {
                await conn.setRemoteDescription(remoteSdp);
            } catch (err) {
                console.error(err);
            }
        }

        try {
            await sendAnwser(conn!, socket);
        } catch (err) {
            console.error(err);
        }
        
    });

    socket.on("webrtc-answer", async (userId: string, sdp: string) => {
        let remoteSdp: RTCSessionDescriptionInit = JSON.parse(sdp);
        console.log("Received Answer from Participant: " + remoteSdp.sdp);
        await remoteConnections.get(userId)!.connection.setRemoteDescription(remoteSdp);
    });

    socket.on("new-participant", async (userId: string, userName:string, state: MuteState) => {
            console.log(`User ${userName} (${userId}) joined the room`);
            let conn = setupPeerConnection(socket, {userId: userId, userName: userName});
            await sendOffer(userId, {
                cbr: 1,
                usedtx: 0,
                stereo: 0,
                useinbandfec: 0,
                maxaveragebitrate: 32000
            }, true);
            remoteConnections.get(userId)!.callStarted = true;
            
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
        localStream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation:true, noiseSuppression: true, autoGainControl: true}, video: {width: width, height: height}});
        localStream.getAudioTracks()[0].enabled = audioEnabled;
        localStream.getVideoTracks()[0].enabled = videoEnabled;
        localStream.onaddtrack = (e) => {
            console.log(e.track);
        };
        (document.querySelector('#localVideo') as HTMLVideoElement).srcObject = localStream;
    } catch(err ) {
        console.log(err);
    };
};

const updateLocalAudioTrack = async (userId: string, constraints: MediaTrackConstraints) => {
    try {
        const track = localStream.getAudioTracks()[0];
        track.stop();
        const newConstraints = Object.assign(track.getSettings(), constraints);
        const newStream = await navigator.mediaDevices.getUserMedia({audio: newConstraints});
        
        remoteConnections.forEach(conn => {
            conn.connection.getSenders()
            .find(sender => sender.track!.getCapabilities().deviceId == track.getCapabilities().deviceId)?.replaceTrack(newStream.getAudioTracks()[0]);
        });
        localStream.removeTrack(track);
        localStream.addTrack(newStream.getAudioTracks()[0]);
    } catch (err) {
        console.error(err);
    }
};

const updateLocalVideoTrack = async (userId: string, constraints: MediaTrackConstraints) => {
    try {   

    } catch (err) {
        console.error(err);
    }
};

const addTrackToStream = (stream: MediaStream, track: MediaStreamTrack) => {
    stream.addTrack(track);
};

const addAdditionalStream = (userId: string, track: MediaStreamTrack) => {
    let stream = new MediaStream();
    stream.addTrack(track);
    remoteConnections.get(userId)!.additionalStreams.push({stream: stream});

    let audioElement = new Audio();
    audioElement.id = "additional" + userId;
    audioElement.srcObject = stream;
    audioElement.play();

    $("#audioContainer").append(audioElement);
};

const setupPeerConnection = (socket: Socket, {userId, userName} : {userId: string, userName: string}) : RTCPeerConnection => {
    let conn = new RTCPeerConnection(iceServers);
    remoteConnections.set(userId, {
        connection: conn,
        callStarted: false,
        muteState: "muted",
        mainStream: new MediaStream(),
        userName: userName,
        recorder: null,
        additionalStreams: new Array<{stream: MediaStream}>(),
        socket: socket
    });

    setInterval(() => getStats(conn,"audio","inbound-rtp"), 300);
    
    const newVidHtml = 
    `<div id="remoteVideo-${userId}" class="col-6 d-flex justify-content-center videos" style="position:relative; box-shadow: 0 0 20px  rgb(0, 0, 0) ">`+
    `<video autoplay playsinline style="margin: auto; height: 100%; width: 100%;"></video>` + 
    `<img id="remoteMuteIcon-${userId}" src="../Public/microphone-mute.svg" style=" width: 5%; height: 5%; "></img>`+
    `<span style="font-size: 1.25em; background-color: #0d6efd; color: white; position: absolute; bottom: 0; left: 0; padding: 0.2em">${userName}</span>` +
    `</div>`;
    $("#videoContainer").append(newVidHtml);
    ($(`#remoteVideo-${userId}`).find("video")[0] as HTMLMediaElement).srcObject = remoteConnections.get(userId)!.mainStream;
    
    const newRecordingEntry = `<option value=${userId}>${userName}</option>`;
    $("#peerSelection").append(newRecordingEntry);
    
    localStream.getTracks().forEach(track => {
        const sender = conn.addTrack(track);
    });

    conn.ontrack = (trackEvent) => {
        console.log("Received new Tracks from Remote Peer");
        
        // Wenn wir bereits einen Audio Track empfangen, dann muss der neue
        // als zusätzlicher Track registriert und in einem neuen MediaStream Objekt 
        // abgespielt werden. In MediaStreams ist immer nur ein AudioTrack hörbar!
        const stream = remoteConnections.get(userId)!.mainStream;
        console.log("Current length of Audio Tracks is " + stream.getAudioTracks().length)
        if (trackEvent.track.kind == "audio") {
            if (!stream.getAudioTracks().length) {
                addTrackToStream(stream, trackEvent.track);
            } else {
                let newStream = new MediaStream();
                newStream.addTrack(trackEvent.track);
                addAdditionalStream(userId, trackEvent.track);
            }
        } else {
            addTrackToStream(stream, trackEvent.track);
        }
        $(".experimental").removeAttr("disabled");
    }
    
    conn.onnegotiationneeded = async (e) => {
        console.log("Negotiation is needed! " + conn.signalingState.toString());
        let callHasStarted = false;
        for (let [_, value] of remoteConnections.entries()) {
            if (Object.is(value.connection, conn)) {
                callHasStarted = value.callStarted;
                return;
            }
        }
        if (conn.signalingState != "stable" || !callHasStarted) return;
        try {
            await sendOffer(userId, {});
        } catch (err) {
            console.error(err);
        }
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

const sendOffer = async (userId: string, codecParams: OpusCodecParameters,initialOffer: boolean = false) => {
    
    const connInfo =  remoteConnections.get(userId)!;
    let sessionDescription: RTCSessionDescriptionInit;
    try {
        sessionDescription = await connInfo.connection.createOffer();
        await setOpusCodecParameters(sessionDescription, codecParams);
        if (!initialOffer && connInfo.connection.signalingState != "stable") return; 
        await connInfo.connection.setLocalDescription(sessionDescription);
        console.log(sessionDescription.sdp);
    } catch (error) {
      console.error(error);
      return;
    } 

    console.log(connInfo.connection.getTransceivers()[0].sender.getParameters());

    if (initialOffer) {
        const myUserName = $(".user-name-input").val();
        connInfo.socket.emit('initial-webrtc-offer', JSON.stringify(sessionDescription), myUserName);
    } else {
        connInfo.socket.emit('webrtc-offer', JSON.stringify(sessionDescription));
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
    $(".user-name-input").get()[0].focus();
};

const setupWebsocketConnection = () => {
    const socket = io();
    socket.on("connect", () => { onSocketConnection("connected"); });
    socket.on("disconnect", () => { onSocketConnection("error"); });
    return socket;
};

const setOpusCodecParameters = (sdp: RTCSessionDescriptionInit, parameters: OpusCodecParameters) : Promise<void> => (
    new Promise((resolve, reject) => {
        let sdpObj = sdpUtils.parse(sdp.sdp!);
        let opusSegment = sdpObj.media.find(mediaSegment => {
            console.log(mediaSegment);
            return mediaSegment.type == "audio";
        });
        if (!opusSegment) reject("No Opus Media Segment found!");

        opusSegment!.fmtp.forEach(t => console.log(t));
        let fec = false;
        if (fec) {
            opusSegment.payloads = "131 " + opusSegment.payloads;
            opusSegment.rtp.unshift({payload: 131, codec: "red", rate: 8000, encoding: 2});
            opusSegment.fmtp.push({payload: 131, config: "111/103/104/9/0/8/106/105/13/110/112/113/126"});
        }

        let newFmtp = opusSegment!.fmtp[0];
        console.log("Old Opus Config - " + newFmtp.config);
        let params = sdpUtils.parseParams(newFmtp.config);
        for (const [param, val] of Object.entries(parameters)) {
            params[param] = val;
        }
        var config: string = "";
        for (const [parameter, value] of Object.entries(params)) {
            config += `${parameter}=${value};`;
        }
        let mungedSdp: string;
        newFmtp.config = config;
        console.log("New Opus Config - " + newFmtp.config);
        opusSegment!.fmtp[0] = newFmtp;
        mungedSdp = sdpUtils.write(sdpObj);
        sdp.sdp = mungedSdp;
        console.log(mungedSdp);
        resolve();
    })
);

const applyNewSessionParameters = async (codecParams: OpusCodecParameters) => {
    const selectedPeer = $("#peerSelection").val() as string;
    if (!selectedPeer) return;
    try {
        await sendOffer(selectedPeer, codecParams); 
    } catch(err) {
        console.log(err);
    }
};

const applyAudioProcessing = (config: MediaTrackConstraints) => {
    const selectedPeer = $("#peerSelection").val() as string;
    if (!selectedPeer) return;
    updateLocalAudioTrack(selectedPeer, config);
};

/* 
    EXPERIMENTAL FEATURES FOR INVESTIGATING AUDIO QUALITY
*/
const setupExperimentalFeatures = () => {

    $(".experimental").attr("disabled", "true");

    $("#openFile").on("click", (_) => {
        $("#file-input").trigger("click");
    });

    $("#playAdditionalTrack").on("click", () => {
        if (!filePlayback.ctx || !filePlayback.buffer || !filePlayback.dest) return;

        let source = filePlayback.ctx.createBufferSource();
        source.buffer = filePlayback.buffer;
        if (($("#checkLocalPlayback").get()[0] as HTMLInputElement).checked) {
            source.connect(filePlayback.ctx.destination);
        }
        source.connect(filePlayback.dest);
        filePlayback.currentSource = source;
        source.start();
    });
    
    $("#stopAdditionalTrack").on("click", () => {
        filePlayback.currentSource?.stop();
    });
    
    $("#file-input").on("change", (_) => {
        const files = ($("#file-input")[0] as HTMLInputElement).files;
        const selectedPeer = $("#peerSelection").val() as string;
        const conn = remoteConnections.get(selectedPeer)?.connection;

        if (files!.length) {
            let reader = new FileReader();
            reader.onload = (e) => {
                filePlayback.ctx.decodeAudioData(e.target!.result as ArrayBuffer, (buffer) => {
                    filePlayback.buffer = buffer;
                });
                filePlayback.dest = filePlayback.ctx.createMediaStreamDestination();
                conn!.addTrack(filePlayback.dest.stream.getAudioTracks()[0]);
            };
            reader.readAsArrayBuffer(files![0]);
        }
    });

    $("#downloadRecording").on("click", (e) => {
        const selectedPeer = $("#peerSelection").val() as string;
        const recorder = remoteConnections.get(selectedPeer)?.recorder;
        if (!selectedPeer || !recorder || !recorder.fileAvailable()) {
            e.preventDefault();
            alert("Cannot download file");
        }
    });

    $("#checkInbandFEC").on("click", (_) => {
        const use = $("#checkInbandFEC").is(':checked') ? 1 : 0;
        applyNewSessionParameters({useinbandfec: use});
    });

    $("#checkOutOfBandFEC").on("click", (e) => {
    });

    $("#checkDtx").on("click", (_) => {
        const use = $("#checkDtx").is(':checked') ? 1 : 0;
        applyNewSessionParameters({usedtx: use});
    });

    $("#checkMaxBitrate").on("click", (_) => {
        const use = $("#checkMaxBitrate").is(':checked') ? 1 : 0;
        applyNewSessionParameters({maxaveragebitrate: use ? 510000 : 32000});
    });

    $("#checkStereo").on("click", (_) => {
        const use = $("#checkStereo").is(':checked') ? 1 : 0;
        applyNewSessionParameters({stereo: use});
    });

    $("#checkAGC").attr("checked", "true");
    $("#checkAGC").on("click", (_) => {
        applyAudioProcessing({autoGainControl: $("#checkAGC").is(':checked')});
    });
    
    $("#checkNS").attr("checked", "true");
    $("#checkNS").on("click", (_) => {
        applyAudioProcessing({noiseSuppression: $("#checkNS").is(':checked')});
    });
    
    $("#checkEC").attr("checked", "true");
    $("#checkEC").on("click", (_) => {
        applyAudioProcessing({echoCancellation: $("#checkEC").is(':checked')});
    });

    $("#startRecording").on("click", (_) => {
        const selectedPeer = $("#peerSelection").val() as string;
        console.log(selectedPeer);
        if (selectedPeer && remoteConnections.get(selectedPeer)?.recorder == null) {
            let peerStream = remoteConnections.get(selectedPeer)?.mainStream;
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
        const selectedPeer = $("#peerSelection").val() as string;
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
    setupExperimentalFeatures();

    console.log("Finished Loading");
});


