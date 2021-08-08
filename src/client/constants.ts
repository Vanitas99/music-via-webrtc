
export const MIC_MUTE_URL = "url(\"../Public/microphone-mute.svg\")";
export const MIC_UNMUTE_URL = "url(\"../Public/microphone-unmute.svg\")";
export const SPEAKER_MUTE_URL = "url(\"../Public/speaker-mute.svg\")";
export const SPEAKER_UNMUTE_URL = "url(\"../Public/speaker-unmute.svg\")";
export const AUDIO_PLAYBACK_FILE = "../Public/Sounds/guitar48_stereo_ref.wav"

export const ENABLED_COLOR = "rgb(152, 226, 41)";
export const DISABLED_COLOR = "rgb(182, 0, 0)";
export const MODEL_BG = "rgb(228, 228, 228)";
export const CALL_BG = "";

export const isDev = process.env.NODE_ENV == "development";
export const PROD_URL = "https://music-via-webrtc.herokuapp.com/";
export const TEST_URL = "http://localhost:5500";

// Kostenlose Stun Server von Google. Nicht mehr als 2 nutzen.
export const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
}