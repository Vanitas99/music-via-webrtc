import { Toast } from "bootstrap";
export const logarithmicSliderPosToHz = (sliderPos: number, minHz: number, maxHz: number) => {
    var minp = 0;
    var maxp = 100;
  
    var minv = Math.log(minHz);
    var maxv = Math.log(maxHz);
  
    var scale = (maxv-minv) / (maxp-minp);

    return Math.ceil(Math.exp(minv + scale*(sliderPos-minp)));
}

export const logarithmicHzToSliderPos = (hz: number, minHz: number, maxHz: number) => {
    var minp = 0;
    var maxp = 100;
    
    var minv = Math.log(minHz);
    var maxv = Math.log(maxHz);

    var scale = (maxv-minv) / (maxp-minp);
  
    return minp + (Math.log(hz) - minv) / scale;
}

export const showInfoMessage = (infoToast: Toast | null,state: "success" | "error" | "info", delay: number, msg: string) => {
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

export const addAdditionalStream = (userId: string, track: MediaStreamTrack) => {
    let stream = new MediaStream();
    stream.addTrack(track);

    let audioElement = new Audio();
    audioElement.id = "additional" + userId;
    audioElement.srcObject = stream;
    audioElement.play();

    $("#audioContainer").append(audioElement);
};