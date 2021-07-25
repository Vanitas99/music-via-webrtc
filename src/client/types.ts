import { Socket } from "socket.io-client";
import { WavRecorder } from "./Recorder";

export type MuteState = "muted" | "unmuted";
export type SharingState = "sharing" | "not-sharing";
export type RemoteConnectionInfo = {
    userName: string,               // Username displayed in UI
    muteState: MuteState,           // If muted or not
    callStarted: boolean,           // Needed to not send an offer twice when onnegotiationneeded is triggered after sending initial offer
    connection: RTCPeerConnection,  // PeerConnection Obj
    mainStream: MediaStream,        // Stream, that holds the video and microphone remote tracks
    additionalStreams: {stream: MediaStream, src?: AudioBufferSourceNode}[], // 
    recorder: WavRecorder | null,
    socket: Socket
};

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
}