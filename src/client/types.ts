import { WavRecorder } from "./Recorder";

export type MuteState = "muted" | "unmuted";
export type SharingState = "sharing" | "not-sharing";
export type RemoteConnectionInfo = {
    userName: string,
    muteState: MuteState,
    connection: RTCPeerConnection,
    stream: MediaStream,
    recorder: WavRecorder | null
};