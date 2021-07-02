

type MuteState = { muted: boolean};
type SharingState = { sharing: boolean};

let localMicState: MuteState = { muted: true};
let localSpeakerState: MuteState = { muted: false};
let localCamSate: SharingState = { sharing: false};
let localSSState: SharingState = { sharing: false};

let currentMic: string;
let currentSpeaker: string;
let currentCam: string;

let deviceSelections: HTMLUListElement[] = [];

let localStream: MediaStream;
let remoteStreamss: MediaStream[] = [];

const MIC_MUTE_URL = "url(\"../Public/microphone-mute.svg\")";
const MIC_UNMUTE_URL = "url(\"../Public//microphone-unmute.svg\")";
const SPEAKER_MUTE_URL = "url(\"../Public/speaker-mute.svg\")";
const SPEAKER_UNMUTE_URL = "url(\"../Public/speaker-unmute.svg\")";

const ENABLED_COLOR = "rgb(152, 226, 41)";
const DISABLED_COLOR = "rgb(182, 0, 0)";

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


const setupUi = () => {

    let bMic = document.querySelector("#micButton") as HTMLButtonElement;
    bMic?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localMicState.muted = !localMicState.muted;
        ((document.querySelector('#localVideo') as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0].enabled = !localMicState.muted;

        element.style.backgroundImage = localMicState.muted ? MIC_MUTE_URL : MIC_UNMUTE_URL;
        element.style.backgroundColor = localMicState.muted ? DISABLED_COLOR :ENABLED_COLOR;
    });
    bMic.style.backgroundImage = MIC_MUTE_URL;
    bMic.style.backgroundColor = DISABLED_COLOR;

    let bSpeaker = document.querySelector("#speakerButton") as HTMLButtonElement;
    bSpeaker?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        
        localSpeakerState.muted = !localSpeakerState.muted;
        console.log(localSpeakerState.muted);
        element.style.backgroundImage = localSpeakerState.muted ? SPEAKER_MUTE_URL : SPEAKER_UNMUTE_URL;
        element.style.backgroundColor = localSpeakerState.muted ? DISABLED_COLOR : ENABLED_COLOR;
    });
    bSpeaker.style.backgroundImage = SPEAKER_UNMUTE_URL;
    bSpeaker.style.backgroundColor = ENABLED_COLOR;


    let bScreenSharing = document.querySelector("#screenshareButton") as HTMLButtonElement;
    bScreenSharing?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localSSState.sharing = !localSSState.sharing;
        element.style.backgroundColor = localSSState.sharing ? ENABLED_COLOR : "";
    });


    let bCam = document.querySelector("#camButton") as HTMLButtonElement;
    bCam?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localCamSate.sharing = !localCamSate.sharing;
        element.style.backgroundColor = localCamSate.sharing ? ENABLED_COLOR : "";
        if (localCamSate.sharing) {
            getLocalStream(true, {width: 1920, height: 1080
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

    

}

const getLocalStream = async (audio: boolean, {width, height}: {width: number, height: number}) => {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({video: {width: width, height: height}, audio: audio});
        (document.querySelector('#localVideo') as HTMLVideoElement).srcObject = localStream;
    } catch(err ) {
        console.log(err);
    };
};



document.addEventListener("DOMContentLoaded", async () => {
    setupUi();
    if (localCamSate.sharing) {
        await getLocalStream(true, {width: 100, height: 100});
    } else {
        let style = "; background-size: 100% 100%; background-repeat: no-repeat; background-position:center;";
        (document.querySelector("#localVideo") as HTMLDivElement).style.background = "background: url(\"../no-cam.png\")";
    }

    console.log("Finished Loading");
});

const setupPeerConnection = () => {
    let pc = RTCPeerConnection;
    localStream.getTracks().forEach(track => {
        pc.prototype.addTrack(track);
    })
    pc.prototype.ontrack = (trackEvent) => {

    }
}

new URLSearchParams(window.location.search).forEach(param => {console.log(param)});
