import Recorder from "recorder-js";

export class WavRecorder {
    private _recorder: Recorder;
    private _fileAvailable: boolean;

    constructor(stream: MediaStream) {
        this._fileAvailable = false;
        
        const audioCtx = new window.AudioContext();
        this._recorder = new Recorder(audioCtx);
        this._recorder.init(stream);
    }

    public fileAvailable = () : boolean => {
        return this._fileAvailable
    };

    public start = async () => {
        this._fileAvailable = false;
        try {
            await this._recorder.start();
            this._fileAvailable = false;
        } catch(err) {
            console.log(err);
        } 
    }

    public stop = async () => {
        try {
            const res = await this._recorder.stop();
            this.renderBlob(res.blob);
            this._fileAvailable = true;
        } catch (err) {
            console.log(err);
        }
            
    }

    private renderBlob = (data: Blob) => {
        const downloadUrl = URL.createObjectURL(data);
        const now = new Date();
        const name = `recording-${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDay().toString().padStart(2, '0')}--${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}-${now.getSeconds().toString().padStart(2, '0')}.webm`;
        $("#downloadRecording").attr("href", downloadUrl).attr("download", );
        this._fileAvailable = true;
    };

};