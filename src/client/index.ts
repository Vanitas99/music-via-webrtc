import { io, Socket } from "socket.io-client";
import { Toast , Modal, Alert} from "bootstrap";
import { WavRecorder } from "./Recorder";
import { 
    MuteState, 
    SharingState, 
    RemoteConnectionInfo ,
    OpusCodecParameters,
    PreferedCodec,
    MusicModes, 
    InboundAudioStats, 
    OutboundAudioStats,
    RemoteAudioStats,
    Statistics
} from "./types";
import {initializeSpectogram} from "./Spectogram";

//@ts-ignore
import { StatsRatesCalculator, StatsReport } from "./RateCalculator";
import copy from 'copy-text-to-clipboard';
import * as c from "./constants";
import * as sdpUtils from "sdp-transform";

let infoToast: Toast | null = null

let webserverConnection: Socket | null = null;

let localMicState: MuteState = "muted";
let localSpeakerState: MuteState = "unmuted";
let localCamSate: SharingState = "not-sharing";
let localSSState: SharingState = "not-sharing";

let statsCounter = 0;
let statsQueue = new Array<InboundAudioStats>(3);

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
let amIPolite: boolean = false;

// Kostenlose Stun Server von Google. Nicht mehr als 2 nutzen.
const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
}

const setupUi = () => {

    $("#toggleSidebar").on("click", (e) => {
        $("#sidebar").toggleClass("active");
    });

    $("#musicModeParameters").addClass("invisible");

    $("#endCallButton").on("click", () => {
        webserverConnection!.emit("leave-room");
        window.location.replace( c.isDev ? c.TEST_URL : c.PROD_URL);
    });

    let bMusicMode = $("#toggleMusicMode");
    bMusicMode.on("click", (e) => {
        const element = e.target;
        const selectedPeer = $("#peerSelection").val() as string;
        if (!selectedPeer) return;
        const newMode = remoteConnections.get(selectedPeer)!.musicMode == "off" ? "agressive" : "off";
        remoteConnections.get(selectedPeer)!.musicMode = newMode;
        remoteConnections.get(selectedPeer)!.datachannel!.send(JSON.stringify(
            {
                msg: newMode == "off" ? "music-stop" : "music-start"
            }
        ));
        element.style.backgroundColor = newMode == "off" ? c.DISABLED_COLOR : c.ENABLED_COLOR;
        if (newMode == "off") {
            $("#musicModeParameters").addClass("invisible");
            applyNewSessionParameters("opus", {
                useinbandfec: 1,
                usedtx: 1,
                stereo: 0,
                maxaveragebitrate: 32000
            });
        } else {
            $("#musicModeParameters").removeClass("invisible");
            applyNewSessionParameters("opus", {
                useinbandfec: 1,
                usedtx: 0,
                stereo: 1,
                maxaveragebitrate: 256000
            });
            applyAudioProcessing({autoGainControl: false, noiseSuppression: false, echoCancellation: false});
        }

    });
    bMusicMode.css("backgroundColor", c.DISABLED_COLOR);

    let bMic = $("#micButton");
    bMic?.on('click', (e) => {
        const element = e.target;
        localMicState = localMicState == "muted" ? "unmuted" : "muted";
        localStream.getAudioTracks()[0].enabled = localMicState == "unmuted";
        webserverConnection!.emit("change-mute-state", localStorage.getItem("myUserId"), localMicState);

        element.style.backgroundImage = localMicState == "muted" ? c.MIC_MUTE_URL : c.MIC_UNMUTE_URL;
        element.style.backgroundColor = localMicState == "muted" ? c.DISABLED_COLOR : c.ENABLED_COLOR;
    });
    bMic.css("backgroundImage", c.MIC_MUTE_URL);
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

    $("#selectMic").on("click", () => {
        $(".dropdown-toggle").dropdown();
    });

    let bJoinRoom = $(".joinRoom");
    bJoinRoom.on("click", (_) => {
        if (webserverConnection!.connected) {
            webserverConnection!.on("you-joined-room", async (roomId: string, newUserId: string) => {
                switchUiToCallMode(roomId, newUserId);
            });
            const id = roomIdToJoin ? roomIdToJoin : $("#roomId").val();
            const userName = $("#activeEntryModal").find("input").val();
            webserverConnection!.emit("join-room", id, userName, localMicState);

        } else {
            alert("Not connected to webserver");
        }
    });

    let bCreateRoom = $("#createRoom");
    bCreateRoom.on("click", (_) => {
        if (webserverConnection!.connected) {
            webserverConnection!.on("new-room-created", async (roomId: string, newUserId: string) => {
                switchUiToCallMode(roomId, newUserId);
            });
            const userName = $("#activeEntryModal").find("input").val();
            if (!userName) {
                alert("You have to enter a Username!");
                return;
            }
            webserverConnection!.emit("new-room", userName, localMicState);
        } else {
           
        }
    });

    let bCopyLink = $('#copyLink');
    bCopyLink.on("click", (_) => {
        const id = $("#meetingIdSpan").text();
        let inviteLink: string = "";
        inviteLink += c.isDev ? c.TEST_URL + "/room/" : c.PROD_URL + "/room/";
        inviteLink += id;
        if (!copy(inviteLink)) { 
            alert("Konnte Link nicht kopieren!");
        } else {
            showInfoMessage("info", 3000, "Meeting Link in Zwischenablage kopiert!")
        }
    });

    webserverConnection!.on("err-join-room", (msg: string) => {
        alert(msg);
    })

    webserverConnection!.on("initial-webrtc-offer", async (userId: string, userName: string, sdp: string) => {
        console.log("[VIA WEBSERVER] Received Inital Offer");
        let remoteSdp : RTCSessionDescriptionInit = JSON.parse(sdp);
        amIPolite = true;
        try {
            await setLocalStream(true, {width: 1920, height: 1080});
            let conn = setupPeerConnection({userId: userId, userName: userName});
            await conn.setRemoteDescription(remoteSdp);
            await sendAnwser(userId);
            remoteConnections.get(userId)!.callStarted = true;
        } catch (err) {
            console.error(err);
        }
        
    });

    webserverConnection!.on("webrtc-offer", async (userId: string, sdp: string) => {
        console.log("[VIA WEBSERVER] Received Negotiation Offer");
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
            await sendAnwser(userId,);
        } catch (err) {
            console.error(err);
        }
        
    });

    webserverConnection!.on("webrtc-answer", async (userId: string, sdp: string) => {
        let remoteSdp: RTCSessionDescriptionInit = JSON.parse(sdp);
        console.log("[VIA WEBSERVER] Received Answer from Participant: " + remoteSdp.sdp);
        await remoteConnections.get(userId)!.connection.setRemoteDescription(remoteSdp);
    });

    webserverConnection!.on("new-participant", async (userId: string, userName:string, state: MuteState) => {
            console.log(`[VIA WEBSERVER] User ${userName} (${userId}) joined the room`);
            showInfoMessage("info", 3000, `Nutzer ${userName} ist dem Raum beigetreten`);
            setupPeerConnection({userId: userId, userName: userName}, true);
            await sendOffer(userId, true);
            remoteConnections.get(userId)!.callStarted = true;
    });
    
    webserverConnection!.on("participant-left", (id: string) => {
        console.log("[VIA WEBSERVER] Participant left: " + id);
        const name = remoteConnections.get(id)!.userName;
        showInfoMessage("info", 3000, `Nutzer ${name} hat den Raum verlassen`);
        remoteConnections.get(id)!.connection.close();
        remoteConnections.delete(id);
        $("#remoteVideo-" + id).remove();
    });

    webserverConnection!.on("user-changed-mute-state", (userId: string, newState: MuteState) => {
        console.log(`[VIA WEBSERVER] Mute State of ${userId} changed.`);
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
        localStream.getAudioTracks()[0].enabled = localMicState == "unmuted";
    } catch (err) {
        console.error(err);
    }
};

