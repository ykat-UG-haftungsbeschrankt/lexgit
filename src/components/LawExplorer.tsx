import { Component } from "react";
import type { OfficeLawDocument, OfficeLawNorm } from "../law/types";
import type { OfficeLawSummary } from "../law/storage";
import { OfficeLawClient } from "../law/client";
import { OfficeLawSearch } from "../law/search";
import { OfficeLawHistoryParser } from "../law/history";
import RepositorySidebar from "./history/RepositorySidebar";
import type { RepositoryLawSnapshot } from "../law/history";
import type { RepositoryComparisonMode } from "../law/history";
import { CitationProvider } from "./citations/CitationProvider";
import { StructureDialog } from "./management/StructureDialog";
import LawSidebar from "./LawSidebar";
import LawViewer from "./LawViewer";

interface Props{
	law:OfficeLawDocument;
	sources:OfficeLawSummary[];
	source:OfficeLawSummary;
	initialSelectedId:string;
	onSelectLaw:(source:OfficeLawSummary)=>void;
	onAddLaw:()=>void;
	onRemoveLaw:()=>void;
	onPatches:()=>void;
	onStructureSaved:(law:OfficeLawDocument,selectedId:string,indexPath:string)=>void;
}

interface State{
	comparisonMode:RepositoryComparisonMode;
	selectedId:string;
	query:string;
	showStructure:boolean;
	editMode:"source"|"visual";
	draft:string;
	savedEdits:Record<string,string>;
	editing:boolean;
	showDiff:boolean;
	saving:boolean;
	error:string|null;
	selectedVersion:string|null;
	snapshot:RepositoryLawSnapshot|null;
	versionLoading:boolean;
	versionError:string|null;
	historyVersion:number;
}

export default class LawExplorer extends Component<Props,State>{
	private mounted=false;
	private snapshotController:AbortController|null=null;
	private snapshotCache:{snapshot:RepositoryLawSnapshot;law:OfficeLawDocument}|null=null;
	private citationCache:{law:OfficeLawDocument; edits:Record<string,string>; value:OfficeLawDocument}|null=null;

	constructor(props:Props){
		super(props);
		const norm=props.law.norms.find(norm=>norm.documentNumber === props.initialSelectedId)
			?? props.law.norms.find(norm=>norm.kind === "norm" && norm.identifier?.startsWith("§"))
			?? props.law.norms.find(norm=>norm.kind === "norm");
		this.state={
			comparisonMode:"head",
			selectedId:norm?.documentNumber ?? "",query:"",showStructure:false,
			editMode:"visual",
			draft:norm?.paragraphs.join("\n\n") ?? "",savedEdits:{},
			editing:false,showDiff:false,saving:false,error:null,
			selectedVersion:null,snapshot:null,versionLoading:false,versionError:null,historyVersion:0
		};
	}

	public componentDidMount():void{ this.mounted=true; this.updateTitle(); }
	public componentDidUpdate(previous:Props):void{
		if(previous.law !== this.props.law){ this.updateTitle(); }
	}
	public componentWillUnmount():void{ this.mounted=false; this.snapshotController?.abort(); }
	private displayedLaw():OfficeLawDocument{
		if(this.state.selectedVersion === null || this.state.snapshot === null){ return this.props.law; }
		const snapshot=this.state.snapshot;
		if(this.snapshotCache?.snapshot === snapshot){ return this.snapshotCache.law; }
		const law=snapshot.document ?? {...this.props.law,norms:[],normDocumentNumbers:[]};
		const norms=[...law.norms,...snapshot.removedNorms];
		const value={...law,norms,normDocumentNumbers:norms.map(norm=>norm.documentNumber)};
		this.snapshotCache={snapshot,law:value};
		return value;
	}
	private selectVersion=(hash:string|null):void=>{
		if(this.state.editing || this.state.saving){ return; }
		this.snapshotController?.abort();
		if(hash === null){
			this.setState({selectedVersion:null,snapshot:null,versionLoading:false,versionError:null},()=>{
				const norm=this.props.law.norms.find(item=>item.documentNumber === this.state.selectedId)
					?? this.props.law.norms.find(item=>item.kind === "norm" && item.identifier?.startsWith("§"))
					?? this.props.law.norms[0];
				this.selectNorm(norm?.documentNumber ?? "");
			});
			return;
		}
		const controller=new AbortController();
		this.snapshotController=controller;
		this.setState({versionLoading:true,versionError:null});
		OfficeLawClient.request(
			`/api/git/history/${hash}/laws/`
				+`${encodeURIComponent(this.props.law.slug)}?compare=`
				+this.state.comparisonMode,
			{signal:controller.signal},
			"Repository-Vergleich konnte nicht geladen werden")
			.then(OfficeLawHistoryParser.parseRepositoryLawSnapshot).then(snapshot=>{
				if(controller.signal.aborted){ return; }
				const norms=[...(snapshot.document?.norms ?? []),...snapshot.removedNorms];
				const selected=norms.find(norm=>norm.documentNumber === this.state.selectedId)
					?? norms.find(norm=>norm.kind === "norm" && norm.identifier?.startsWith("§")) ?? norms[0];
				this.setState({
					selectedVersion:hash,snapshot,versionLoading:false,
					selectedId:selected?.documentNumber ?? "",draft:selected?.paragraphs.join("\n\n") ?? "",
					editing:false,showDiff:true,error:null
				});
			},error=>{
				if(!controller.signal.aborted){
					this.setState({
						versionLoading:false,
						versionError:error instanceof Error ? error.message
							:"Repository-Vergleich konnte nicht geladen werden."
					});
				}
			});
	};
	protected _comparisonMode(
		mode:RepositoryComparisonMode,initialHash:utf8_t|null
	):void{
		this.setState(
			{comparisonMode:mode},
			this._reloadComparison.bind(this,initialHash)
		);
	}

