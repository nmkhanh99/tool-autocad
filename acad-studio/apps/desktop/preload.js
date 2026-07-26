const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("acadStudio", {
  signReview(input) {
    return ipcRenderer.invoke("acad:sign-review", input);
  },
});
