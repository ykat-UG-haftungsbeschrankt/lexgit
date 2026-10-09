import { Component } from "react";
import type { ChangeEvent, ReactNode, UIEvent } from "react";
import { OfficeLawClient } from "../../law/client";
import type { OfficeLawXmlSource } from "../../law/client";
import { OfficeLawStorage } from "../../law/storage";
import { OfficeRequestLifecycle } from "../../law/request";
import { ManagementDialog } from "./ManagementDialog";
import { XmlTreeEditor } from "./XmlTreeEditor";
import { XmlVisualEditor } from "./XmlVisualEditor";

interface Props{
	slug:string;
	documentNumber:string;
	onClose:()=>void;
	onSaved:()=>void;
	inline?:bool_t;
	initialMode?:"source"|"visual";
};

interface State{
	source:OfficeLawXmlSource|null;
	draft:string;
	loading:boolean;
	saving:boolean;
	flushing:bool_t;
	error:string|null;
	mode:"tree"|"source"|"visual";
	visualError:string|null;
};

export class XmlEditorDialog extends Component<Props,State>{
	protected readonly _requests:OfficeRequestLifecycle;
	protected _highlight:HTMLPreElement|null;
	protected _visual:XmlVisualEditor|null;

	constructor(props:Props){
		super(props);
		this._requests=new OfficeRequestLifecycle();
		this._highlight=null;
		this._visual=null;
		this.state={
			source:null,draft:"",loading:true,saving:false,flushing:false,
			error:null,
			mode:props.initialMode ?? "tree",visualError:null
		};
	}

	public componentDidMount():void{
		this._requests.activate();
		this._load().catch(this._unexpected.bind(this));
	}

	public componentWillUnmount():void{
		this.destructor();
	}

	public destructor():void{
		try{
			this._requests.destructor();
			this._highlight=null;
			this._visual=null;
		}
		catch(UNUSED_e){}
	}

	protected _unexpected(error:unknown):void{
		console.error(error);
		if(!this._requests.isDisposed()){
			this.setState({
				loading:false,saving:false,flushing:false,
				error:error instanceof Error
					?error.message:"XML-Verarbeitung fehlgeschlagen."
			});
		}
	}

	protected _fail(error:unknown,controller:AbortController):void{
		if(this._requests.finish(controller)){
			this.setState({
				loading:false,saving:false,flushing:false,
				error:error instanceof Error
					?error.message:"XML-Verarbeitung fehlgeschlagen."
			});
		}
	}

	protected async _load():Promise<void>{
		const controller=this._requests.start();
		try{
			const source=await OfficeLawClient.loadProvisionXml(
				this.props.slug,this.props.documentNumber,controller.signal
			);
			if(this._requests.finish(controller)){
				this.setState({source,draft:source.xml,loading:false});
			}
		}
		catch(error){
			this._fail(error,controller);
		}
	}

	protected _change(event:ChangeEvent<HTMLTextAreaElement>):void{
		this.setState({draft:event.target.value,error:null});
	}

	protected _treeChange(draft:string):void{
		this.setState({draft,error:null});
	}

	protected _mode(mode:"tree"|"source"|"visual"):void{
		this._switchMode(mode).catch(this._unexpected.bind(this));
	}

	protected async _switchMode(
		mode:"tree"|"source"|"visual"
	):Promise<void>{
		if(this.state.saving || this.state.flushing || this.state.loading){
			return;
		}
		this.setState({flushing:true});
		try{
			const draft=null === this._visual ? this.state.draft
				:await this._visual.flush();
			if(!this._requests.isDisposed()){
				this.setState({mode,draft,visualError:null,flushing:false});
			}
		}
		catch(error){
			this._unexpected(error);
		}
	}

	protected _setVisual(visual:XmlVisualEditor|null):void{
		this._visual=visual;
	}

	protected _visualError(visualError:string|null):void{
		this.setState({visualError});
	}

	protected _scroll(event:UIEvent<HTMLTextAreaElement>):void{
		if(null !== this._highlight){
			this._highlight.scrollTop=event.currentTarget.scrollTop;
			this._highlight.scrollLeft=event.currentTarget.scrollLeft;
		}
	}

	protected _setHighlight(element:HTMLPreElement|null):void{
		this._highlight=element;
	}

	protected _save():void{
		this._persist().catch(this._unexpected.bind(this));
	}

