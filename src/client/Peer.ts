import { Toast } from "bootstrap";
import { Socket } from "socket.io-client";
import { CustomAudioGraph } from "./AudioAnalyzer";
import { WavRecorder } from "./Recorder";
import {
    DataChannelMsgType,
    InboundAudioStats, 
    MID, 
    MusicModes, 
    MuteState, 
    OfferType, 
    OpusCodecParameters, 
    OutboundAudioStats, 
    PreferedCodec, 
    RemoteAudioStats, 
    Statistics, 
    TrackID
} from "./types"
import { showInfoMessage } from "./utility";
import * as sdpUtils from "sdp-transform"
import {StatsRatesCalculator, StatsReport} from "./RateCalculator"
import { ICE_SERVERS } from "./constants";
import { stringify } from "uuid";




export class MusicPeerConnection {
    trackNameToAdd: string;
    amICurrentlyAddingATrack: boolean = false;

    amIPolite: boolean;         // Diese Variable wird genutzt, um bei einer neuen Verhandlung der Verbindung (engl. Negotiation),
                                // z.b durch Änderung von Paramtern oder Hinzufügen neuer MediaStreamTracks (audio, video),
                                // eventuelle Data Races zu verhindern. Falls beide Peers gleichzeitig versuchen die Verbindung neu 
                                // auszuhandlen (onnegotiationneeded), d.h. beide einen webrtc-offer senden, dann wird der "nette" Peer
                                // seinen Verhandlungsversuch abbrechen und erst versuchen neu zu verhandeln, wenn die Verbindung in einem
                                // stabilen Zustand ist. (RTCPeerConnection.signalingState == "stable")!
    callHasStarted: boolean = false;
    numberOfMediaTracksSent: number = 0;

    // Remote User Information
    remoteUserId: string;
    remoteUserName: string;
    muteState: MuteState;
    mainMediaStream: MediaStream;
    additionalMediaStreams: Array<MediaStream>;

    // Peer Verbindung
    connection: RTCPeerConnection;
    audioRecorder?: WavRecorder | null;
    datachannel?: RTCDataChannel;
    
    // Media Informationen zu jedem empfangenen Audiostream
    remoteMediaStreams: Map<MID, {
        cname?: string,
        audioGraph: CustomAudioGraph,
        preferecCodec: PreferedCodec,
        opusParams: OpusCodecParameters,
        playoutDelay: number,
        musicMode: MusicModes,
    }>;

    // Media Informationen zu jedem gesendeten Audiostream
    sendingMediaStreams: Map<TrackID, {
        cname?: string,
        mid?: MID,
        filePlaybackInfo?: {
            buffer: AudioBuffer | null,
            dest: MediaStreamAudioDestinationNode | null,
            currentSource: AudioBufferSourceNode | null,
            ctx: AudioContext;
        }
    }>;
    
    // Statistics
    inboundRatesCalc: StatsRatesCalculator;
    outboundRatesCalc: StatsRatesCalculator;
    statistics: Statistics;
    statsQueue: Array<InboundAudioStats>;
    statsCounter = 0;

    // external
    infoToast: Toast | null;
    webserverConnection: Socket

