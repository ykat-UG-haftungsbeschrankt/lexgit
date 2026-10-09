import { Component } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { OfficeLawClient } from "../../law/client";
import { OfficeRequestLifecycle } from "../../law/request";
import type { RepositoryCommitPreview } from "../../law/history";
import type { OfficeLawPatchPreview } from "../../law/patch-types";
import { ManagementDialog } from "./ManagementDialog";

interface PatchDialogProps{
	onClose:()=>void;
	onApplied:()=>void;
};

interface PatchDialogState{
	exportPreview:RepositoryCommitPreview|null;
	importPreview:OfficeLawPatchPreview|null;
	patch:string;
	busy:boolean;
	error:string|null;
};

export class PatchDialog extends Component<PatchDialogProps,PatchDialogState>{
	protected readonly _requests:OfficeRequestLifecycle;

	constructor(props:PatchDialogProps){
		super(props);
		this._requests=new OfficeRequestLifecycle();
		this.state={
			exportPreview:null,importPreview:null,patch:"",
			busy:false,error:null
		};
	}

	public componentDidMount():void{
		this._requests.activate();
	}

	public componentWillUnmount():void{
		this.destructor();
	}

	public destructor():void{
		try{
			this._requests.destructor();
		}
		catch(UNUSED_e){}
	}

	protected _begin():AbortController{
		const controller=this._requests.start();
		this.setState({busy:true,error:null});
		return controller;
	}

	protected _fail(error:unknown,controller:AbortController):void{
		if(this._requests.finish(controller)){
			this.setState({
				busy:false,error:error instanceof Error
					?error.message:"Patch-Verarbeitung fehlgeschlagen."
			});
		}
	}

	protected _export():void{
		this._loadExport().catch(this._failExport.bind(this));
	}

	protected _failExport(error:unknown):void{
		// Catch failures from callbacks outside the request itself.
		console.error(error);
		if(!this._requests.isDisposed()){
			this.setState({
				busy:false,error:error instanceof Error ? error.message
					:"Patch-Verarbeitung fehlgeschlagen."
			});
		}
	}

	protected async _loadExport():Promise<void>{
		const controller=this._begin();
		this.setState({exportPreview:null});
		try{
			const preview=await OfficeLawClient.loadPatchExport(
				controller.signal
			);
			if(this._requests.finish(controller)){
				this.setState({exportPreview:preview,busy:false});
			}
		}
		catch(error){
			this._fail(error,controller);
		}
	}

	protected _download():void{
		const preview=this.state.exportPreview;
		if(null === preview || !preview.patch){
			throw new Error("Keine Patch-Vorschau vorhanden.");
		}
		const blob=new Blob([preview.patch],{type:"text/plain;charset=utf-8"});
		const url=URL.createObjectURL(blob);
		try{
			const link=document.createElement("a");
			link.href=url;
			link.download="gesetzesbibliothek.patch";
			document.body.appendChild(link);
			try{
				link.click();
			}
			finally{
				link.remove();
			}
		}
		finally{
			URL.revokeObjectURL(url);
		}
	}

	protected _selectFile(event:ChangeEvent<HTMLInputElement>):void{
		const file=event.target.files?.item(0) ?? null;
		event.currentTarget.value="";
		this.setState({patch:"",importPreview:null,error:null});
		if(null !== file){
			this._readFile(file).catch(this._failExport.bind(this));
		}
	}

	protected async _readFile(file:File):Promise<void>{
		const controller=this._begin();
		try{
			if(file.size>8*1024*1024){
				throw new Error("Patch-Dateien dürfen maximal 8 MiB groß sein.");
			}
			const patch=await file.text();
			if(controller.signal.aborted){
				return;
			}
			const preview=await OfficeLawClient.checkPatch(
				patch,controller.signal
			);
			if(this._requests.finish(controller)){
				this.setState({patch,importPreview:preview,busy:false});
			}
		}
		catch(error){
			this._fail(error,controller);
		}
	}

	protected _apply():void{
		this._applyPatch().catch(this._failExport.bind(this));
	}

	protected async _applyPatch():Promise<void>{
		const {patch,importPreview}=this.state;
		if(null === importPreview){
			throw new Error("Bitte zuerst eine Patch-Datei prüfen.");
		}
		const controller=this._begin();
		try{
			await OfficeLawClient.applyPatch(
				patch,importPreview.token,controller.signal
			);
		}
		catch(error){
			if(this._requests.isCurrent(controller)){
				this.setState({importPreview:null});
			}
			this._fail(error,controller);
			return;
		}
		if(this._requests.finish(controller)){
			this.props.onApplied();
		}
	}

	protected _renderFile(path:string):ReactNode{
		return <li key={path}><code>{path}</code></li>;
	}

	public render():ReactNode{
		const {exportPreview,importPreview,patch,busy,error}=this.state;
		return(
			<ManagementDialog title="Änderungen als Patch"
				onClose={this.props.onClose} busy={busy}>
				<p>
					Die gesamte Gesetzesbibliothek wird berücksichtigt,
					einschließlich neuer und gelöschter Gesetze.
					Andere Repository-Dateien bleiben unberührt.
				</p>
				<p className="management-note">
					Exportiert werden gespeicherte Änderungen gegenüber
					HEAD, auch noch nicht vorgemerkte Dateien.
					Ungespeicherte Textentwürfe sind nicht enthalten.
					Ignorierte Dateien bleiben ausgeschlossen.
					Import verändert weder Git-Staging noch Commits.
				</p>
				<h3>Exportieren</h3>
				<button className="editor-button" type="button"
					disabled={busy} onClick={this._export.bind(this)}>
					Export-Vorschau laden
				</button>
				{null !== exportPreview && (
					<>
						<p>{exportPreview.files.length} geänderte Dateien</p>
						{exportPreview.files.length>0 ? (
							<>
								<details>
									<summary>Export prüfen</summary>
									<pre className="git-patch">
										{exportPreview.patch}
									</pre>
								</details>
								<button className="editor-button" type="button"
									disabled={busy}
									onClick={this._download.bind(this)}>
									.patch herunterladen
								</button>
							</>
						) : <p>Keine Änderungen vorhanden.</p>}
					</>
				)}
				<h3>Importieren</h3>
				<label>Patch-Datei
					<input type="file" accept=".patch,.diff,text/plain"
						disabled={busy}
						onChange={this._selectFile.bind(this)}/>
				</label>
				{busy && <p role="status">Patch wird verarbeitet …</p>}
				{null !== error && (
					<p className="editor-error" role="alert">{error}</p>
				)}
				{null !== importPreview && (
					<>
						<p>Konfliktprüfung erfolgreich.</p>
						<ul aria-label="Dateien im Patch">
							{importPreview.files.map(
								this._renderFile.bind(this)
							)}
						</ul>
						<details>
							<summary>Änderungen prüfen</summary>
							<pre className="git-patch">{patch}</pre>
						</details>
						<p>
							Beim Anwenden werden die aufgeführten Dateien
							geändert, hinzugefügt oder gelöscht.
						</p>
						<button className="editor-button is-primary"
							type="button" disabled={busy}
							onClick={this._apply.bind(this)}>
							Patch anwenden
						</button>
					</>
				)}
			</ManagementDialog>
		);
	}
};
