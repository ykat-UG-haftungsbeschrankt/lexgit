import { Component } from "react";
import type { FormEvent, ReactNode } from "react";
import type { OfficeLawSummary } from "../../law/storage";
import { OfficeLawClient } from "../../law/client";
import { OfficeRequestLifecycle } from "../../law/request";
import { ManagementDialog } from "./ManagementDialog";

interface RemoveLawDialogProps{
	source:OfficeLawSummary;
	onClose:()=>void;
	onRemoved:(slug:string)=>void;
};

interface RemoveLawDialogState{
	busy:boolean;
	error:string|null;
};

export class RemoveLawDialog extends Component<
	RemoveLawDialogProps,RemoveLawDialogState
>{
	protected readonly _requests:OfficeRequestLifecycle;

	constructor(props:RemoveLawDialogProps){
		super(props);
		this._requests=new OfficeRequestLifecycle();
		this.state={busy:false,error:null};
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

	protected _submit(event:FormEvent<HTMLFormElement>):void{
		event.preventDefault();
		this._removeLaw().catch(this._reportUnexpected.bind(this));
	}

	protected _reportUnexpected(error:unknown):void{
		console.error(error);
		if(!this._requests.isDisposed()){
			this.setState({
				busy:false,error:error instanceof Error ? error.message
					:"Gesetz konnte nicht entfernt werden."
			});
		}
	}

	protected async _removeLaw():Promise<void>{
		if(this._requests.isRunning()){
			return;
		}
		const controller=this._requests.start();
		this.setState({busy:true,error:null});
		const {source}=this.props;
		try{
			await OfficeLawClient.removeLaw(source,controller.signal);
		}
		catch(error){
			if(this._requests.finish(controller)){
				this.setState({
					busy:false,
					error:error instanceof Error ? error.message
						:"Gesetz konnte nicht entfernt werden."
				});
			}
			return;
		}
		if(!this._requests.finish(controller)){
			return;
		}
		this.props.onRemoved(source.slug);
	}

	public render():ReactNode{
		const {source,onClose}=this.props;
		const {busy,error}=this.state;
		return(
			<ManagementDialog title="Gesetz entfernen"
				onClose={onClose} busy={busy}>
				<p>
					<strong>{source.abbreviation} — {source.title}</strong>
				</p>
				<p>
					Dieses Gesetz und alle seine gespeicherten Dateien
					werden gelöscht. Nicht committete Änderungen gehen
					verloren. Diese Aktion kann nicht rückgängig gemacht
					werden.
				</p>
				<p className="management-note">
					Die Git-Historie bleibt erhalten.
					Es wird kein Git-Commit erstellt.
				</p>
				<form onSubmit={this._submit.bind(this)}>
					{null !== error && (
						<p className="editor-error" role="alert">{error}</p>
					)}
					<button className="editor-button is-primary"
						type="submit" disabled={busy}>
						{busy ? "Wird entfernt …" : "Endgültig entfernen"}
					</button>
				</form>
			</ManagementDialog>
		);
	}
};
