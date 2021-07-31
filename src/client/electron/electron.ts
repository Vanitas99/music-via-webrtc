// src/electron.js
import {BrowserWindow, app} from "electron";

const createWindow = () => {
  // Create the browser window.
  let win = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      nodeIntegration: true
    }
  });

  win.menuBarVisible = false;
  // and load the index.html of the app.
  win.loadURL("http://localhost:5500/");
  //win.loadURL("chrome://webrtc-internals");

}

app.commandLine.appendSwitch("force-fieldtrials", "WebRTC-Audio-Red-For-Opus/Enabled/");
app.on('ready', createWindow);