const updateLocalVideoTrack = async (userId: string, constraints: MediaTrackConstraints) => {
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

const setupPeerConnection = ({userId, userName} : {userId: string, userName: string}, createDataChannel: boolean = false) : RTCPeerConnection => {
    let conn = new RTCPeerConnection(iceServers);
    remoteConnections.set(userId, {
        connection: conn,
        callStarted: false,
        muteState: "muted",
        mainStream: new MediaStream(),
        userName: userName,
        recorder: null,
        additionalStreams: new Array<{stream: MediaStream}>(),
        codecConfiguration: {
            codec: "opus", 
            params: {
                cbr: 0,
                stereo: 0,
                maxptime: 120,
                usedtx: 1,
                useinbandfec: 0,
                maxaveragebitrate: 32000,
                ptime: 20
            }   
        },
        statistics: { previousSnapshot: {}},
        musicMode: "off"
    });

    /*
    Mittels Webrtc DataChannel können arbtiräre Daten von Browser zu Browser verschlüsselt übertragen werden.
    Zukünftige SDP Offer/Answer müssen nicht zwangsweiße über den Server laufen, sondern können direkt ausgetauscht werden.
    */
    const onDataChannelMsg = async ({data} : MessageEvent) => {
        const msg = JSON.parse(data);
        switch (msg.msg) {
            case "music-start": 
                console.log("[VIA Data Channel] Remote Peer wants to start sending Music!");
                showInfoMessage("info", 3000, "");
                break;
            case "music-stop":
                console.log("[VIA Data Channel] Remote Peer wants to stop sending Music!");
                break;
            case "sdp": 
                const remoteSdp = msg.sdp;
                console.log(`[VIA Data Channel] Received ${remoteSdp.type} ${remoteSdp.sdp}`);
                if (!conn) return;
        
                if (remoteSdp.type == "offer") {
                    const conn = remoteConnections.get(userId)?.connection!;
                    
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
                        await sendAnwser(userId);
                    } catch (err) {
                        console.error(err);
                    }
                } else if (remoteSdp.type == "answer") {
                    await remoteConnections.get(userId)!.connection.setRemoteDescription(remoteSdp);
                }
                break;
        }
    };

    if (createDataChannel) {
            remoteConnections.get(userId)!.datachannel = conn.createDataChannel("Data Channel");
            remoteConnections.get(userId)!.datachannel!.onmessage = onDataChannelMsg;
    } else {
        conn.ondatachannel = (e) => {
            remoteConnections.get(userId)!.datachannel = e.channel;
            remoteConnections.get(userId)!.datachannel!.onmessage = onDataChannelMsg;
        };
    }

    /* 
        In bestimmten Intervallen sollen die Statistiken aus der getStats() Api aktuallisiert und angezeigt werden.
        Um die absoluten Werte in Raten umzuwandeln wird eine modifierte Version des stats_rates_calculator.js aus den webrtc-internals 
        genutzt. Hierbei interessieren uns primär Werte für den eingehenden und ausgehenden Audio RTP Stream
    */
    let inboundRatesCalc = new StatsRatesCalculator();
    let outboundRatesCalc = new StatsRatesCalculator();
    setInterval(() => getAudioStats(userId, inboundRatesCalc, outboundRatesCalc), 300);

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
        let transceiver = conn.getTransceivers()[0];
       
        /* Experimentelle API um den RTP Agent auf eine gewünschte Verzögerung zwischen 
         * Eintritt und Austritt von Audio Frames im JitterBuffer hinzuweisen
        */
        //@ts-ignore
        transceiver.receiver.playoutDelayHint = 0;

        // Initialen Codec setzen. Wir starten mit reinem Opus ohne externes FEC.
        conn.getTransceivers()[0].setCodecPreferences([
            {mimeType: "audio/opus", clockRate: 48000,channels: 2, sdpFmtpLine: "minptime=10;useinbandfec=1"},
            {mimeType: "audio/red", clockRate: 48000, channels: 2}, 
        ]);
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
                let run = initializeSpectogram("linear");
                run(stream);
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
    
    /*
        Wenn ein neuer AudioTrack zur Remote Verbindung hinzugefügt wird, muss dies hier extra behandelt werden.
     */
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
        alert("test");
        try {
            await sendOffer(userId);
        } catch (err) {
            console.error(err);
        }
    }
    
    conn.onicecandidate = async (e) => {
        if (e.candidate) {
            webserverConnection!.emit("ice-candidates",userId, JSON.stringify(e.candidate));
        }
    }
    
    webserverConnection!.on("ice-candidates", (candidate: string) => {
        const iceCandidate : RTCIceCandidateInit = JSON.parse(candidate);
        console.log(`Received Peer Ice Candidate ${iceCandidate}`);
        conn.addIceCandidate(iceCandidate);
    })
    
    return conn;
}

