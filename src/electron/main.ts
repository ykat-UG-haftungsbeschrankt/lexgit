import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startDesktopServer } from "../server/desktop";
import { DesktopRepositories } from "./repositories";

class OfficeLawDesktop{
	private window:BrowserWindow|null=null;
	private server:Awaited<ReturnType<typeof startDesktopServer>>|null=null;
	private busy=false;
	private readonly launcher=join(__dirname,"launcher.html");

	public async start():Promise<void>{
		ipcMain.handle("repository:open",event=>this.select(event));
		ipcMain.handle("repository:clone",(event,url:unknown)=>this.select(event,url));
		Menu.setApplicationMenu(Menu.buildFromTemplate([
			{label:"Repository",submenu:[
				{label:"Repository wechseln",click:()=>void this.showLauncher().catch(error=>this.report(error))},
				{type:"separator"},{role:"quit"}
			]},
			{role:"editMenu"},
			{label:"Ansicht",submenu:[{role:"reload"},{role:"resetZoom"},{role:"zoomIn"},{role:"zoomOut"},{role:"togglefullscreen"}]}
		]));
		app.on("activate",()=>{
			if(this.window === null){ void this.showLauncher().catch(error=>this.report(error)); }
		});
		await this.showLauncher();
	}
	private report(error:unknown):void{
		dialog.showErrorBox("Desktop-App",error instanceof Error ? error.message : "Unbekannter Fehler.");
	}
	private async showLauncher():Promise<void>{
		if(this.busy){ return; }
		if(this.window === null){
			const window=new BrowserWindow({
				width:1440,height:960,minWidth:480,minHeight:480,title:"Office Law",
				webPreferences:{
					preload:join(__dirname,"preload.cjs"),nodeIntegration:false,contextIsolation:true,
					sandbox:true,partition:"office-law-desktop"
				}
			});
			this.window=window;
			window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
			window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
			window.webContents.on("will-navigate",(event,url)=>{
				if(url !== pathToFileURL(this.launcher).href && !url.startsWith(`${this.server?.origin}/`)){
					event.preventDefault();
				}
			});
			window.on("closed",()=>{
				this.window=null;
				void this.stopServer().catch(error=>this.report(error));
			});
		}
		if(this.server !== null){
			const result=await dialog.showMessageBox(this.window,{
				type:"question",buttons:["Repository wechseln","Abbrechen"],defaultId:1,cancelId:1,
				message:"Repository wechseln?",detail:"Ungespeicherte Browser-Entwürfe gehen beim Wechsel verloren."
			});
			if(result.response !== 0){ return; }
		}
		await this.window.loadFile(this.launcher);
		await this.stopServer();
	}
	private async stopServer():Promise<void>{
		const server=this.server;
		this.server=null;
		if(server !== null){ await server.close(); }
	}
	private async select(event:IpcMainInvokeEvent,url?:unknown){
		if(this.window === null || event.sender !== this.window.webContents
			|| event.senderFrame?.url !== pathToFileURL(this.launcher).href){
			throw new Error("Repository-Auswahl nur im Desktop-Startfenster erlaubt.");
		}
		if(this.busy){ throw new Error("Eine Repository-Operation läuft bereits."); }
		this.busy=true;
		try{
			const source=url === undefined ? undefined : DesktopRepositories.validateUrl(url);
			const selected=await dialog.showOpenDialog(this.window,{
				title:source === undefined ? "Git-Repository auswählen" : "Zielordner für den Klon auswählen",
				properties:["openDirectory","createDirectory"]
			});
			if(selected.canceled){ return {cancelled:true}; }
			const directory=selected.filePaths[0];
			if(directory === undefined){ throw new Error("Kein Ordner ausgewählt."); }
			const trust=await dialog.showMessageBox(this.window,{
				type:"warning",buttons:["Vertrauen und öffnen","Abbrechen"],defaultId:1,cancelId:1,
				message:"Diesem Repository vertrauen?",
				detail:"Die App bearbeitet dieses Repository. Git-Filter und Commit-Hooks können lokalen Code ausführen. Öffne nur vertrauenswürdige Repositorys."
			});
			if(trust.response !== 0){ return {cancelled:true}; }
			const root=source === undefined ? await DesktopRepositories.root(directory)
				:await DesktopRepositories.clone(source,directory);
			await DesktopRepositories.initializeLaws(root);
			const assets=join(app.getAppPath(),"dist");
			const server=await startDesktopServer(root,assets);
			this.server=server;
			try{
				await this.window.webContents.session.cookies.set({
					url:server.origin,name:"office-law-session",value:server.token,httpOnly:true,sameSite:"strict",path:"/"
				});
				await this.window.loadURL(server.origin);
				this.window.setTitle(`Office Law — ${root}`);
			}
			catch(error){ await this.stopServer(); throw error; }
			return {cancelled:false};
		}
		finally{ this.busy=false; }
	}
}

app.whenReady().then(()=>new OfficeLawDesktop().start()).catch(error=>{
	dialog.showErrorBox("Office Law konnte nicht starten",error instanceof Error ? error.message : String(error));
	app.quit();
});
app.on("window-all-closed",()=>{ if(process.platform !== "darwin"){ app.quit(); } });
