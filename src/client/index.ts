import { io, Socket } from "socket.io-client";
import { Toast , Modal, Alert} from "bootstrap";
import { WavRecorder } from "./Recorder";
import { 
    MID,
    MuteState, 
    SharingState, 
} from "./types";
import {
    logarithmicHzToSliderPos, 
    logarithmicSliderPosToHz,
    showInfoMessage
} from "./utility"

import {MusicPeerConnection} from "./Peer"

import copy from 'copy-text-to-clipboard';
import * as c from "./constants";

let infoToast: Toast | null = null

let webserverConnection: Socket | null = null;

let localMicState: MuteState = "muted";
let localSpeakerState: MuteState = "unmuted";
let localCamSate: SharingState = "not-sharing";

let entryModal: Modal;
let addTrackModal: Modal;
let roomIdToJoin: string;

let localStream: MediaStream;
let remoteConnections: Map<string, MusicPeerConnection> = new Map();


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

const setupMainUi = () => {

    $("#toggleSidebar").on("click", (e) => {
        $("#sidebar").toggleClass("active");
    });

    $("#musicModeParameters").addClass("invisible");

    $("#endCallButton").on("click", () => {
        webserverConnection!.emit("leave-room");
        window.location.replace( c.isDev ? c.TEST_URL : c.PROD_URL);
    });

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

        remoteConnections.forEach(peer => {
            peer.muteAudioTracks(localSpeakerState);
        });

    });
    bSpeaker.css("backgroundImage", c.SPEAKER_UNMUTE_URL);
    bSpeaker.css("backgroundColor", c.ENABLED_COLOR);

    let bCam = $("#camButton");
    bCam?.on('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localCamSate = localCamSate == "sharing" ? "not-sharing" : "sharing";
        element.style.backgroundColor = localCamSate == "sharing" ? c.ENABLED_COLOR : "";
        localStream.getVideoTracks().forEach(track => {
            track.enabled = localCamSate == "sharing";
        });
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
            showInfoMessage(infoToast,"info", 3000, "Meeting Link in Zwischenablage kopiert!")
        }
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
        
        remoteConnections.forEach(peer => {
            peer.connection
            .getSenders()
            .find(sender => sender.track!.getCapabilities().deviceId == track.getCapabilities().deviceId)
            ?.replaceTrack(newStream.getAudioTracks()[0]);
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

const setupPeerConnection = ({userId, userName} : {userId: string, userName: string}, createDataChannel: boolean = false) : MusicPeerConnection => {

    let peer = new MusicPeerConnection(
        userId,
        userName,
        createDataChannel,
        infoToast,
        webserverConnection!,
        localStream
    );
    remoteConnections.set(userId, peer);
    
    webserverConnection!.on("ice-candidates", (candidate: string) => {
        const iceCandidate : RTCIceCandidateInit = JSON.parse(candidate);
        console.log(`Received Peer Ice Candidate ${iceCandidate}`);
        peer.connection.addIceCandidate(iceCandidate);
    });
    
    const newVidHtml = 
    `<div id="remoteVideo-${userId}" class="col-6 d-flex justify-content-center videos" style="position:relative; box-shadow: 0 0 20px  rgb(0, 0, 0) ">`+
        `<video autoplay muted playsinline style="margin: auto; height: 100%; width: 100%;"></video>` + 
        `<img id="remoteMuteIcon-${userId}" src="../Public/microphone-mute.svg" style=" width: 5%; height: 5%; "></img>`+
        `<span style="font-size: 1.25em; background-color: #0d6efd; color: white; position: absolute; bottom: 0; left: 0; padding: 0.2em">${userName}</span>` +
    `</div>`;
    $("#videoContainer").append(newVidHtml);
    ($(`#remoteVideo-${userId}`).find("video")[0] as HTMLMediaElement).srcObject = peer.mainMediaStream;

    
    $(`#musicMode-${userId}`).css("backgroundColor", c.DISABLED_COLOR);
    
    const newPeerListEntry = `<option value=${userId}>${userName}</option>`;
    $("#peerSelection").append(newPeerListEntry);
    return peer;
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
    webserverConnection!.on("connect", () => { showInfoMessage(infoToast, "success", 3000, "Verbunden mit Webserver!"); });
    webserverConnection!.on("disconnect", () => { showInfoMessage(infoToast, "error", 3000, "Verbindung zum Webserver verloren!\nVerwende zur Kommunikation jetzt DataChannels!"); });
    webserverConnection!.io.on('reconnect', () => {
        webserverConnection!.emit('user-reconnected', localStorage.getItem("myUserId"));
    });
    setupWebsocketMessageHandlers();
};

const setupWebsocketMessageHandlers = () => {
    webserverConnection!.on("err-join-room", (msg: string) => {
        alert(msg);
    });

    webserverConnection!.on("initial-webrtc-offer", async (userId: string, userName: string, sdp: string) => {
        console.log("[VIA WEBSERVER] Received Inital Offer");
        let remoteSdp : RTCSessionDescriptionInit = JSON.parse(sdp);
        try {
            await setLocalStream(true, {width: 1920, height: 1080});
            let peer = setupPeerConnection({userId: userId, userName: userName});
            await peer.connection.setRemoteDescription(remoteSdp);
            await peer.sendAnswer();
            peer.callHasStarted = true;
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
            await remoteConnections.get(userId)!.sendAnswer();
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
            showInfoMessage(infoToast,"info", 3000, `Nutzer ${userName} ist dem Raum beigetreten`);
            let peer = setupPeerConnection({userId: userId, userName: userName}, true);
            await peer.sendOffer("initial");
            remoteConnections.get(userId)!.callHasStarted = true;
    });
    
    webserverConnection!.on("participant-left", (userId: string) => {
        console.log("[VIA WEBSERVER] Participant left: " + userId);
        const name = remoteConnections.get(userId)!.remoteUserName;
        showInfoMessage(infoToast, "info", 3000, `Nutzer ${name} hat den Raum verlassen`);
        remoteConnections.get(userId)!.connection.close();
        remoteConnections.delete(userId);
        $("#remoteVideo-" + userId).remove();
    });

    webserverConnection!.on("user-changed-mute-state", (userId: string, newState: MuteState) => {
        console.log(`[VIA WEBSERVER] Mute State of ${userId} changed.`);
        remoteConnections.get(userId)!.muteState = newState;
        setMuteInUi(userId);
    });
}

const applyAudioProcessing = (config: MediaTrackConstraints) => {
    const selectedPeer = $("#peerSelection").val() as string;
    if (!selectedPeer) return;
    updateLocalAudioTrack(selectedPeer, config);
};

/* 
EXPERIMENTAL FEATURES FOR INVESTIGATING AUDIO QUALITY
*/

const setupExperimentalFeatures = () => {

    const addTrackModalElement = $("#addTrackModal");
    addTrackModal = new Modal(addTrackModalElement![0], { "backdrop": "static", "keyboard": false });
    addTrackModal.hide();
    
    $("#openAddTrackModal").on("click", () => {
        addTrackModal.show();
    });

    $("#peerSelection").on("change", () => {
        const selectedPeer = $("#peerSelection").val() as string;
        $("#peerTrackSelection option").remove();
        const audioReceiver = remoteConnections.get(selectedPeer)!.connection.getReceivers().filter(receiver => {
            return receiver.track.kind == "audio";
        });
        audioReceiver.forEach(receiver => {
            const newTrackListEntry = `<option value=${receiver.track.label}>${receiver.track.label}}</option>`;
            $("#peerTrackSelection").append(newTrackListEntry);
        });
    });
    
    $('#gainRange').on('change', (_) => {
        const gain = $("#gainRange").val() as number;
        console.log(gain);
        const selectedPeer = $("#peerSelection").val() as string;
        const peer = remoteConnections.get(selectedPeer)!;
        const mid = $("#peerTrackSelection").val() as MID;
        const audioGraph = peer.remoteMediaStreams.get(mid)!.audioGraph;
        audioGraph.setGain(gain);
    });
    
    
    $('#highpassFilterRange').on('change', (_) => {
        const freq = logarithmicSliderPosToHz($('#lowpassFilterRange').val() as number, 20, 20000);
        console.log(freq);
        const selectedPeer = $("#peerSelection").val() as string;
        const peer = remoteConnections.get(selectedPeer)!;
        const mid = $("#peerTrackSelection").val() as MID;
        const audioGraph = peer.remoteMediaStreams.get(mid)!.audioGraph;
        audioGraph.setHighpassFilterFrequency(freq as number);
    });

    $('#highpassFilterRange').on('input', (_) => {
        const freq = logarithmicSliderPosToHz($('#highpassFilterRange').val() as number, 20, 20000);
        $('#highpassValue').val(freq.toFixed());
    });

    $("#highpassValue").on("change", (e) => {
        const freq = $("#highpassValue").val();
        $("#highpassValue").val(freq as string);
        $('#highpassFilterRange').val(logarithmicHzToSliderPos($("#highpassValue").val() as number, 20,20000));
        const selectedPeer = $("#peerSelection").val() as string;
        const mid = $("#peerTrackSelection").val() as MID;
        const peer = remoteConnections.get(selectedPeer)!;
        const audioGraph = peer.remoteMediaStreams.get(mid)!.audioGraph;
        audioGraph.setHighpassFilterFrequency(freq as number);
    });

    $('#lowpassFilterRange').on('change', (_) => {
        const freq = logarithmicSliderPosToHz($('#lowpassFilterRange').val() as number, 20, 20000);
        const selectedPeer = $("#peerSelection").val() as string;
        const mid = $("#peerTrackSelection").val() as MID;
        const peer = remoteConnections.get(selectedPeer)!;
        const audioGraph = peer.remoteMediaStreams.get(mid)!.audioGraph;
        audioGraph.setHighpassFilterFrequency(freq as number);
    });
    
    $('#lowpassFilterRange').on('input', (_) => {
        const freq = logarithmicSliderPosToHz($('#lowpassFilterRange').val() as number, 20 , 20000);
        $('#lowpassValue').val(freq.toFixed(0));
    });

    $("#lowpassValue").on("change", (e) => {
        const freq = $("#lowpassValue").val()
        $("#lowpassValue").val(freq as string);
        $('#lowpassFilterRange').val(logarithmicHzToSliderPos($("#lowpassValue").val() as number, 20, 20000));
        const selectedPeer = $("#peerSelection").val() as string;
        const mid = $("#peerTrackSelection").val() as MID;
        const audioGraph = remoteConnections.get(selectedPeer)!.remoteMediaStreams.get(mid)!.audioGraph;
        audioGraph.setLowpassFilterFrequency(freq as number);
    });

    $("#playoutDelay").on("change", (_) => {
        const selectedPeer = $("#peerSelection").val() as string;
        const delayInSec = ($("#playoutDelay").val() as number) / 1000;
        console.log("New Playout Delay is " + delayInSec + " sec");
        remoteConnections.get(selectedPeer)!.setPlayoutDelay(delayInSec);
    });

    $("#visualizeSelection").on("change", (_) => {
        const selectedPeer = $("#peerSelection").val() as string;
        let peer = remoteConnections.get(selectedPeer)!;
        const mid = $("#peerTrackSelection").val();
        const mode = $("#visualizeSelection").val();
        const audioGraph = peer.remoteMediaStreams.get(mid as MID)!.audioGraph;
        if (audioGraph.isVisualizerRunning()) {
            audioGraph.stopVisualization();
            //@ts-ignore
            audioGraph.startVisualization(mode, 1024);
        }
    });

    $("#toggleAudioVisualizer").on("click", () => {
        const selectedPeer = $("#peerSelection").val() as string;
        let peer = remoteConnections.get(selectedPeer)!;
        const mid = $("#peerTrackSelection").val();
        const mode = $("#visualizeSelection").val();
        const audioGraph =  peer.remoteMediaStreams.get(mid as MID)!.audioGraph;
        let running = audioGraph.isVisualizerRunning();
        console.log(running);
        //@ts-ignore
        running ? audioGraph.stopVisualization() : audioGraph.startVisualization(mode, 1024);
        ($("#toggleAudioVisualizer").get()[0] as HTMLButtonElement).style.backgroundColor = 
            audioGraph.isVisualizerRunning() ? c.ENABLED_COLOR :  c.DISABLED_COLOR;
    });
    $("#toggleAudioVisualizer").css("backgroundColor", c.DISABLED_COLOR);

    $("#peerTrackSelection").on("change", () => {
        updateUiComponents();
    });

    $("#openFile").on("click", (_) => {
        $("#file-input").trigger("click");
    });

    $("#file-input").on("change", (_) => {
        const files = ($("#file-input")[0] as HTMLInputElement).files;
        const selectedPeer = $("#peerSelection").val() as string;
        const peer = remoteConnections.get(selectedPeer)!;
        if (peer.amICurrentlyAddingATrack) {
            showInfoMessage(infoToast, "error", 5000, "Kann noch keinen neuen Track hinzufügen!");
            return;
        }

        if (files!.length) {
            let reader = new FileReader();
            reader.onload = (e) => {
                filePlayback.ctx.decodeAudioData(e.target!.result as ArrayBuffer, (buffer) => {
                    filePlayback.buffer = buffer;
                });
                filePlayback.dest = filePlayback.ctx.createMediaStreamDestination();
            };
            reader.readAsArrayBuffer(files![0]);
        }
    });

    $("#finallyAddTrack").on("click", () => {
        const selectedPeer = $("#peerSelection").val() as string;
        const peer = remoteConnections.get(selectedPeer)!;
        const cname = $("#nameForTrackToAdd").val();
        if (!cname) {
            showInfoMessage(infoToast, "error", 5000, "Du musst einen Namen für den Track eingeben!");
            return;
        }
        peer!.addAdditionalTrack(filePlayback.dest.stream.getAudioTracks()[0], cname as string);
        addTrackModal.hide();
    });

    $("#cancelAddTrack").on("click", () => {
        $("#nameForTrackToAdd").val(null);
        addTrackModal.hide();
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
        const recorder = remoteConnections.get(selectedPeer)?.audioRecorder;
        if (!selectedPeer || !recorder || !recorder.fileAvailable()) {
            e.preventDefault();
            alert("Cannot download file");
        }
    });

    if (!RTCRtpSender.getCapabilities("audio").codecs.find(codec => codec.mimeType == "audio/red")) {
        $("#checkOutOfBandFEC").attr('disabled', 'disabled');
    }

    $("#checkAGC").prop("checked", true);
    $("#checkAGC").on("click", (_) => {
        applyAudioProcessing({autoGainControl: $("#checkAGC").is(':checked')});
    });
    
    $("#checkNS").prop("checked", true);
    $("#checkNS").on("click", (_) => {
        applyAudioProcessing({noiseSuppression: $("#checkNS").is(':checked')});
    });
    
    $("#checkEC").prop("checked", true);
    $("#checkEC").on("click", (_) => {
        applyAudioProcessing({echoCancellation: $("#checkEC").is(':checked')});
    });


    $("#applyParameterChanges").on("click", () => {
        const stereo = $("#checkStereo").is(':checked') ? 1 : 0;
        const maxbitrate256 = $("#checkMaxBitrate").is(':checked') ? c.MAX_AVG_OPUS_BITRATE : c.MIN_AVG_OPUS_BITRATE;
        const dtx = $("#checkDtx").is(':checked') ? 1 : 0;
        const inbandFec = $("#checkInbandFEC").is(':checked') ? 1 : 0;
        const preferedCodec = $("#checkOutOfBandFEC").is(':checked') ? "red-fec" : "opus";

        const preferedPTime = Number($("input[type='radio']:checked").val());
        const selectedPeer = $("#peerSelection").val() as string;
        const selectedTrackMID = $("#peerTrackSelection").val() as string;

        remoteConnections.get(selectedPeer)!.applyNewSessionParameters(selectedTrackMID, preferedCodec, {
            stereo: stereo, 
            maxaveragebitrate: maxbitrate256, 
            usedtx: dtx, 
            useinbandfec: inbandFec,
            ptime: preferedPTime
        });
    });

    $("#startRecording").on("click", (_) => {
        const selectedPeer = $("#peerSelection").val() as string;
        if (selectedPeer && remoteConnections.get(selectedPeer)?.audioRecorder == null) {
            let peerStream = remoteConnections.get(selectedPeer)?.mainMediaStream;
            let peerRecorder = new WavRecorder(peerStream!);
            remoteConnections.get(selectedPeer)!.audioRecorder = peerRecorder;
        }
        const recorder =  remoteConnections.get(selectedPeer)?.audioRecorder;
        if (recorder) {
            recorder.start();
            console.log(`Started local recording of User ${selectedPeer}`);
        }
    });

    $("#stopRecording").on("click", (_) => {
        const selectedPeer = $("#peerSelection").val() as string;
        console.log(selectedPeer);
        let peerRecorder = remoteConnections.get(selectedPeer)?.audioRecorder;
        if (peerRecorder) {
            peerRecorder.stop();
            console.log(`Stopped local recording of User ${selectedPeer}`);
        }
    });

    $(`#musicMode`).on("click", (e) => {
        const element = e.target;
        const selectedPeer = $("#peerSelection").val() as string;
        const peer = remoteConnections.get(selectedPeer)!;
        const mid = $("#peerTrackSelection").val() as MID;
        const mediaInfo = peer.remoteMediaStreams.get(mid)!;
        const newMode = mediaInfo.musicMode == "off" ? "agressive" : "off";
        mediaInfo.musicMode = newMode;
        peer.datachannel!.send(JSON.stringify(
            {
                msg: newMode == "off" ? "music-stop" : "music-start",
                mid: mid
            }
        ));

        element.style.backgroundColor = newMode == "off" ? c.DISABLED_COLOR : c.ENABLED_COLOR;
        if (newMode == "off") {
            $("#musicModeParameters").addClass("invisible");
            peer.applyNewSessionParameters(mid, "opus", {
                useinbandfec: 1,
                usedtx: 1,
                stereo: 0,
                ptime: 20,
                maxaveragebitrate: c.MIN_AVG_OPUS_BITRATE
            });
        } else {
            $("#musicModeParameters").removeClass("invisible");
            peer.applyNewSessionParameters(mid, "opus", {
                useinbandfec: 1,
                usedtx: 0,
                stereo: 0,
                ptime: 10,
                maxaveragebitrate: c.MAX_AVG_OPUS_BITRATE
            });
        }
    });
    $(`#musicMode`).css("backgroundColor", c.DISABLED_COLOR);
};

const updateUiComponents = () => {
    const selectedPeer = $("#peerSelection").val() as string;
    const mid = $("#peerTrackSelection").val() as MID;
    const peer = remoteConnections.get(selectedPeer)!;
    const mediaInfo = peer.remoteMediaStreams.get(mid)!;

    const codecParameters = mediaInfo.opusParams;
    const preferedCodec = mediaInfo.preferecCodec;
    const delay = mediaInfo.playoutDelay;
    const lowPassFilterFreq = mediaInfo.audioGraph!.getLowpassFilterFrequency();
    const highpassFilterFreq = mediaInfo.audioGraph!.getHighpassFilterFrequency();
    const musicMode = mediaInfo.musicMode;

    $("#playoutDelay").val(delay * 1000);
    $("#checkInbandFEC").prop("checked", codecParameters.useinbandfec == 1);
    $("#checkOutOfBandFEC").prop("checked", preferedCodec == "red-fec");
    $("#checkDtx").prop("checked", codecParameters.usedtx == 1 );
    $("#checkMaxBitrate").prop("checked", codecParameters.maxaveragebitrate == c.MAX_AVG_OPUS_BITRATE);
    $("#checkStereo").prop("checked", codecParameters.stereo == 1);
    $("lowpassFilterRange").val(lowPassFilterFreq);
    $("lowpassValue").val(lowPassFilterFreq);
    $("highpassFilterRange").val(highpassFilterFreq);
    $("highpassValue").val(highpassFilterFreq);

    peer.remoteMediaStreams.forEach(info => {
        const audioGraph = info.audioGraph!;
        if (audioGraph.isVisualizerRunning()) {
            audioGraph.stopVisualization();
        }
    });
    ($("#toggleAudioVisualizer").get()[0] as HTMLButtonElement).style.backgroundColor = c.DISABLED_COLOR;

    console.log(musicMode);
    ($("#musicMode").get()[0] as HTMLButtonElement).style.backgroundColor = musicMode == "off" ? c.DISABLED_COLOR : c.ENABLED_COLOR;
}

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
    setupMainUi();
    setupExperimentalFeatures();
    console.log("Finished Loading");
});