const sendOffer = async (userId: string, initialOffer: boolean = false) => {
    
    const connInfo =  remoteConnections.get(userId)!;
    let sessionDescription: RTCSessionDescriptionInit;
    try {
        sessionDescription = await connInfo.connection.createOffer();
        // Die gewünschten Opus Parameter müssen bei jedem Offer neu in das SDP eingefügt werden, 
        // bevor das SDP lokal gesetzt wird.
        await setOpusCodecParameters(sessionDescription, connInfo.codecConfiguration.params);
        if (!initialOffer && connInfo.connection.signalingState != "stable")  {
            console.log("Not in stable state!");
            return;
        } 
        await connInfo.connection.setLocalDescription(sessionDescription);
    } catch (error) {
      console.error(error);
      return;
    } 

    // Der initiale Webrtc Offer wird über unseren Signaling Server geschickt, alle folgenden können wir über Datenkanäle senden
    if (initialOffer) {
        const myUserName = $(".user-name-input").val();
        webserverConnection!.emit('initial-webrtc-offer', userId, JSON.stringify(sessionDescription), myUserName);
    } else {
        if (connInfo.datachannel?.readyState == "open") {
            connInfo.datachannel?.send(JSON.stringify({msg: "sdp", sdp: sessionDescription}));
        } else {
            webserverConnection!!.emit("webrtc-offer", userId, JSON.stringify(sessionDescription));
        }
    }
};