	protected async _persist():Promise<void>{
		if(this._requests.isRunning() || this.state.saving
			|| this.state.flushing){
			return;
		}
		const {source}=this.state;
		if(null !== this.state.visualError){
			throw new Error(
				"Bitte den visuellen Inhalt korrigieren oder rückgängig machen."
			);
		}
		if(null === source){
			throw new Error("XML muss zuerst geladen werden.");
		}
		this.setState({flushing:true,error:null});
		const draft=null === this._visual ? this.state.draft
			:await this._visual.flush();
		try{
			OfficeLawStorage.validateOfficeLawNormXml(
				draft,this.props.documentNumber
			);
		}
		catch(error){
			this.setState({
				saving:false,
				flushing:false,
				error:error instanceof Error ? error.message
					:"Ungültiges XML."
			});
			return;
		}
		const controller=this._requests.start();
		this.setState({saving:true,flushing:false,error:null});
		try{
			await OfficeLawClient.saveProvisionXml(
				this.props.slug,this.props.documentNumber,
				{xml:draft,token:source.token},controller.signal
			);
		}
		catch(error){
			this._fail(error,controller);
			return;
		}
		if(this._requests.finish(controller)){
			this.props.onSaved();
		}
	}

	protected _tokens():ReactNode[]{
		const {draft}=this.state;
		const pattern=new RegExp(
			"<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>"
			+"|<[^>]*>|&(?:#\\w+|\\w+);","g"
		);
		const tokens:ReactNode[]=[];
		let offset=0;
		for(const match of draft.matchAll(pattern)){
			const index=match.index;
			tokens.push(draft.slice(offset,index));
			const value=match[0];
			const kind=value.startsWith("<!--") ? "comment"
				:value.startsWith("&") ? "entity" : "tag";
			tokens.push(
				<span key={index} className={`xml-${kind}`}>{value}</span>
			);
			offset=index+value.length;
		}
		tokens.push(draft.slice(offset),"\n");
		return tokens;
	}

	public render():ReactNode{
		const {
			source,draft,loading,saving,flushing,error,mode,visualError
		}=this.state;
		const content=<>
				<p>
					Direkt die XML-Struktur dieser Vorschrift bearbeiten.
					Dokumentnummer und Gliederungsposition bleiben erhalten.
					Elemente, Attribute, Text und Fußnoten können geändert
					werden. Änderungen werden ohne Git-Commit gespeichert.
				</p>
				{loading && <p role="status">XML wird geladen …</p>}
				<div className="management-actions">
					<button type="button"
						className="editor-button"
						disabled={loading || saving || flushing}
						aria-pressed={"visual" === mode}
						onClick={this._mode.bind(this,"visual")}>
						Inhalt visuell bearbeiten
					</button>
					{!this.props.inline && <button type="button"
						className="editor-button"
						disabled={loading || saving || flushing
							|| null !== visualError}
						aria-pressed={"tree" === mode}
						onClick={this._mode.bind(this,"tree")}>
						Baumansicht
					</button>}
					<button type="button" className="editor-button"
						disabled={loading || saving || flushing
							|| null !== visualError}
						aria-pressed={"source" === mode}
						onClick={this._mode.bind(this,"source")}>
						XML-Quelltext
					</button>
				</div>
				{null !== source && "visual" === mode && (
					<XmlVisualEditor ref={this._setVisual.bind(this)}
						xml={draft} disabled={saving}
						onChange={this._treeChange.bind(this)}
						onError={this._visualError.bind(this)}/>
				)}
				{null !== source && "tree" === mode && (
					<XmlTreeEditor xml={draft} disabled={saving}
						onChange={this._treeChange.bind(this)}/>
				)}
				{null !== source && "source" === mode && (
					<div className="xml-source-editor">
						<pre ref={this._setHighlight.bind(this)}
							aria-hidden="true" className="xml-highlight">
							{this._tokens()}
						</pre>
						<textarea className="xml-source-input" value={draft}
							onChange={this._change.bind(this)}
							onScroll={this._scroll.bind(this)}
							aria-label="XML-Quelltext der Vorschrift"
							spellCheck={false} wrap="off" disabled={saving}/>
					</div>
				)}
				{null !== error && (
					<p className="editor-error" role="alert">{error}</p>
				)}
				<button className="editor-button is-primary" type="button"
					disabled={loading || saving || flushing || null === source
						|| null !== visualError}
					onClick={this._save.bind(this)}>
					{saving ? "Speichert …" : "XML prüfen und speichern"}
				</button>
				{this.props.inline && <button type="button"
					className="editor-button" disabled={saving || flushing}
					onClick={this.props.onClose}>
					Abbrechen
				</button>}
			</>;
		return this.props.inline
			?<div className="inline-xml-editor">{content}</div>
			:<ManagementDialog title="XML bearbeiten"
				onClose={this.props.onClose} busy={saving || flushing}>
				{content}
			</ManagementDialog>;
	}
};
