import { Component } from "react";
import type { OfficeLawDocument } from "./law/types";
import type { OfficeLawSummary } from "./law/storage";
import { OfficeLawClient } from "./law/client";
import { OfficeRequestLifecycle } from "./law/request";
import LawExplorer from "./components/LawExplorer";
import { NewLawDialog } from "./components/management/NewLawDialog";
import { RemoveLawDialog } from "./components/management/RemoveLawDialog";
import { PatchDialog } from "./components/management/PatchDialog";
import "./App.css";

type AppDialog="new-law"|"remove-law"|"patches"|null;

interface AppState{
	sources:OfficeLawSummary[];
	source:OfficeLawSummary|null;
	law:OfficeLawDocument|null;
	error:string|null;
	sourcesLoaded:boolean;
	dialog:AppDialog;
	version:number;
	preferredId:string;
};

export default class App extends Component<Record<string,never>,AppState>{
	protected readonly _sourcesRequest:OfficeRequestLifecycle;
	protected readonly _lawRequest:OfficeRequestLifecycle;

	constructor(props:Record<string,never>){
		super(props);
		this.state={
			sources:[],source:null,law:null,error:null,sourcesLoaded:false,
			dialog:null,version:0,preferredId:""
		};
		this._sourcesRequest=new OfficeRequestLifecycle();
		this._lawRequest=new OfficeRequestLifecycle();
	}

	public componentDidMount():void{
		this._sourcesRequest.activate();
		this._lawRequest.activate();
		this._loadSources(false);
	}

	public componentWillUnmount():void{
		this.destructor();
	}

	public destructor():void{
		try{
			this._sourcesRequest.destructor();
			this._lawRequest.destructor();
		}
		catch(UNUSED_e){}
	}

	protected _loadSources(reload:boolean):void{
		const controller=this._sourcesRequest.start();
		OfficeLawClient.loadLawSources(controller.signal).then(
			this._sourcesLoaded.bind(this,controller,reload),
			this._sourcesFailed.bind(this,controller)
		);
	}

	protected _sourcesLoaded(
		controller:AbortController,reload:boolean,
		sources:OfficeLawSummary[]
	):void{
		if(!this._sourcesRequest.finish(controller)){
			return;
		}
		const slug=reload ? this.state.source?.slug:"stvg";
		const source=sources.find(this._matchesSlug.bind(this,slug))
			?? sources[0] ?? null;
		this.setState({
			sources,source,sourcesLoaded:true,preferredId:"",
			version:this.state.version+(reload ? 1:0)
		});
		if(null !== source){
			this._loadLaw(source);
		}
	}

	protected _matchesSlug(
		slug:string|undefined,source:OfficeLawSummary
	):boolean{
		return slug === source.slug;
	}

	protected _sourcesFailed(
		controller:AbortController,error:unknown
	):void{
		if(this._sourcesRequest.finish(controller)){
			this.setState({
				error:error instanceof Error ? error.message
					:"Gesetzesliste konnte nicht geladen werden."
			});
		}
	}

	protected _loadLaw(source:OfficeLawSummary):void{
		const controller=this._lawRequest.start();
		this.setState({law:null,error:null});
		OfficeLawClient.loadLaw(source,controller.signal).then(
			this._lawLoaded.bind(this,controller),
			this._lawFailed.bind(this,controller)
		);
	}

	protected _lawLoaded(
		controller:AbortController,law:OfficeLawDocument
	):void{
		if(this._lawRequest.finish(controller)){
			this.setState({law});
		}
	}

	protected _lawFailed(
		controller:AbortController,error:unknown
	):void{
		if(this._lawRequest.finish(controller)){
			this.setState({
				error:error instanceof Error ? error.message
					:"Beim Laden des Gesetzes ist ein Fehler aufgetreten."
			});
		}
	}

	protected _selectLaw(source:OfficeLawSummary):void{
		this.setState({source,preferredId:""});
		this._loadLaw(source);
	}

	protected _lawCreated(
		law:OfficeLawDocument,indexPath:string
	):void{
		const source:OfficeLawSummary={
			slug:law.slug,documentNumber:law.documentNumber,
			abbreviation:law.metadata.abbreviation ?? law.slug,
			title:law.metadata.title ?? law.slug,
			shortTitle:law.metadata.shortTitle,indexPath
		};
		this._lawRequest.cancel();
		this.setState(this._createdState.bind(this,law,source));
	}

	protected _createdState(
		law:OfficeLawDocument,source:OfficeLawSummary,current:AppState
	):AppState{
		return{
			...current,sources:[...current.sources,source],
			source,law,error:null,dialog:null,preferredId:""
		};
	}

	protected _structureSaved(
		law:OfficeLawDocument,preferredId:string,indexPath:string
	):void{
		const currentSource=this.state.source;
		if(null === currentSource){
			throw new Error("No law selected.");
		}
		const source:OfficeLawSummary={
			...currentSource,
			abbreviation:law.metadata.abbreviation
				?? currentSource.abbreviation,
			title:law.metadata.title ?? currentSource.title,
			shortTitle:law.metadata.shortTitle,indexPath
		};
		this._lawRequest.cancel();
		this.setState(this._structureState.bind(
			this,law,source,preferredId
		));
	}

