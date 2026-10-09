import { Component, createRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { OfficeLawPreview } from "../../law/preview";
import type { OfficeLawPreviewPosition } from "../../law/preview";
import type { OfficeLawCitationReference } from "../../law/citations";
import type { CitationContextValue } from "./CitationContext";
import { CitationContext } from "./CitationContext";
import LegalText from "../legal/LegalText";
import SourceLegalText from "../legal/SourceLegalText";
import type { OfficeLawCitationContent } from "../../law/client";
import type { OfficeLawDiffLine } from "../../law/diff";

interface CitationPreviewProperties{
	reference:OfficeLawCitationReference;
	context:CitationContextValue;
}

interface CitationPreviewState{
	open:boolean;
	content:OfficeLawCitationContent|null;
	showFullText:boolean;
	error:string|null;
	position:OfficeLawPreviewPosition;
}

let nextPreviewId=0;

export default class CitationPreview extends Component<CitationPreviewProperties,CitationPreviewState>{
	public state:CitationPreviewState={
		open:false,
		content:null,
		showFullText:false,
		error:null,
		position:{top:0,left:0,width:360,maxHeight:320}
	};
	private readonly anchor=createRef<HTMLButtonElement>();
	private readonly popup=createRef<HTMLDivElement>();
	private readonly id=`citation-preview-${++nextPreviewId}`;
	private controller:AbortController|null=null;
	private mounted=false;

	public componentDidMount():void{
		this.mounted=true;
		if(this.state.open){
			this.addListeners();
			this.load();
			this.updatePosition();
		}
	}

	public componentDidUpdate(previousProps:CitationPreviewProperties,previousState:CitationPreviewState):void{
		if(this.state.open !== previousState.open){
			if(this.state.open){
				this.addListeners();
				this.load();
				this.popup.current?.focus();
			}else{
				this.abort();
				this.removeListeners();
			}
		}else if(this.state.open && (previousProps.reference !== this.props.reference
			|| previousProps.context !== this.props.context)){
			this.load();
		}
		if(this.state.open){
			this.updatePosition();
		}
	}

	public componentWillUnmount():void{
		this.mounted=false;
		this.abort();
		this.removeListeners();
	}

	private abort():void{
		this.controller?.abort();
		this.controller=null;
	}

	private load():void{
		this.abort();
		const controller=new AbortController();
		this.controller=controller;
		this.setState({content:null,error:null,showFullText:false});
		this.props.context.resolver.resolve(this.props.reference,controller.signal).then(value=>{
			if(this.mounted && this.controller === controller && !controller.signal.aborted){
				this.setState({content:value});
			}
		},reason=>{
			if(this.mounted && this.controller === controller && !controller.signal.aborted){
				this.setState({
					error:reason instanceof Error ? reason.message : "Der Verweis konnte nicht geladen werden."
				});
			}
		});
	}

	private show=():void=>{
		this.setState({open:true});
	};

	private close=():void=>{
		this.setState({open:false},()=>this.anchor.current?.focus());
	};

	private updatePosition=():void=>{
		const rect=this.anchor.current?.getBoundingClientRect();
		if(!this.mounted || !this.state.open || rect === undefined){
			return;
		}
		const position=OfficeLawPreview.position(
			rect,
			{width:window.innerWidth,height:window.innerHeight},
			this.popup.current?.offsetHeight
		);
		const current=this.state.position;
		if(position.top !== current.top || position.left !== current.left
			|| position.width !== current.width || position.maxHeight !== current.maxHeight){
			this.setState({position});
		}
	};

	private dismiss=(event:KeyboardEvent):void=>{
		if(event.key === "Escape"){
			this.close();
		}
	};

	private outside=(event:PointerEvent):void=>{
		if(event.target instanceof Node
			&& !this.anchor.current?.contains(event.target)
			&& !this.popup.current?.contains(event.target)){
			this.setState({open:false});
		}
	};

	private addListeners():void{
		window.addEventListener("resize",this.updatePosition);
		window.addEventListener("scroll",this.updatePosition,true);
		window.addEventListener("keydown",this.dismiss);
		window.addEventListener("pointerdown",this.outside);
	}

	private removeListeners():void{
		window.removeEventListener("resize",this.updatePosition);
		window.removeEventListener("scroll",this.updatePosition,true);
		window.removeEventListener("keydown",this.dismiss);
		window.removeEventListener("pointerdown",this.outside);
	}

	protected _renderSource(
		source:OfficeLawCitationContent["sources"][size_t],index:size_t
	):ReactNode{
		return <SourceLegalText key={index} source={source.xml}
			container="text"
			{...(this.state.showFullText ? {}:{
				excerptScopes:source.scopes
			})}/>;
	}

	protected _textLine(text:utf8_t):OfficeLawDiffLine{
		return{
			kind:"unchanged",text,originalText:text,editedText:text
		};
	}

	protected _renderContent(content:OfficeLawCitationContent):ReactNode{
		if(0<content.sources.length){
			return content.sources.map(this._renderSource.bind(this));
		}
		const text=this.state.showFullText ? content.fullText:content.text;
		const lines=text.split("\n").map(this._textLine.bind(this));
		return <LegalText lines={lines}/>;
	}

	public render():ReactNode{
		const {reference}=this.props;
		const {open,content,error,position,showFullText}=this.state;
		return(
			<>
				<button className="citation-reference" ref={this.anchor} type="button"
					aria-haspopup="dialog" aria-expanded={open}
					aria-controls={open ? this.id : undefined}
					onClick={this.show}>
					{reference.text}
				</button>
				{open && createPortal(
					<div className="citation-preview" ref={this.popup} id={this.id} role="dialog"
						aria-labelledby={`${this.id}-title`} tabIndex={-1} style={position}>
						<div className="citation-preview-heading">
							<strong id={`${this.id}-title`}>{content?.title ?? reference.text}</strong>
							<button className="citation-preview-close" type="button"
								aria-label="Zitatvorschau schließen" onClick={this.close}>
								<svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
									<path d="m5 5 10 10M15 5 5 15"/>
								</svg>
							</button>
						</div>
						<p className="citation-preview-source">Vorschau aus den gespeicherten Gesetzesdateien</p>
						{error !== null
							?<p role="alert">{error}</p>
							:content === null
							?<p role="status">Verweis wird geladen …</p>
							:<>
								{content.text !== content.fullText && <button className="editor-button" type="button"
									aria-pressed={showFullText} aria-controls={`${this.id}-text`}
									onClick={()=>this.setState(state=>({showFullText:!state.showFullText}))}>
									{showFullText ? "Nur zitierte Stelle anzeigen" : "Gesamte Vorschrift anzeigen"}
								</button>}
								<div className="citation-preview-text" id={`${this.id}-text`}>
									<CitationContext.Provider value={null}>
										{this._renderContent(content)}
									</CitationContext.Provider>
								</div>
							</>}
					</div>,document.body
				)}
			</>
		);
	}
}
