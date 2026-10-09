import { relative, resolve } from "node:path";
import type { HmrContext, Plugin, ViteDevServer } from "vite";
import type { PreviewServer } from "vite";
import { createOfficeLawApi } from "./api";

export class OfficeLawVitePlugin{
	protected readonly _root:string;
	protected _server:ViteDevServer|null;
	protected _restart:Promise<void>|null;
	protected _restartTimeout:ReturnType<typeof setTimeout>|null;
	protected readonly _onFileChange:(file:string)=>void;
	protected readonly _onClose:()=>void;

	constructor(root:string){
		this._root=resolve(root);
		this._server=null;
		this._restart=null;
		this._restartTimeout=null;
		this._onFileChange=this._handleFileChange.bind(this);
		this._onClose=this._close.bind(this);
	}

	public createPlugin():Plugin{
		return{
			name:"law-files-api",
			configureServer:this._configureServer.bind(this),
			configurePreviewServer:this._configurePreviewServer.bind(this),
			handleHotUpdate:this._handleHotUpdate.bind(this)
		};
	}

	protected _configureServer(server:ViteDevServer):void{
		this._server=server;
		const api=createOfficeLawApi(this._root);
		server.middlewares.use(api.middleware);
		server.watcher.add([
			resolve(this._root,"src/server"),
			resolve(this._root,"src/law")
		]);
		server.watcher.on("add",this._onFileChange);
		server.watcher.on("unlink",this._onFileChange);
		server.httpServer?.once("close",this._onClose);
	}

	protected _configurePreviewServer(server:PreviewServer):void{
		const api=createOfficeLawApi(this._root);
		server.middlewares.use(api.middleware);
	}

	public static _isBackendFile(root:string,file:string):boolean{
		const path=relative(root,file).split("\\").join("/");
		if(!path.endsWith(".ts")){
			return false;
		}
		return path.startsWith("src/server/")
			|| path.startsWith("src/law/")
				&& "src/law/client.ts" !== path
				&& "src/law/request.ts" !== path
				&& "src/law/rich-content.ts" !== path
				&& "src/law/patch-types.ts" !== path;
	}

	protected _handleHotUpdate(context:HmrContext):[]|void{
		if(OfficeLawVitePlugin._isBackendFile(this._root,context.file)){
			// Restart after Vite finishes the current HMR update.
			this._scheduleRestart();
			return[];
		}
	}

	protected _scheduleRestart():void{
		if(null !== this._restartTimeout){
			clearTimeout(this._restartTimeout);
		}
		this._restartTimeout=setTimeout(this._runRestart.bind(this),100);
	}

	protected _runRestart():void{
		this._restartTimeout=null;
		if(null !== this._server){
			this._restartServer(this._server).catch(
				this._reportRestartFailure.bind(this)
			);
		}
	}

	protected _restartServer(server:ViteDevServer):Promise<void>{
		if(null !== this._restart){
			return this._restart;
		}
		server.config.logger.info(
			"Law backend changed; restarting the development server."
		);
		this._restart=server.restart().finally(
			this._restartFinished.bind(this)
		);
		return this._restart;
	}

	protected _restartFinished():void{
		this._restart=null;
	}

	protected _handleFileChange(file:string):void{
		if(null !== this._server
			&& OfficeLawVitePlugin._isBackendFile(this._root,file)){
			this._scheduleRestart();
		}
	}

	protected _reportRestartFailure(error:unknown):void{
		const message=error instanceof Error ? error.message : String(error);
		if(null !== this._server){
			this._server.config.logger.error(
				`Law backend restart failed: ${message}`
			);
		}
		else{
			console.error(`Law backend restart failed: ${message}`);
		}
	}

	protected _close():void{
		this.destructor();
	}

	public destructor():void{
		try{
			if(null !== this._restartTimeout){
				clearTimeout(this._restartTimeout);
				this._restartTimeout=null;
			}
			this._server?.watcher.off("add",this._onFileChange);
			this._server?.watcher.off("unlink",this._onFileChange);
			this._server?.httpServer?.off("close",this._onClose);
			this._server=null;
		}
		catch(UNUSED_e){}
	}
};
