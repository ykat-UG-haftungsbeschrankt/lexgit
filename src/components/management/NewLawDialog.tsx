import { Component } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import type { OfficeLawDocument } from "../../law/types";
import { OfficeLawClient } from "../../law/client";
import { OfficeRequestLifecycle } from "../../law/request";
import { ManagementDialog } from "./ManagementDialog";

type NewLawDialogMode="empty"|"xml";
type NewLawField="abbreviation"|"title"|"shortTitle"|"indexPath";

interface NewLawDialogProps{
	onClose:()=>void;
	onCreated:(law:OfficeLawDocument,indexPath:string)=>void;
};

interface NewLawDialogState{
	mode:NewLawDialogMode;
	abbreviation:string;
	title:string;
	shortTitle:string;
	indexPath:string;
	xmlFileName:string|null;
	busy:boolean;
	error:string|null;
};

export class NewLawDialog extends Component<
	NewLawDialogProps,NewLawDialogState
>{
	protected readonly _requests:OfficeRequestLifecycle;
	protected _xmlFile:File|null;

	constructor(props:NewLawDialogProps){
		super(props);
		this._requests=new OfficeRequestLifecycle();
		this._xmlFile=null;
		this.state={
			mode:"empty",abbreviation:"",title:"",shortTitle:"",
			indexPath:"https://www.gesetze-im-internet.de/",
			xmlFileName:null,busy:false,error:null
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
			this._xmlFile=null;
		}
		catch(UNUSED_e){}
	}

	protected _handleChange(
		field:NewLawField,event:ChangeEvent<HTMLInputElement>
	):void{
		this.setState(this._updateField.bind(this,field,event.target.value));
	}

	protected _updateField(
		field:NewLawField,value:string,current:NewLawDialogState
	):NewLawDialogState{
		return{...current,[field]:value};
	}

	protected _handleMode(mode:NewLawDialogMode):void{
		this._xmlFile=null;
		this.setState({mode,xmlFileName:null,error:null});
	}

	protected _handleXmlFile(event:ChangeEvent<HTMLInputElement>):void{
		const file=event.target.files?.item(0) ?? null;
		this._xmlFile=file;
		this.setState({xmlFileName:file?.name ?? null});
	}

	protected async _submitEmpty(signal:AbortSignal):Promise<OfficeLawDocument>{
		return OfficeLawClient.createLaw({
			abbreviation:this.state.abbreviation.trim(),
			title:this.state.title.trim(),
			shortTitle:this.state.shortTitle.trim() || null,
			indexPath:this.state.indexPath.trim()
		},signal);
	}

	protected async _submitXml(signal:AbortSignal):Promise<OfficeLawDocument>{
		const file=this._xmlFile;
		if(null === file){
			throw new Error("Bitte eine XML-Datei auswählen.");
		}
		const xml=await file.text();
		signal.throwIfAborted();
		return OfficeLawClient.importLaw(
			this.state.indexPath.trim(),xml,signal
		);
	}

	protected _submit(event:FormEvent<HTMLFormElement>):void{
		event.preventDefault();
		this._createLaw().catch(this._reportUnexpected.bind(this));
	}

	protected _reportUnexpected(error:unknown):void{
		console.error(error);
		if(!this._requests.isDisposed()){
			this.setState({
				busy:false,error:error instanceof Error ? error.message
					:"Gesetz konnte nicht angelegt werden."
			});
		}
	}

	protected async _createLaw():Promise<void>{
		if(this._requests.isRunning()){
			return;
		}
		const controller=this._requests.start();
		const indexPath=this.state.indexPath.trim();
		this.setState({busy:true,error:null});
		let law:OfficeLawDocument;
		try{
			law="xml" === this.state.mode
				?await this._submitXml(controller.signal)
				:await this._submitEmpty(controller.signal);
		}
		catch(error){
			if(this._requests.finish(controller)){
				this.setState({
					busy:false,error:error instanceof Error ? error.message
						:"Gesetz konnte nicht angelegt werden."
				});
			}
			return;
		}
		if(this._requests.finish(controller)){
			this.setState({busy:false});
			this.props.onCreated(law,indexPath);
		}
	}

	public render():ReactNode{
		const {
			mode,abbreviation,title,shortTitle,indexPath,
			xmlFileName,busy,error
		}=this.state;
		const isXml="xml" === mode;
		return(
			<ManagementDialog title="Gesetz hinzufügen"
				onClose={this.props.onClose} busy={busy}>
				<p>
					{isXml ? (
						<>Ein Gesetz aus einer XML-Datei im Format von
							gesetze-im-internet.de importieren.</>
					) : (
						<>Ein leeres Gesetz anlegen. Danach Abschnitte und
							Vorschriften im Inhaltsverzeichnis hinzufügen.</>
					)}
				</p>
				<fieldset disabled={busy} className="management-mode">
					<label>
						<input type="radio" name="new-law-mode" checked={!isXml}
							onChange={this._handleMode.bind(this,"empty")}/>
						Leeres Gesetz
					</label>
					<label>
						<input type="radio" name="new-law-mode" checked={isXml}
							onChange={this._handleMode.bind(this,"xml")}/>
						Aus XML-Datei importieren
					</label>
				</fieldset>
				<form onSubmit={this._submit.bind(this)}>
					<fieldset disabled={busy} className="management-fields">
						{!isXml && <p className="management-note">
							Der Ordnername wird aus der Abkürzung abgeleitet.
						</p>}
						{isXml && <p className="management-note">
							Der Ordnername wird aus jurabk in der XML-Datei
							abgeleitet.
						</p>}
						{!isXml && <label>Abkürzung
							<input required value={abbreviation}
								onChange={this._handleChange.bind(
									this,"abbreviation"
								)} placeholder="MeinG"/>
						</label>}
						{!isXml && <label>Gesetzestitel
							<input required value={title}
								onChange={this._handleChange.bind(this,"title")}/>
						</label>}
						{!isXml && <label>Kurztitel (optional)
							<input value={shortTitle}
								onChange={this._handleChange.bind(
									this,"shortTitle"
								)}/>
						</label>}
						<label>Amtlicher Link (HTTPS, ohne /index.html)
							<input required type="url" pattern="https://.*"
								value={indexPath}
								onChange={this._handleChange.bind(
									this,"indexPath"
								)}/>
						</label>
						{isXml && <label>XML-Datei
							<input required type="file"
								accept=".xml,application/xml,text/xml"
								onChange={this._handleXmlFile.bind(this)}/>
						</label>}
						{isXml && null !== xmlFileName && (
							<p className="management-note">
								Ausgewählt: {xmlFileName}
							</p>
						)}
					</fieldset>
					{null !== error && (
						<p className="editor-error" role="alert">{error}</p>
					)}
					<p className="management-note">
						Die Dateien werden gespeichert.
						Es wird kein Git-Commit erstellt.
					</p>
					<button className="editor-button is-primary"
						disabled={busy} type="submit">
						{busy ? "Wird angelegt …"
							:isXml ? "Gesetz importieren" : "Gesetz anlegen"}
					</button>
				</form>
			</ManagementDialog>
		);
	}
};