	protected _reloadComparison(initialHash:utf8_t|null):void{
		const hash=this.state.selectedVersion ?? initialHash;
		if(null !== hash){
			this.selectVersion(hash);
		}
	}

	private updateTitle():void{
		const metadata=this.props.law.metadata;
		document.title=`${metadata.abbreviation ?? "Gesetz"} — ${metadata.title ?? metadata.abbreviation ?? "Gesetz"}`;
	}
	private selectedNorm():OfficeLawNorm|undefined{
		return this.displayedLaw().norms.find(norm=>norm.documentNumber === this.state.selectedId);
	}
	private originalText():string{ return this.selectedNorm()?.paragraphs.join("\n\n") ?? ""; }
	private savedText():string{ return this.state.selectedVersion !== null ? this.originalText()
		:this.state.savedEdits[this.state.selectedId] ?? this.originalText(); }
	private selectNorm=(selectedId:string):void=>{
		const norm=this.displayedLaw().norms.find(norm=>norm.documentNumber === selectedId);
		this.setState({
			selectedId,draft:(this.state.selectedVersion === null ? this.state.savedEdits[selectedId] : undefined) ?? norm?.paragraphs.join("\n\n") ?? "",
			editing:false,showDiff:this.state.selectedVersion !== null,error:null
		});
	};
	private cancel=():void=>{
		this.setState({draft:this.savedText(),editing:false,showDiff:false});
	};
	private save=():Promise<void>=>this.persist(false);
	private reset=():Promise<void>=>this.persist(true);
	private async persist(reset:boolean):Promise<void>{
		if(this.state.selectedVersion !== null){ throw new Error("Historical versions are read-only."); }
		const norm=this.selectedNorm();
		if(norm === undefined){ throw new Error("Select a provision before saving an edit."); }
		const id=norm.documentNumber;
		const text=reset ? norm.paragraphs.join("\n\n") : this.state.draft;
		this.setState({saving:true,error:null});
		try{
			await OfficeLawClient.saveProvision(this.props.law.slug,id,text);
			if(!this.mounted){ return; }
			this.setState(current=>{
				const savedEdits={...current.savedEdits};
				if(reset){ delete savedEdits[id]; } else{ savedEdits[id]=text; }
				return current.selectedId === id
					?{savedEdits,draft:text,editing:false,showDiff:false,saving:false,error:null}
					:{savedEdits,draft:current.draft,editing:current.editing,showDiff:current.showDiff,saving:false,error:current.error};
			});
		}
		catch(error){
			if(this.mounted){
				this.setState({saving:false,error:error instanceof Error ? error.message
					:reset ? "Originalfassung konnte nicht wiederhergestellt werden." : "Änderung konnte nicht gespeichert werden."});
			}
		}
	}
	private citationLaw():OfficeLawDocument{
		if(this.state.selectedVersion !== null){ return this.state.snapshot?.document
			?? {...this.displayedLaw(),norms:[],normDocumentNumbers:[]}; }
		const {law}=this.props;
		const {savedEdits}=this.state;
		if(this.citationCache?.law === law && this.citationCache.edits === savedEdits){
			return this.citationCache.value;
		}
		const value={...law,norms:law.norms.map(norm=>{
			const text=savedEdits[norm.documentNumber];
			return text === undefined ? norm : {...norm,paragraphs:text.length === 0 ? [] : text.split(/\n{2,}/)};
		})};
		this.citationCache={law,edits:savedEdits,value};
		return value;
	}
	private visibleNorms():OfficeLawNorm[]{
		const query=this.state.query.trim().toLocaleLowerCase("de");
		if(query.length === 0){ return this.displayedLaw().norms; }
		const law=this.displayedLaw();
		if(undefined !== law.normPaths){
			const included=new Set<utf8_t>();
			for(const norm of law.norms){
				if("norm" !== norm.kind
					|| !OfficeLawSearch.matchesQuery(norm,query)){
					continue;
				}
				included.add(norm.documentNumber);
				const path=law.normPaths[norm.documentNumber];
				if(undefined === path){
					continue;
				}
				for(const section of law.norms){
					const sectionPath=law.normPaths[section.documentNumber];
					if("section" === section.kind
						&& undefined !== sectionPath
						&& path.startsWith(sectionPath.slice(
							0,sectionPath.lastIndexOf("/")+1
						))){
						included.add(section.documentNumber);
					}
				}
			}
			return law.norms.filter((norm)=>{
				return included.has(norm.documentNumber);
			});
		}
		const result:OfficeLawNorm[]=[];
		let sections:OfficeLawNorm[]=[];
		for(const norm of this.displayedLaw().norms){
			if(norm.kind === "section"){ sections.push(norm); continue; }
			if(OfficeLawSearch.matchesQuery(norm,query)){ result.push(...sections,norm); }
			sections=[];
		}
		return result;
	}
	protected _openXml():void{
		this.setState({editing:true,showDiff:false,editMode:"source"});
	}