const sendAnwser = async (userId: string) => {
    let sessionDescription: RTCSessionDescriptionInit;
    const connInfo =  remoteConnections.get(userId)!;
    try {
        sessionDescription = await connInfo.connection.createAnswer();
        await setOpusCodecParameters(sessionDescription, connInfo.codecConfiguration.params);
        connInfo.connection.setLocalDescription(sessionDescription);
        if (connInfo.datachannel?.readyState == "open") {
            connInfo.datachannel.send(JSON.stringify({msg: "sdp", sdp: sessionDescription}));
        } else {
            webserverConnection!.emit("webrtc-answer", userId, JSON.stringify(sessionDescription));
        }
    } catch (error) {
        console.error(error);
        return;
    }
};

const showInfoMessage = (state: "success" | "error" | "info", delay: number, msg: string) => {
    let toastElement = $("#infoToast");
    if (infoToast) infoToast.dispose();
    infoToast = new Toast(toastElement[0],{animation: true, delay: delay});
    $("#infoToastHeader").removeClass("bg-success");
    $("#infoToastHeader").removeClass("bg-danger");
    $("#infoToastHeader").removeClass("bg-primary");
    $("#infoToast").removeClass("bg-success");
    $("#infoToast").removeClass("bg-danger");
    $("#infoToast").removeClass("bg-primary");

    switch (state) {
        case "success":
            $("#infoToastHeader").addClass("bg-success");
            $("#infoToast").addClass("bg-success");
            break;
        case "error": 
            $("#infoToastHeader").addClass("bg-danger");
            $("#infoToast").addClass("bg-danger");
            break;
        case "info":
            $("#infoToastHeader").addClass("bg-primary");
            $("#infoToast").addClass("bg-primary");
    }
    $("#infoToastBody").text(msg);
    infoToast.show();
};

const setupGeneralModal = () => {
    const modal = $("#generalModal");
    modal.attr("id", "activeEntryModal");
    entryModal = new Modal(modal![0], { "backdrop": "static", "keyboard": false });
    entryModal.show();
};

const setupJoinModal = (roomId: string) => {
    const modal = $("#joinRoomModal");
    modal.attr("id", "activeEntryModal");
    entryModal = new Modal(modal![0], { "backdrop": "static", "keyboard": false });
    $("#uuidModalSpan").text("ID: " + roomId);
    entryModal.show();
    $(".user-name-input").get()[0].focus();
};

const setupWebsocketConnection = () => {
    webserverConnection! = io();
    webserverConnection!.on("connect", () => { showInfoMessage("success", 3000, "Verbunden mit Webserver!"); });
    webserverConnection!.on("disconnect", () => { showInfoMessage("error", 3000, "Verbindung zum Webserver verloren!\nVerwende zur Kommunikation jetzt DataChannels!"); });
    webserverConnection!.io.on('reconnect', () => {
        webserverConnection!.emit('user-reconnected', localStorage.getItem("myUserId"));
    });
};