    constructor(userId: string, userName: string, createDataChannel: boolean, infoToast: Toast | null, socket: Socket, localStream: MediaStream) {
        this.remoteUserId = userId;
        this.remoteUserName = userName;

        this.connection = new RTCPeerConnection(ICE_SERVERS);
        
        this.mainMediaStream = new MediaStream();
        this.audioRecorder = null;
        
        this.amIPolite = !createDataChannel;
        this.muteState = "muted";

        this.sendingMediaStreams = new Map<TrackID, {
            cname?: string,
            mid?: MID
        }>();

        this.remoteMediaStreams = new Map<MID, {
            audioGraph: CustomAudioGraph | null,
            preferecCodec: PreferedCodec,
            opusParams: OpusCodecParameters,
            playoutDelay: number,
            musicMode: MusicModes,
        }>();

        /*
        Initial starten wir im Sprache Modus. D.h. Opus mit niedriger Bitrate und entsprechenden Parametern
        */
        this.remoteMediaStreams.set("0", {
            musicMode: "off",
            audioGraph: null,
            opusParams: {
                cbr: 0,
                stereo: 0,
                maxptime: 120,
                usedtx: 1,
                useinbandfec: 1,
                maxaveragebitrate: 32000,
                ptime: 20
            }, 
            playoutDelay: 0,
            preferecCodec: "opus"
        });
        this.statistics = { previousSnapshot: {}};
        this.statsQueue = new Array<InboundAudioStats>(3);
        
        this.additionalMediaStreams = new Array<MediaStream>();

        
        /* 
            In bestimmten Intervallen sollen die Statistiken aus der getStats() Api aktuallisiert und angezeigt werden.
            Um die absoluten Werte in Raten umzuwandeln wird eine modifierte Version des stats_rates_calculator.js aus den webrtc-internals 
            genutzt. Hierbei interessieren uns primär Werte für den eingehenden und ausgehenden Audio RTP Stream
        */
        this.inboundRatesCalc = new StatsRatesCalculator();
        this.outboundRatesCalc = new StatsRatesCalculator();
        
        /* 
            Aller 300ms wollen wir unsere Statistiken abfragen. Die Zeit kann variiert werden,
            je nach dem wie der Algorithmus zur Bandbreitenkontrolle implementiert wird. 
            Z.b: Ein großes Intervall kann bedeuten, dass die Zeit bis zur versuchten Anpassung
            der MediaTrack Qualiäten größer ausfällt und man dadurch länger Einbuße in der Klangqualität
            hat.
        */
        setInterval(async () => await this.getAudioStats(), 300);

        this.infoToast = infoToast;
        this.webserverConnection = socket;
       
        localStream.getTracks().forEach(track => {
            this.connection.addTrack(track);
            this.numberOfMediaTracksSent++;
        });

        // Initialen Codec setzen. Wir starten mit reinem Opus ohne externes FEC.
        if (RTCRtpSender.getCapabilities("audio").codecs.find(codec => codec.mimeType == "audio/red")) {
            console.log("Found RED Codec");
            this.connection.getTransceivers()[0].setCodecPreferences([
                {mimeType: "audio/opus", clockRate: 48000,channels: 2, sdpFmtpLine: "minptime=10;useinbandfec=1"},
                {mimeType: "audio/red", clockRate: 48000, channels: 2}, 
            ]);
        } else {
            this.connection.getTransceivers()[0].setCodecPreferences([
                {mimeType: "audio/opus", clockRate: 48000,channels: 2, sdpFmtpLine: "minptime=10;useinbandfec=1"},
            ]);
            console.log("No RED Codec found");
        };

        if (createDataChannel) {
            this.datachannel = this.connection.createDataChannel("Data Channel", {ordered: true});
            this.datachannel!.onmessage = this.onDataChannelMsg;
        } else {
            this.connection.ondatachannel = (e) => {
                this.datachannel = e.channel;
                this.datachannel!.onmessage = this.onDataChannelMsg;
            };
        }
        
        this.connection.ontrack = this.onWebrtTrack;

        /*
        Wenn ein neuer AudioTrack zur Remote Verbindung hinzugefügt wird, muss dies hier extra behandelt werden.
        */
        this.connection.onnegotiationneeded = async (e) => {
            console.log("Negotiation is needed! " + this.connection.signalingState.toString());
            if (this.connection.signalingState != "stable" || !this.callHasStarted) return;
            try {
                await this.sendOffer("negotiation");
            } catch (err) {
                console.error(err);
            }
        }
        
        this.connection.onicecandidate = async (e) => {
            if (e.candidate) {
                this.webserverConnection!.emit("ice-candidates",userId, JSON.stringify(e.candidate));
            }
        }
    };
    