	protected _xmlSaved():void{
		this.setState({editing:false,showDiff:false});
		this._reloadAfterXml().catch(this._xmlReloadFailed.bind(this));
	}

	protected async _reloadAfterXml():Promise<void>{
		const controller=new AbortController();
		this.snapshotController?.abort();
		this.snapshotController=controller;
		const law=await OfficeLawClient.loadLaw(
			this.props.source,controller.signal
		);
		if(this.mounted && !controller.signal.aborted){
			this.props.onStructureSaved(
				law,this.state.selectedId,this.props.source.indexPath
			);
		}
	}

	protected _xmlReloadFailed(error:unknown):void{
		if(this.mounted){
			this.setState({
				error:error instanceof Error ? error.message
					:"Gesetz konnte nicht neu geladen werden."
			});
		}
	}

	public render(){
		const {law,sources,source,onSelectLaw,onAddLaw,onStructureSaved}=this.props;
		const state=this.state;
		const displayedLaw=this.displayedLaw();
		const historical=state.selectedVersion !== null;
		const previousNorm=state.snapshot?.previousNorms.find(norm=>norm.documentNumber === state.selectedId);
		const removed=state.snapshot?.removedNorms.some(norm=>norm.documentNumber === state.selectedId) ?? false;
		return <main className="app-shell">
			<LawSidebar law={displayedLaw} sources={sources} source={source} norms={this.visibleNorms()}
				historical={state.selectedVersion !== null || state.versionLoading}
				changedIds={state.snapshot?.changedIds ?? []}
				removedIds={state.snapshot?.removedNorms.map(norm=>norm.documentNumber) ?? []}
				selectedId={state.selectedId} query={state.query} editing={state.editing} saving={state.saving}
				onSelectLaw={onSelectLaw} onSelectNorm={this.selectNorm} onQuery={query=>this.setState({query})}
				onRemoveLaw={this.props.onRemoveLaw}
				onPatches={this.props.onPatches}
				onAddLaw={onAddLaw} onManage={()=>this.setState({showStructure:true})}/>
			<CitationProvider law={this.citationLaw()} sources={sources}
				version={state.snapshot?.comparisonVersion
					?? state.selectedVersion}>
				<LawViewer law={displayedLaw} source={source} norm={this.selectedNorm()}
					historyVersion={state.historyVersion}
					previousNorm={previousNorm}
					comparisonMode={state.comparisonMode}
					comparisonVersion={state.snapshot?.comparisonVersion
						?? state.selectedVersion}
					selectedVersion={state.selectedVersion} versionLoading={state.versionLoading}
					versionError={state.versionError} onSelectVersion={this.selectVersion}
					lawAbsent={state.selectedVersion !== null && state.snapshot?.document === null}
					removed={removed}
					editor={{
					slug:law.slug,documentNumber:state.selectedId,
					editMode:state.editMode,
					onXmlSaved:this._xmlSaved.bind(this),
					readOnly:state.selectedVersion !== null || state.versionLoading,
					original:historical ? previousNorm?.paragraphs.join("\n\n") ?? "" : this.originalText(),
					diffText:historical && removed ? "" : state.draft,
					hasOtherChanges:historical && (state.snapshot?.changedIds.includes(state.selectedId) ?? false),
					saved:this.savedText(),draft:state.draft,
					editing:state.editing,showDiff:state.showDiff,saving:state.saving,error:state.error,
					onDraft:draft=>this.setState({draft}),
					onEdit:()=>this.setState({
						editing:true,showDiff:false,editMode:"visual"
					}),
					onToggleDiff:()=>this.setState(current=>({showDiff:!current.showDiff})),
					onHideDiff:()=>this.setState({showDiff:false}),
					onSave:this.save,onCancel:this.cancel,onReset:this.reset,
					onEditXml:this._openXml.bind(this)
				}}/>
			</CitationProvider>
			<RepositorySidebar selectedVersion={state.selectedVersion}
				comparisonMode={state.comparisonMode}
				onComparisonMode={this._comparisonMode.bind(this)}
				onCommitted={()=>this.setState(state=>({historyVersion:state.historyVersion+1}))}
				onSelectVersion={this.selectVersion} disabled={state.editing || state.saving}/>
			{state.showStructure && <StructureDialog law={law} onClose={()=>this.setState({showStructure:false})} onSaved={onStructureSaved}/>}
		</main>;
	}
}