const setOpusCodecParameters = (sdp: RTCSessionDescriptionInit, parameters: OpusCodecParameters) : Promise<void> => (
    new Promise((resolve, reject) => {
        let sdpObj = sdpUtils.parse(sdp.sdp!);
        let opusSegment = sdpObj.media.find(mediaSegment => {
            return mediaSegment.type == "audio";
        });
        if (!opusSegment) reject("No Opus Media Segment found!");

        let fmtpIndex = -1;
        let newFmtp = opusSegment!.fmtp.find((ftmp,i) => {
            if (ftmp.payload === 111) {
                fmtpIndex = i;
                return true;
            } 
            return false;
        });
        console.log("Old Opus Config - " + newFmtp!.config);
        let params = sdpUtils.parseParams(newFmtp!.config);
        for (const [param, val] of Object.entries(parameters)) {
            params[param] = val;
        }
        var config: string = "";
        for (const [parameter, value] of Object.entries(params)) {
            config += `${parameter}=${value};`;
        }
        let mungedSdp: string;
        newFmtp!.config = config;
        console.log("New Opus Config - " + newFmtp!.config);
        opusSegment!.fmtp[fmtpIndex] = newFmtp!;
        mungedSdp = sdpUtils.write(sdpObj);
        sdp.sdp = mungedSdp;
        resolve();
    })
);
    