	protected _structureState(
		law:OfficeLawDocument,source:OfficeLawSummary,
		preferredId:string,current:AppState
	):AppState{
		return{
			...current,
			sources:current.sources.map(
				this._replaceSource.bind(this,source)
			),
			source,law,preferredId,version:current.version+1
		};
	}

	protected _replaceSource(
		source:OfficeLawSummary,item:OfficeLawSummary
	):OfficeLawSummary{
		return source.slug === item.slug ? source:item;
	}

	protected _openNewLaw():void{
		this.setState({dialog:"new-law"});
	}

	protected _closeNewLaw():void{
		this.setState({dialog:null});
	}

	protected _openRemoveLaw():void{
		this.setState({dialog:"remove-law"});
	}

	protected _closeRemoveLaw():void{
		this.setState({dialog:null});
	}

	protected _lawRemoved(slug:string):void{
		this._lawRequest.cancel();
		this.setState(
			this._removedState.bind(this,slug),
			this._loadAfterRemoval.bind(this)
		);
	}

	protected _removedState(slug:string,current:AppState):AppState{
		const sources=current.sources.filter(
			this._notRemoved.bind(this,slug)
		);
		return{
			...current,sources,source:sources[0] ?? null,law:null,error:null,
			dialog:null,preferredId:"",version:current.version+1
		};
	}

	protected _notRemoved(slug:string,source:OfficeLawSummary):boolean{
		return slug !== source.slug;
	}

	protected _loadAfterRemoval():void{
		const {source}=this.state;
		if(null !== source){
			this._loadLaw(source);
		}
	}

	protected _openPatches():void{
		this.setState({dialog:"patches"});
	}

	protected _closePatches():void{
		this.setState({dialog:null});
	}

	protected _patchApplied():void{
		this._lawRequest.cancel();
		this.setState({
			dialog:null,law:null,error:null,sourcesLoaded:false
		});
		this._loadSources(true);
	}

	protected _retryLoad():void{
		this.setState({error:null});
		const {source,sourcesLoaded}=this.state;
		if(sourcesLoaded && null !== source){
			this._loadLaw(source);
		}
		else{
			this._loadSources(null !== source || sourcesLoaded);
		}
	}

	public render(){
		const {
			sources,source,law,error,sourcesLoaded,dialog:activeDialog,
			version,preferredId
		}=this.state;
		const newLawDialog=activeDialog === "new-law"
			?<NewLawDialog onClose={this._closeNewLaw.bind(this)}
				onCreated={this._lawCreated.bind(this)}/>
			:null;
		const patchDialog=activeDialog === "patches"
			?<PatchDialog onClose={this._closePatches.bind(this)}
				onApplied={this._patchApplied.bind(this)}/>
			:null;
		if(null !== error){
			return <main className="load-message" role="alert">
				<span className="eyebrow">GESETZESBIBLIOTHEK</span>
				<h1>
					{source?.title ?? "Gesetze"} konnten nicht geladen werden.
				</h1>
				<p>{error}</p>
				<button className="editor-button" type="button"
					onClick={this._retryLoad.bind(this)}>
					Erneut versuchen
				</button>
				<button className="editor-button" type="button"
					onClick={this._openPatches.bind(this)}>
					Änderungen importieren / exportieren
				</button>
				{patchDialog}
			</main>;
		}
		if(sourcesLoaded && 0 === sources.length){
			return <main className="load-message">
				<span className="eyebrow">GESETZESBIBLIOTHEK</span>
				<h1>Noch keine Gesetze vorhanden</h1>
				<button className="editor-button" type="button"
					onClick={this._openNewLaw.bind(this)}>
					Gesetz hinzufügen
				</button>
				<button className="editor-button" type="button"
					onClick={this._openPatches.bind(this)}>
					Änderungen importieren / exportieren
				</button>
				{newLawDialog}
				{patchDialog}
			</main>;
		}
		if(null === law || null === source){
			return <main className="load-message"
				aria-live="polite" aria-busy="true">
				<span className="eyebrow">GESETZESBIBLIOTHEK</span>
				<h1>Gesetzestext wird geladen …</h1>
			</main>;
		}
		return <>
			<LawExplorer key={`${source.slug}-${version}`}
				law={law} sources={sources} source={source}
				initialSelectedId={preferredId}
				onSelectLaw={this._selectLaw.bind(this)}
				onRemoveLaw={this._openRemoveLaw.bind(this)}
				onPatches={this._openPatches.bind(this)}
				onAddLaw={this._openNewLaw.bind(this)}
				onStructureSaved={this._structureSaved.bind(this)}/>
			{newLawDialog}
			{patchDialog}
			{activeDialog === "remove-law" && (
				<RemoveLawDialog source={source}
					onClose={this._closeRemoveLaw.bind(this)}
					onRemoved={this._lawRemoved.bind(this)}/>
			)}
		</>;
	}
};
