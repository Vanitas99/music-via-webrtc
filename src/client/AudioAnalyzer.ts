const scale = (number: number, inMin: number, inMax: number, outMin: number, outMax: number) => {
    return (number - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

export class CustomAudioGraph {
    private audioCtx: AudioContext;
    private srcNode: MediaStreamAudioSourceNode;
    private lowpassFilter: BiquadFilterNode;
    private highpassFilter: BiquadFilterNode;

    private visualizer: CustomAudioVisualizer | null;

    constructor(srcStream: MediaStream) {
        this.audioCtx = new window.AudioContext();
        this.lowpassFilter = this.audioCtx.createBiquadFilter();
        this.lowpassFilter.type = "lowpass";
        this.setLowpassFilterFrequency(24000)
        this.highpassFilter = this.audioCtx.createBiquadFilter();
        this.highpassFilter.type = "highpass";
        this.setHighpassFilterFrequency(0);
        this.srcNode = this.audioCtx.createMediaStreamSource(srcStream);
        this.srcNode.connect(this.lowpassFilter).connect(this.highpassFilter).connect(this.audioCtx.destination);
        this.audioCtx.resume();
        this.visualizer = null;
        this.startVisualization("bar", 4096);
    }

    public setLowpassFilterFrequency = (freq: number) => {
        this.lowpassFilter.frequency.value = freq;
    };

    public setHighpassFilterFrequency = (freq: number) => {
        this.highpassFilter.frequency.value = freq;
    };
    
    public startGraph = () => {
        this.audioCtx.resume();
    };

    public stopGraph = () => {
        this.audioCtx.suspend();
    };

    public startVisualization = (mode: "bar" | "spectro", fftSize: number) => {
        this.visualizer = new CustomAudioVisualizer(this.audioCtx, fftSize);
        this.highpassFilter.connect(this.visualizer.getAnalyserNode());
        this.visualizer.startVisualization("bars");
    };

    public stopVisualization = () => {
        if (this.visualizer) {
            this.highpassFilter.disconnect(this.visualizer?.getAnalyserNode());
            this.visualizer?.stopVisualization();
        }
    };

    public setFFTSize = (size: number = 4096) => { 
        if (this.visualizer) {
            this.visualizer.fftSize = size;
        }
    };
}

export class CustomAudioVisualizer {
    public mode: "spectro" | "bars";
    public width: number;
    public height: number
    public fftSize: number;

    private audioCtx: AudioContext;
    private drawCtx: CanvasRenderingContext2D;
    private audioAnalyser: AnalyserNode;
    private running: boolean;

    constructor(audioCtx: AudioContext, fftSize: number = 4096) {
        const canvas = $("#audioVisualizer").get()[0] as HTMLCanvasElement;
        this.drawCtx = canvas.getContext('2d')!;
        this.height = canvas.height;
        this.width = canvas.width;
        this.audioCtx = audioCtx;
        this.audioAnalyser = this.audioCtx.createAnalyser();
        this.fftSize = fftSize;
        this.audioAnalyser.fftSize = this.fftSize;
        this.running = false;
        this.mode = "spectro";
    }
    
    public getAnalyserNode = () => {
        return this.audioAnalyser;
    };

    public startVisualization = (mode: "spectro" | "bars") => {
        console.log("Base Latency for Audio Visualization Context " + this.audioCtx.baseLatency);

        const data = new Uint8Array(this.audioAnalyser.frequencyBinCount); 
        this.drawCtx.fillStyle = 'hsl(47, 1%, 93%)';
        this.drawCtx.fillRect(0, 0, this.width, this.height);

        this.mode = mode;
        const drawMethod = mode == "spectro" ? this.drawSpectogram : this.drawFrequencyBars;

        const animationLoop = () => {
            if (this.running) {
                window.requestAnimationFrame(animationLoop);
            }
            this.audioAnalyser.getByteFrequencyData(data);
            drawMethod(data);
        }
        this.running = true;
        animationLoop();
    }

    public stopVisualization = () => {
        this.running = false;
        this.drawCtx.fillStyle = 'hsl(47, 1%, 93%)';
        this.drawCtx.fillRect(0, 0, this.width, this.height);
    }

    public isRunning = () => {
        return this.running;
    }
    
    private drawSpectogram = (data: Uint8Array) => {
        let imgData = this.drawCtx.getImageData(1, 0, this.width - 1, this.height);
        this.drawCtx.fillRect(0, 0, this.width, this.height);
        this.drawCtx.putImageData(imgData, 0, 0);
        let h = this.height / data.length;
        for (let i = 0; i < data.length; i++) {
            let rat = data[i] / 255;
            let hue = Math.round((rat * 120) + 280 % 360);
            let sat = '100%';
            let lit = (rat > 0) ? (10 + (70 * rat)) + "%" : 100 + '%';
            this.drawCtx.beginPath();
            this.drawCtx.strokeStyle = `hsl(${hue}, ${sat}, ${lit})`;
            this.drawCtx.moveTo(this.width - 1, this.height - (i * h));
            this.drawCtx.lineTo(this.width -1, this.height - (i * h + h));
            this.drawCtx.stroke();
        }
    };

    private drawFrequencyBars = (data: Uint8Array) => {
        let h = this.width / data.length;
        this.drawCtx.clearRect(0, 0, this.width, this.height);
        for (let i = 0; i < data.length; i++) {
            let rat = data[i] / 255;
            let hue = Math.round((rat * 120) + 280 % 360);
            let sat = '100%';
            let lit = (rat > 0) ? (10 + (70 * rat)) + "%" : 100 + '%';
            this.drawCtx.fillStyle = `hsl(${hue}, ${sat}, ${lit})`;
            this.drawCtx.fillRect(i * h, this.height, h, -scale(data[i],0,255, 0, this.height));
        }
    };
}