const applyNewSessionParameters = async (preferedCodec: PreferedCodec, codecParams: OpusCodecParameters) => {
    const selectedPeer = $("#peerSelection").val() as string;
    if (!selectedPeer) return;
    const opusCodec = {mimeType: "audio/opus", clockRate: 48000,channels: 2, sdpFmtpLine: "minptime=10;useinbandfec=1"};
    const redCodec = {mimeType: "audio/red", clockRate: 48000, channels: 2};
    try {
        remoteConnections.get(selectedPeer)!.codecConfiguration.params = codecParams;
        remoteConnections.get(selectedPeer)!.codecConfiguration.codec = preferedCodec;
        let codecs: RTCRtpCodecCapability[] = [];
        if (preferedCodec == "opus") {
            codecs.push(opusCodec);
            codecs.push(redCodec);
        } else {
            codecs.push(redCodec);
            codecs.push(opusCodec);
        } 
        remoteConnections.get(selectedPeer)!.connection.getTransceivers()[0].setCodecPreferences(codecs);
        await sendOffer(selectedPeer); 
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

    const logarithmicSliderPosToHz = (sliderPos: number, minHz: number, maxHz: number) => {
        var minp = 0;
        var maxp = 100;
      
        var minv = Math.log(minHz);
        var maxv = Math.log(maxHz);
      
        var scale = (maxv-minv) / (maxp-minp);
    
        return Math.ceil(Math.exp(minv + scale*(sliderPos-minp)));
    }

    const logarithmicHzToSliderPos = (hz: number, minHz: number, maxHz: number) => {
        var minp = 0;
        var maxp = 100;
        
        var minv = Math.log(minHz);
        var maxv = Math.log(maxHz);

        var scale = (maxv-minv) / (maxp-minp);
      
        return minp + (Math.log(hz) - minv) / scale;
    }

    $('#lowpassFilterRange').on('change', (_) => {
        const val = logarithmicSliderPosToHz($('#lowpassFilterRange').val() as number, 1, 3000);
        console.log(val);
    });
    
    $('#lowpassFilterRange').on('input', (_) => {
        const val = logarithmicSliderPosToHz($('#lowpassFilterRange').val() as number, 1, 3000);
        $('#lowpassValue').val(val.toFixed(0));
    });

    $("#lowpassValue").on("change", (e) => {
        console.log($("#lowpassValue").val());
        $('#lowpassFilterRange').val(logarithmicHzToSliderPos($("#lowpassValue").val() as number,1,3000));
        
    });

    $("#openFile").on("click", (_) => {
        $("#file-input").trigger("click");
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
    
    $("#downloadRecording").on("click", (e) => {
        const selectedPeer = $("#peerSelection").val() as string;
        const recorder = remoteConnections.get(selectedPeer)?.recorder;
        if (!selectedPeer || !recorder || !recorder.fileAvailable()) {
            e.preventDefault();
            alert("Cannot download file");
        }
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

    $("#applyParameterChanges").on("click", () => {
        const stereo = $("#checkStereo").is(':checked') ? 1 : 0;
        const maxbitrate510 = $("#checkMaxBitrate").is(':checked') ? 128000 : 64000;
        const dtx = $("#checkDtx").is(':checked') ? 1 : 0;
        const inbandFec = $("#checkInbandFEC").is(':checked') ? 1 : 0;
        const preferedCodec = $("#checkOutOfBandFEC").is(':checked') ? "red-fec" : "opus";

        const preferedPTime = Number($("input[type='radio']:checked").val());
        applyNewSessionParameters(preferedCodec, {
            stereo: stereo, 
            maxaveragebitrate: maxbitrate510, 
            usedtx: dtx, 
            useinbandfec: inbandFec,
            ptime: preferedPTime
        });
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

const adjustMediaStreams = (userId: string) => {
    const connInfo = remoteConnections.get(userId);
    if (connInfo && connInfo?.musicMode == "off") return;

    const prevInbound = remoteConnections.get(userId)!.statistics!.previousSnapshot?.currentInboundAudio;
    const currInbound = remoteConnections.get(userId)!.statistics!.currentInboundAudio;
    const prevRemoteOutbound = remoteConnections.get(userId)!.statistics!.previousSnapshot?.remoteOutboundAudio;
    const currRemoteOutbound = remoteConnections.get(userId)!.statistics!.remoteOutboundAudio;

    if (prevInbound && currInbound && prevRemoteOutbound && currRemoteOutbound) {
        const packetsLost = currInbound.PacketsLost - prevInbound.PacketsLost;
        const totalPacketsSent = (currInbound.PacketsLost + currInbound.PacketsReceived) - (prevInbound.PacketsLost + prevInbound.PacketsReceived);
        const fractionLost = packetsLost / totalPacketsSent; 
        if (fractionLost > 1 && fractionLost < 0.2) {
            console.log("Running OPUS FEC");
        } else if (fractionLost >= 0.2) {
            console.log("Running RED FEC");
        } else {
            console.log("NO FEC needed");
        }      
    }
    remoteConnections.get(userId)!.statistics!.previousSnapshot!.currentInboundAudio = currInbound;
    remoteConnections.get(userId)!.statistics!.previousSnapshot!.remoteOutboundAudio = currRemoteOutbound;

    $("#mmFec").text(connInfo!.codecConfiguration.params.useinbandfec! ? "Opus Inband" : "RED");
    $("#mmStereo").text(connInfo!.codecConfiguration.params.stereo!.toString());
    $("#mmFrame").text(connInfo!.codecConfiguration.params.ptime!.toString());
    $("#mmMaxBitrate").text(connInfo!.codecConfiguration.params.maxaveragebitrate!.toString());
    $("#mmDtx").text(connInfo!.codecConfiguration.params.usedtx!.toString());
};

const getAudioStats = async (userId: string, inboundRatesCalc: StatsRatesCalculator, outboundRatesCalc: StatsRatesCalculator) => {
    let recvStatsOutput = "";
    let sendStatsOutput = "";
    try {
        const conn = remoteConnections.get(userId)?.connection;
        if (!conn) return;

        const internalStats = await conn.getStats();
        let remoteOutboundAudio: RemoteAudioStats = {
            PacketsSent: -1
        };
        internalStats.forEach((val, key) => {
            if (val.kind != "audio") return;
            if (val.type == "inbound-rtp") {
                let statsReport = StatsReport.fromStatsApiReport(val);
                inboundRatesCalc.addStatsReport(statsReport);
            } else if (val.type == "outbound-rtp") {
                let statsReport = StatsReport.fromStatsApiReport(val);
                outboundRatesCalc.addStatsReport(statsReport);
            } else if (val.type == "remote-outbound-rtp") {
                remoteOutboundAudio.PacketsSent = val.packetsSent;
            }
        });

        const completeInboundStats = inboundRatesCalc.currentReport.toStatsApiReport()[0];
        const completeOutboundStats = outboundRatesCalc.currentReport.toStatsApiReport()[0];
        
        const currentInboundAudio: InboundAudioStats = { 
            Jitter: Number(completeInboundStats.jitter) * 1000,
            JitterBufferDelay: Number(completeInboundStats["[jitterBufferDelay/jitterBufferEmittedCount_in_ms]"]),
            FecPacketsDiscarded: Number(completeInboundStats.fecPacketsReceived),
            FecPacktesRecv: Number(completeInboundStats.fecPacketsDiscarded),
            HeaderBytesRate: Number(completeInboundStats["[headerBytesReceived_in_bits/s]"]),
            PayloadBytesRate: Number(completeInboundStats["[bytesReceived_in_bits/s]"]),
            InsertedSamplesRate: Number(completeInboundStats["[insertedSamplesForDeceleration/s]"]),
            RemovedSamplesRate: Number(completeInboundStats["[removedSamplesForAcceleration/s]"]),
            PacketsLost: Number(completeInboundStats.packetsLost),
            PacketsReceived: Number(completeInboundStats.packetsReceived)
        };
        const currentOutboundAudio: OutboundAudioStats = {
            HeaderBytesRate: Number(completeOutboundStats["[headerBytesSent_in_bits/s]"]),
            PacketsSentRate: Number(completeOutboundStats["[packetsSent/s]"]) * 1000,
            TotalBytesRate: Number(completeOutboundStats["[bytesSent_in_bits/s]"]),
        };
        statsQueue.unshift(currentInboundAudio);
        
        if ((++statsCounter % 3) == 0) {
            console.log("Adjusting MediaStreams if needed!");
            const stat1 = statsQueue.unshift();
            const stat2 = statsQueue.unshift();
            const stat3 = statsQueue.unshift();
        }
        remoteConnections.get(userId)!.statistics!.currentInboundAudio = currentInboundAudio;
        remoteConnections.get(userId)!.statistics!.currentOutboundAudio = currentOutboundAudio;
        remoteConnections.get(userId)!.statistics!.remoteOutboundAudio = remoteOutboundAudio;
        
        //@ts-ignore
        recvStatsOutput += `<strong>Jitter</strong><br> ${currentInboundAudio.Jitter} ms<br>\n`;
        recvStatsOutput += `<strong>Jitter Buffer Delay</strong><br> ${currentInboundAudio.JitterBufferDelay.toFixed(1)} ms<br>\n`;
        recvStatsOutput += `<strong>Packete verloren</strong><br> ${currentInboundAudio.PacketsLost}<br>\n`;
        recvStatsOutput += `<strong>Empfangene Headerbitrate</strong><br> ${currentInboundAudio.HeaderBytesRate.toFixed(2)} kbit/s<br>\n`;
        recvStatsOutput += `<strong>Empfangene Bitrate</strong><br> ${currentInboundAudio.PayloadBytesRate.toFixed(2)} kbit/s<br>\n`;
        recvStatsOutput += `<strong>FEC Packete erhalten</strong><br> ${currentInboundAudio.FecPacktesRecv}<br>\n`;
        recvStatsOutput += `<strong>FEC Packete verworfen</strong><br> ${currentInboundAudio.FecPacketsDiscarded}<br>\n`;
        recvStatsOutput += `<strong>Eingefügte Samples zur Beschleunigung /s</strong><br> ${currentInboundAudio.InsertedSamplesRate.toFixed(1)} /s<br>\n`;
        recvStatsOutput += `<strong>Entfernte Samples zur Entschleunigung /s</strong><br> ${currentInboundAudio.RemovedSamplesRate.toFixed(1)} /s<br>\n`;                

        sendStatsOutput += `<strong>Packete gesendet</strong><br> ${currentOutboundAudio.PacketsSentRate.toFixed(2)} /s<br>\n`;
        sendStatsOutput += `<strong>Gesendete Bitrate</strong><br> ${currentOutboundAudio.TotalBytesRate.toFixed(2)} kbit/s<br>\n`;
        sendStatsOutput += `<strong>Gesendete Headerbitrate</strong><br> ${currentOutboundAudio.HeaderBytesRate.toFixed(2)} kbit/s<br>\n`;
        
    } catch(err) {
        console.log(err);
    }


    $("#recvStats").html(recvStatsOutput);
    $("#sendStats").html(sendStatsOutput);
};

const switchUiToCallMode = async (roomId: string, newUserId: string) => {
    try {
        await setLocalStream(true, {width: 1920, height: 1080});
    } catch (err) {
        console.error(err);
    }
    entryModal.hide();
    entryModal.dispose();
    $("#meetingIdSpan").text(roomId);
    localStorage.setItem("myUserId", newUserId);

    $(".wrapper").removeClass("invisible");
    $("body").removeClass("bg-primary");
};

document.addEventListener("DOMContentLoaded", async () => {
    
    console.log("Production: " + !c.isDev);

    const roomId = new URLSearchParams(window.location.search).get("roomId");

    if (roomId) {
        console.log("We have joined Room via URL");
        roomIdToJoin = roomId;
        setupJoinModal(roomId);
    } else {
        setupGeneralModal();
    }

    setupWebsocketConnection();
    setupUi();
    setupExperimentalFeatures();
    console.log("Finished Loading");
});

