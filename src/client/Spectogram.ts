export const initializeSpectogram  = (scale: "linear" | "test") : (stream: MediaStream) => void => {
    const canvas = $("#spectogram").get()[0] as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    console.log(width, height);

    const audioContext = new window.AudioContext();
    const audioAnalyser = audioContext.createAnalyser();
    
    audioAnalyser.fftSize = 4096;  

    return function process (stream: MediaStream) {
        const src = audioContext.createMediaStreamSource(stream)
        src.connect(audioAnalyser);
        const data = new Uint8Array(audioAnalyser.frequencyBinCount); 
        ctx.fillStyle = 'hsl(47, 1%, 93%)';
        ctx.fillRect(0, 0, width, height);

        let loop;
        if (scale == "test") {
            loop = () => {
                window.requestAnimationFrame(loop);
                var freqDomain = new Uint8Array(audioAnalyser.frequencyBinCount);
                audioAnalyser.getByteFrequencyData(freqDomain);
                for (var i = 0; i < audioAnalyser.frequencyBinCount; i++) {
                    var value = freqDomain[i];
                    var percent = value / 256;
                    var height = height * percent;
                    var offset = height - height - 1;
                    var barWidth = width/audioAnalyser.frequencyBinCount;
                    var hue = i/audioAnalyser.frequencyBinCount * 360;
                    ctx.fillStyle = 'hsl(' + hue + ', 100%, 50%)';
                    ctx.fillRect(i * barWidth, offset, barWidth, height);
                }
            }
        } else if (scale == "linear") {
            let h = height / data.length;
            loop = () => {
                window.requestAnimationFrame(loop);
                let imgData = ctx.getImageData(1, 0, width - 1, height);
                ctx.fillRect(0, 0, width, height);
                ctx.putImageData(imgData, 0, 0);
                audioAnalyser.getByteFrequencyData(data);
                for (let i = 0; i < data.length; i++) {
                  let rat = data[i] / 255;
                  let hue = Math.round((rat * 120) + 280 % 360);
                  let sat = '100%';
                  let lit = 10 + (70 * rat) + '%';
                  ctx.beginPath();
                  ctx.strokeStyle = `hsl(${hue}, ${sat}, ${lit})`;
                  ctx.moveTo(width - 1, height - (i * h));
                  ctx.lineTo(width -1, height - (i * h + h));
                  ctx.stroke();
                }
            }
        }
        loop();

    }
}