    private onWebrtTrack = (trackEvent: RTCTrackEvent) => {
        console.log("Received new Track from Remote Peer");
        console.log(trackEvent.transceiver);
        if (trackEvent.track.kind == "audio") {
            // Wenn wir bereits einen Audio Track empfangen, dann muss der neue
            // als zusätzlicher Track registriert und in einem neuen MediaStream Objekt 
            // abgespielt werden. In MediaStreams ist immer nur ein AudioTrack hörbar!
            if (!this.mainMediaStream.getAudioTracks().length) {
                this.mainMediaStream.addTrack(trackEvent.track);
                let audioGraph = new CustomAudioGraph(this.mainMediaStream);
                this.remoteMediaStreams.set(
                    trackEvent.transceiver.mid, {
                        audioGraph: audioGraph,
                        musicMode: "off",
                        opusParams: {
                            cbr: 0,
                            stereo: 0,
                            maxptime: 120,
                            usedtx: 1,
                            useinbandfec: 1,
                            maxaveragebitrate: 32000,
                            ptime: 20
                        },
                        playoutDelay: 0,
                        preferecCodec: "opus"
                    }
                    );
                    audioGraph.startGraph();
                } else {
                    let newStream = new MediaStream();
                    newStream.addTrack(trackEvent.track);
                    this.additionalMediaStreams.push(newStream);
                    let audioGraph = new CustomAudioGraph(newStream);
                    this.remoteMediaStreams.set(
                        trackEvent.transceiver.mid, {
                            audioGraph: audioGraph,
                            musicMode: "off",
                            opusParams: {
                                cbr: 0,
                                stereo: 0,
                                maxptime: 120,
                                usedtx: 1,
                                useinbandfec: 1,
                                maxaveragebitrate: 32000,
                            ptime: 20
                        },
                        playoutDelay: 0,
                        preferecCodec: "opus"
                    });
                    audioGraph.startGraph();
                    const msg: DataChannelMsgType = "requestTrackName";
                    this.datachannel!.send(JSON.stringify({msg: msg, mid: trackEvent.transceiver.mid}));
                }
                const mid = trackEvent.transceiver.mid;
                const newTrackListEntry = `<option value=${trackEvent.transceiver.mid}>${mid == "0" ? "Haupttrack (Mikrofon)" : ""}</option>`;
                $("#peerTrackSelection").append(newTrackListEntry);
            } else {
            /*
                Da wir nur ein Video Stream empfangen wollen vom einem Nutzer, platzieren wir den Video Track
                direkt im MediaStream, der auch das Microphone enthält. 
            */
            this.mainMediaStream.addTrack(trackEvent.track);        
        }
        $(".experimental").removeAttr("disabled");
    };

    private onDataChannelMsg = async ({data}: MessageEvent) => {
        const msg = JSON.parse(data);
        const datachannelmsg: DataChannelMsgType = msg.msg;
        const mid = msg.mid;
        switch (datachannelmsg) {
            case "requestTrackName":
                const newMsg: DataChannelMsgType = "sendTrackName";
                this.datachannel!.send(JSON.stringify({msg: newMsg, mid: msg.mid,  cname: this.trackNameToAdd}));
                this.amICurrentlyAddingATrack = false;
                break;
            case "sendTrackName":
                const cname = msg.cname;
                $(`#peerTrackSelection option[value=${msg.mid}]`).text(cname);
                showInfoMessage(this.infoToast, "info", 5000, `Nutzer ${this.remoteUserName} sendet einen neuen AudioTrack\nName: ${cname}`);
                break;
            case "music-start":
                console.log(`[VIA Data Channel] Remote Peer ${this.remoteUserId} wants to listen to Music on Track ${msg.mid}!`);
                showInfoMessage(this.infoToast, "info", 5000, `TRACK: ${msg.mid}\nNutzer ${this.remoteUserName} möchte Music hören!`);
                break;
            case "music-stop":
                console.log(`[VIA Data Channel] Remote Peer ${this.remoteUserId} wants to stop listening to Music on Track ${msg.mid}`);
                showInfoMessage(this.infoToast, "info", 5000, `TRACK: ${msg.mid}\nNutzer ${this.remoteUserName} möchte keine Music mehr hören!`);
                break;
            case "sdp": 
                const remoteSdp = msg.sdp;
                console.log(`[VIA Data Channel] From ${this.remoteUserId}:\nReceived ${remoteSdp.type} ${remoteSdp.sdp}`);
                if (!this.connection) return;
        
                if (remoteSdp.type == "offer") {
                    if (this.connection.signalingState != "stable") {
                        if (!this.amIPolite) return;
                        try {
                            await Promise.all([
                                this.connection.setLocalDescription({type: "rollback"}),
                                this.connection.setRemoteDescription(remoteSdp)
                                ]);
                        } catch (err) {
                            console.error(err);
                        }
                    } else {
                        try {
                            await this.connection.setRemoteDescription(remoteSdp);
                        } catch (err) {
                            console.error(err);
                        }
                    }
                    try {
                        await this.sendAnswer();
                    } catch (err) {
                        console.error(err);
                    }
                } else if (remoteSdp.type == "answer") {
                    await this.connection.setRemoteDescription(remoteSdp);
                }
                break;    
        }
        console.log(this.connection.getTransceivers());
    };

