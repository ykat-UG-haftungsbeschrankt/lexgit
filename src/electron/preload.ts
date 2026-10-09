import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("officeLawDesktop",{
	openRepository:()=>ipcRenderer.invoke("repository:open"),
	cloneRepository:(url:string)=>ipcRenderer.invoke("repository:clone",url)
});
