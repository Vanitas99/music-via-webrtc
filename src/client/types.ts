import { WavRecorder } from "./Recorder";
import { CustomAudioGraph } from "./AudioAnalyzer";

export type MuteState = "muted" | "unmuted";
export type SharingState = "sharing" | "not-sharing";
export type StreamID = string;
export type MID = string;
export type TrackID = string;
export type OfferType = "initial" | "negotiation"

export interface IMusicPeerConnection {
    readonly remoteUserId: string,                                      // User ID (Servers Socket ID)
    readonly remoteUserName: string,                                    // User Name of remote Peer
    connection: RTCPeerConnection,                                      // Webrtc Connection Object
    muteState: MuteState,                                               // Mic Mute
    audioRecorder?: WavRecorder | null,                                 // Record audio tracks of remote peer
    mainMediaStream: MediaStream,                                       // MediaStream that holds main audio and video track
    additionalMediaStreams: Array<MediaStream>,                         // Additional remote audio tracks added by the peer
    opusConfigurations: Map<MID ,OpusCodecParameters>,                             // Current Opus Configuration for audio transmission
    preferedCodecs: Map<MID, PreferedCodec>
    readonly statistics: Statistics,                                    // Custom Statistics for monitoring network behavior and adjusting media transmission
    remoteAudioGraphs:  Map<StreamID, CustomAudioGraph>                 // Custom Audio Processing of a given audio track
    datachannel?: RTCDataChannel,                                       // Datachannel used for direct 2e2 SDP Negotiation

    setOpusCodecParameters: (sdp: RTCSessionDescription, customMsid: string) => Promise<void>,
    getAudioStats: () => Promise<void>,
    adjustMediaStreams: () => void,

    sendOffer: (initialOffer: OfferType) => Promise<void>,
    sendAnswer: () => Promise<void>,
    applyNewSessionParameters: (mid: MID, preferedCodec: PreferedCodec, codecParams: OpusCodecParameters) => Promise<void>,
}

export type InboundAudioStats = {
    Jitter: number, 
    JitterBufferDelay: number, 
    PacketsLost: number,
    PacketsReceived: number,
    PayloadBytesRate: number, 
    HeaderBytesRate: number,
    FecPacktesRecv: number, 
    FecPacketsDiscarded: number,
    InsertedSamplesRate: number, 
    RemovedSamplesRate: number
};

export type OutboundAudioStats = {
    PacketsSentRate: number,
    TotalBytesRate: number,
    HeaderBytesRate: number
};

export type RemoteAudioStats = {
    PacketsSent: number
};

export type Statistics = { 
    previousSnapshot?: Statistics,
    currentInboundAudio?: InboundAudioStats , 
    currentOutboundAudio?: OutboundAudioStats,
    remoteOutboundAudio?: RemoteAudioStats
}

export type MusicModes = "off" | "agressive"

export type OpusCodecParameters = {
    "ptime"?: number,
    "maxptime"?: number,
    "minptime"?: number,
    "maxplaybackrate"?: number,
    "maxaveragebitrate"?: number,
    "sprop-maxcapturerate"?: number,
    "sprop-stereo"?: number,
    "stereo"?: number,
    "cbr"?: number,
    "useinbandfec"?: number,
    "usedtx"?: number
};

export type PreferedCodec = "opus" | "red-fec";

export type DataChannelMsgType = "sdp" | "music-start" | "music-stop" | "requestTrackName" | "sendTrackName";