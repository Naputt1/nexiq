import { ipcRenderer, contextBridge, type IpcRendererEvent } from "electron";
import type { IpcEvents } from "./types";

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on<K extends keyof IpcEvents>(
    channel: K,
    listener: (payload: IpcEvents[K]) => void,
  ) {
    const wrappedListener = (
      _event: IpcRendererEvent,
      payload: IpcEvents[K],
    ) => listener(payload);
    ipcRenderer.on(channel, wrappedListener);
    return () => {
      ipcRenderer.removeListener(channel, wrappedListener);
    };
  },

  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },
  runCommand: (cmd: string) => ipcRenderer.invoke("run-cli", cmd),

  // You can expose other APTs you need here.
  // ...
});