    private setOpusCodecParameters = async (sdp: RTCSessionDescriptionInit, customMsid?: string) => {
        new Promise<void>((resolve, reject) => {
            this.remoteMediaStreams.forEach((info, mid) => {
                let sdpObj = sdpUtils.parse(sdp.sdp!);
                let opusSegment = sdpObj.media.find(mediaSegment => {
                    return mediaSegment.mid == mid;
                });
                if (!opusSegment) reject(`No Opus Media Segment with mid=${mid} found!`);
        
                if (customMsid) {
                    opusSegment.msid = customMsid;
                }
    
                // Die FMTP Zeile für opus rtp payload finden
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
                for (const [param, val] of Object.entries(info.opusParams)) {
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
            }); 
            resolve();
        });
    };
    
    private getAudioStats = async () => {
        let recvStatsOutput = "";
        let sendStatsOutput = "";
        try {
            if (!this.connection) return;
            let remoteOutboundAudio: RemoteAudioStats = {
                PacketsSent: -1
            };

            const internalStats = await this.connection.getStats();
            internalStats.forEach((report, _) => {
                if (report.kind != "audio") return;
                if (report.type == "inbound-rtp") {
                    let statsReport = StatsReport.fromStatsApiReport(report);
                    this.inboundRatesCalc.addStatsReport(statsReport);
                } else if (report.type == "outbound-rtp") {
                    let statsReport = StatsReport.fromStatsApiReport(report);
                    this.outboundRatesCalc.addStatsReport(statsReport);
                } else if (report.type == "remote-outbound-rtp") {
                    remoteOutboundAudio.PacketsSent = report.packetsSent;
                }
            });

            const completeInboundStats = this.inboundRatesCalc.currentReport.toStatsApiReport()[0];
            const completeOutboundStats = this.outboundRatesCalc.currentReport.toStatsApiReport()[0];
            
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
            this.statsQueue.unshift(currentInboundAudio);
            
            if ((++this.statsCounter % 3) == 0) {
                console.log("Adjusting MediaStreams if needed!");
                const stat1 = this.statsQueue.shift();
                const stat2 = this.statsQueue.shift();
                const stat3 = this.statsQueue.shift();
            }

            console.log(this.statsCounter);
            this.statistics!.currentInboundAudio = currentInboundAudio;
            this.statistics!.currentOutboundAudio = currentOutboundAudio;
            this.statistics!.remoteOutboundAudio = remoteOutboundAudio;
            
            
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


    toggleMusicMode = (mid: MID) => {

    }

    sendOffer = async (offer: OfferType) => {
        let sessionDescription: RTCSessionDescriptionInit;
        try {
            sessionDescription = await this.connection.createOffer();
            // Die gewünschten Opus Parameter müssen bei jedem Offer neu in das SDP eingefügt werden, 
            // bevor das SDP lokal gesetzt wird.
            await this.setOpusCodecParameters(sessionDescription);
            if (!offer && this.connection.signalingState != "stable")  {
                console.log("Not in stable state!");
                return;
            } 
            await this.connection.setLocalDescription(sessionDescription);
            console.log(this.connection.getTransceivers());
        } catch (error) {
        console.error(error);
        return;
        } 

        // Der initiale Webrtc Offer wird über unseren Signaling Server geschickt, alle folgenden können wir über Datenkanäle senden
        if (offer == "initial") {
            const myUserName = $(".user-name-input").val();
            this.webserverConnection!.emit('initial-webrtc-offer', this.remoteUserId, JSON.stringify(sessionDescription), myUserName);
        } else {
            if (this.datachannel?.readyState == "open") {
                this.datachannel?.send(JSON.stringify({msg: "sdp", sdp: sessionDescription}));
            } else {
                this.webserverConnection!.emit("webrtc-offer", this.remoteUserId, JSON.stringify(sessionDescription));
            }
        }
    };

    sendAnswer = async () => {

        let sessionDescription: RTCSessionDescriptionInit;
        try {
            sessionDescription = await this.connection.createAnswer();
            await this.setOpusCodecParameters(sessionDescription);
            this.connection.setLocalDescription(sessionDescription);
            console.log(this.connection.getTransceivers());
            if (this.datachannel?.readyState == "open") {
                this.datachannel.send(JSON.stringify({msg: "sdp", sdp: sessionDescription}));
            } else {
                this.webserverConnection!.emit("webrtc-answer", this.remoteUserId, JSON.stringify(sessionDescription));
            }
        } catch (error) {
            console.error(error);
            return;
        }
    };

    applyNewSessionParameters = async (mid: MID, preferedCodec: PreferedCodec, codecParams: OpusCodecParameters) => {
        const opusCodec = {mimeType: "audio/opus", clockRate: 48000,channels: 2, sdpFmtpLine: "minptime=10;useinbandfec=1"};
        const redCodec = {mimeType: "audio/red", clockRate: 48000, channels: 2};
        try {
            this.remoteMediaStreams.get(mid)!.preferecCodec = preferedCodec;
            this.remoteMediaStreams.get(mid)!.opusParams = codecParams;
            let codecs: RTCRtpCodecCapability[] = [];
            if (preferedCodec == "opus") {
                codecs.push(opusCodec);
                codecs.push(redCodec);
            } else {
                codecs.push(redCodec);
                codecs.push(opusCodec);
            } 
            this.connection.getTransceivers()[0].setCodecPreferences(codecs);
            await this.sendOffer("negotiation"); 
        } catch(err) {
            console.log(err);
        }
    };

    private adjustMediaStreams = () => {
        if (this.connection && this.musicMode == "off") return;

        const prevInbound = this.statistics!.previousSnapshot?.currentInboundAudio;
        const currInbound = this.statistics!.currentInboundAudio;
        const prevRemoteOutbound =this.statistics!.previousSnapshot?.remoteOutboundAudio;
        const currRemoteOutbound = this.statistics!.remoteOutboundAudio;

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
        this.statistics!.previousSnapshot!.currentInboundAudio = currInbound;
        this.statistics!.previousSnapshot!.remoteOutboundAudio = currRemoteOutbound;
    };

    public addAdditionalTrack = (track: MediaStreamTrack, cname?: string) => {
        this.amICurrentlyAddingATrack = true;
        this.trackNameToAdd = cname;
        const sender = this.connection.addTrack(track);
        this.sendingMediaStreams.set(track.id, {cname: cname});
        const newSendingTrackHTML = `<option value=${track.id}>${cname}</option>`;
        $("#sendingTrackSelection").append(newSendingTrackHTML);
        this.numberOfMediaTracksSent++;
    };
    
    public setPlayoutDelay = (delayInSec: number) => {
        // Damit das Video synchron bleibt muss auch hier der Playout Delay gesetzt werden.
        // Der Video Track ist in der SDP Media Description mit der MID = 1 beschrieben.
        const videoTransceiver = this.connection.getTransceivers().find(
            (transceiver) => transceiver.mid == "1"
        );
        
        //@ts-ignore
        videoTransceiver.receiver.playoutDelayHint = delayInSec;
        this.remoteMediaStreams.forEach((_, mid) => {
            console.log(mid);
            let transv = this.connection.getTransceivers().find( transceiver => {
                return transceiver.mid == mid;
            });
            if (transv) {
                console.log("Setting delay " + delayInSec + " for MID: " + mid);
                //@ts-ignore
                transv.receiver.playoutDelayHint = delayInSec;
                this.remoteMediaStreams.get(mid)!.playoutDelay = delayInSec;
            }
        });
    };

    public getPlayoutDelay = (delayInSec: number) => {
        const opusTransceiver = this.connection.getTransceivers()[0];
        const videoTransceiver = this.connection.getTransceivers().find(
            (transceiver) => transceiver.mid == "1"
        );

        //@ts-ignore
        videoTransceiver.receiver.playoutDelayHint = delayInSec;
        //@ts-ignore
        opusTransceiver.receiver.playoutDelayHint = delayInSec;
    };

    public muteAudioTracks = (localSpeakerState: MuteState) => {
        this.mainMediaStream.getAudioTracks().forEach(track => {
            track.enabled = localSpeakerState == "unmuted";
        })
        this.additionalMediaStreams.forEach(stream => {
            stream.getAudioTracks().forEach(track => {
                track.enabled = localSpeakerState == "unmuted";
            })
        })
    };
}

