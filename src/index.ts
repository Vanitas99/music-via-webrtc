type MuteState = { muted: boolean};
type SharingState = { sharing: boolean};

let localMicState: MuteState = { muted: true};
let localSpeakerState: MuteState = { muted: false};
let localCamSate: SharingState = { sharing: false};
let localSSState: SharingState = { sharing: false};

let currentMic: string;
let currentSpeaker: string;
let currentCam: string;

const MIC_MUTE_URL = "url(\"../microphone-mute.svg\")";
const MIC_UNMUTE_URL = "url(\"../microphone-unmute.svg\")";
const SPEAKER_MUTE_URL = "url(\"../speaker-mute.svg\")";
const SPEAKER_UNMUTE_URL = "url(\"../speaker-unmute.svg\")";

const ENABLED_COLOR = "rgb(152, 226, 41)";
const DISABLED_COLOR = "rgb(182, 0, 0)";

const populateDeviceList= async (kind: MediaDeviceKind, obj: HTMLUListElement) => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    while (obj.firstChild) {
        obj.removeChild(obj.firstChild);
    }

    const mapKindToCurrentDevice = {
        "audioinput": currentMic,
        "audiooutput" : currentSpeaker, 
        "videoinput" : currentCam
    }

    const functions = {
        "audioinput" : (e: MouseEvent) => {
            console.log("AUDIO IN");
            let element = (e.target as HTMLAnchorElement);
            currentMic = element.id;
            let bMic = document.querySelector("#selectMic");
        },
        "audiooutput" : (e: MouseEvent) => {
            console.log("AUDIO OUT");
            currentSpeaker = (e.target as HTMLAnchorElement).id
        },
        "videoinput" : (e: MouseEvent) => {
            console.log("VIDEO IN");
            currentCam = (e.target as HTMLAnchorElement).id
        }
    };

    devices.filter( device => device.kind === kind).forEach( 
        device => {
            let newEntry = document.createElement("li");
            let a = document.createElement("a");
            a.className = "dropdown-item ";
            a.id = device.deviceId;
            a.href = "#";
            a.innerText = device.label;
            a.onclick = functions[kind];
            if (device.deviceId == mapKindToCurrentDevice[kind]) {
                a.setAttribute("style", "background-color: #0d6efd;");
            }
            newEntry.appendChild(a);
            obj.appendChild(newEntry);
    });  
};


const setupUi = () => {

    let bMic = document.querySelector("#micButton") as HTMLButtonElement;
    bMic?.addEventListener('click', (e) => {
        const element = (e.target as HTMLButtonElement);
        localMicState.muted = !localMicState.muted;
        console.log(localMicState.muted);

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
            receiveNewStream({width: 1920, height: 1080
            });
        } else {
            (document.querySelector('#localVideo') as HTMLVideoElement).srcObject = null;
        }
    });

    let micSelection = document.querySelector("#micSelection") as HTMLUListElement;
    (document.querySelector("#selectMic") as HTMLButtonElement).onclick = (e) => { populateDeviceList("audioinput", micSelection) };
    let speakerSelection = document.querySelector("#speakerSelection") as HTMLUListElement;
    (document.querySelector("#selectSpeaker") as HTMLButtonElement).onclick = (e) => { populateDeviceList("audiooutput", speakerSelection) };
    let camSelection = document.querySelector("#camSelection") as HTMLUListElement;
    (document.querySelector("#selectCam") as HTMLButtonElement).onclick = (e) => { populateDeviceList("videoinput", camSelection) };

    populateDeviceList("audiooutput", speakerSelection);
    populateDeviceList("audioinput", micSelection);
    populateDeviceList("videoinput", camSelection);

}

const receiveNewStream = ({width, height}: {width: number, height: number}) => {
    navigator.mediaDevices.getUserMedia({video: {width: width, height: height}}).then((stream) => {
        (document.querySelector('#localVideo') as HTMLVideoElement).srcObject = stream;
    }).catch(err => {
        console.log(err);
    });
};


document.addEventListener("DOMContentLoaded", () => {
    setupUi();
    if (localCamSate.sharing) {
        receiveNewStream({width: 100, height: 100});
    } else {
        let style = "; background-size: 100% 100%; background-repeat: no-repeat; background-position:center;";
        (document.querySelector("#localVideo") as HTMLDivElement).style.background = "background: url(\"../no-cam.png\")";
    }

    console.log("Finished Loading");
});

