import { Component } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { OfficeLawClient } from "../../law/client";
import { OfficeRequestLifecycle } from "../../law/request";
import type { RepositoryCommitPreview } from "../../law/history";
import { ManagementDialog } from "../management/ManagementDialog";

interface Props{
	onClose:()=>void;
	onCommitted:()=>void;
};

interface State{
	preview:RepositoryCommitPreview|null;
	message:string;
	loading:boolean;
	committing:boolean;
	error:string|null;
};

export default class CommitDialog extends Component<Props,State>{
	protected readonly _requests:OfficeRequestLifecycle;

	constructor(props:Props){
		super(props);
		this._requests=new OfficeRequestLifecycle();
		this.state={
			preview:null,message:"",loading:true,committing:false,error:null
		};
	}

	public componentDidMount():void{
		this._requests.activate();
		this._load();
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

	protected _load():void{
		this._loadPreview().catch(this._reportUnexpected.bind(this));
	}

	protected _reportUnexpected(error:unknown):void{
		console.error(error);
		if(!this._requests.isDisposed()){
			this.setState({
				loading:false,committing:false,
				error:error instanceof Error ? error.message
					:"Commit-Verarbeitung fehlgeschlagen."
			});
		}
	}

	protected _fail(error:unknown,controller:AbortController):void{
		if(this._requests.finish(controller)){
			this.setState({
				loading:false,committing:false,
				error:error instanceof Error ? error.message
					:"Commit-Verarbeitung fehlgeschlagen."
			});
		}
	}

	protected async _loadPreview():Promise<void>{
		const controller=this._requests.start();
		this.setState({loading:true,preview:null,error:null});
		try{
			const preview=await OfficeLawClient.loadCommitPreview(
				controller.signal
			);
			if(this._requests.finish(controller)){
				this.setState({preview,loading:false});
			}
		}
		catch(error){
			this._fail(error,controller);
		}
	}

	protected _commit():void{
		this._commitChanges().catch(this._reportUnexpected.bind(this));
	}

	protected async _commitChanges():Promise<void>{
		if(this._requests.isRunning()){
			return;
		}
		const {preview,message}=this.state;
		if(null === preview){
			throw new Error("Commit-Vorschau ist erforderlich.");
		}
		const controller=this._requests.start();
		this.setState({committing:true,error:null});
		try{
			await OfficeLawClient.commitChanges(
				message,preview.token,controller.signal
			);
		}
		catch(error){
			this._fail(error,controller);
			return;
		}
		if(this._requests.finish(controller)){
			this.props.onCommitted();
		}
	}

	protected _changeMessage(event:ChangeEvent<HTMLTextAreaElement>):void{
		this.setState({message:event.target.value});
	}

	protected _renderFile(path:string):ReactNode{
		return <li key={path}><code>{path}</code></li>;
	}

	public render():ReactNode{
		const {preview,message,loading,committing,error}=this.state;
		return(
			<ManagementDialog title="Repository-Commit erstellen"
				onClose={this.props.onClose} busy={committing}>
				<p className="management-note">
					Alle gespeicherten Änderungen im gesamten Repository
					werden aufgenommen: auch neue und gelöschte Dateien sowie
					bereits vorgemerkte Änderungen. Ignorierte Dateien und
					ungespeicherte Browser-Entwürfe werden nicht aufgenommen.
					Bei abweichenden vorgemerkten Änderungen wird die
					gespeicherte Arbeitsfassung verwendet.
					Git-Hooks werden ausgeführt. Kein Push.
				</p>
				<label>Commit-Nachricht
					<textarea className="commit-message" value={message}
						disabled={committing} maxLength={10000}
						onChange={this._changeMessage.bind(this)}/>
				</label>
				{loading && (
					<p role="status">Commit-Vorschau wird geladen …</p>
				)}
				{null !== error && (
					<p className="editor-error" role="alert">{error}</p>
				)}
				{null !== preview && (
					<>
						<p>{preview.files.length} geänderte Dateien</p>
						<ul aria-label="Dateien im Commit">
							{preview.files.map(this._renderFile.bind(this))}
						</ul>
						{0 === preview.files.length ? (
							<p>Keine Änderungen zum Committen.</p>
						) : (
							<details>
								<summary>Änderungen prüfen</summary>
								<pre className="git-patch">{preview.patch}</pre>
							</details>
						)}
					</>
				)}
				<div className="management-actions">
					<button className="editor-button" type="button"
						disabled={committing || loading}
						onClick={this._load.bind(this)}>
						Vorschau aktualisieren
					</button>
					<button className="editor-button is-primary" type="button"
						disabled={committing || loading || !message.trim()
							|| !preview?.files.length}
						onClick={this._commit.bind(this)}>
						{committing ? "Commit wird erstellt …"
							:"Alle Änderungen committen"}
					</button>
				</div>
			</ManagementDialog>
		);
	}
};
