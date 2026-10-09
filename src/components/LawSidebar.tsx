import { Component, createRef } from "react";
import type {
	ChangeEvent, KeyboardEvent as ReactKeyboardEvent, RefObject
} from "react";
import type { OfficeLawDocument, OfficeLawNorm } from "../law/types";
import type { OfficeLawSummary } from "../law/storage";

interface Props{
	law:OfficeLawDocument;
	sources:OfficeLawSummary[];
	source:OfficeLawSummary;
	norms:OfficeLawNorm[];
	selectedId:string;
	query:string;
	editing:boolean;
	saving:boolean;
	historical:boolean;
	changedIds:readonly string[];
	removedIds:readonly string[];
	onSelectLaw:(source:OfficeLawSummary)=>void;
	onSelectNorm:(id:string)=>void;
	onQuery:(query:string)=>void;
	onAddLaw:()=>void;
	onRemoveLaw:()=>void;
	onPatches:()=>void;
	onManage:()=>void;
};

interface State{
	menuOpen:boolean;
};

export default class LawSidebar extends Component<Props,State>{
	protected readonly _picker:RefObject<HTMLDivElement|null>;
	protected readonly _switcher:RefObject<HTMLButtonElement|null>;
	protected readonly _search:RefObject<HTMLInputElement|null>;
	protected readonly _onKeyDown:(event:KeyboardEvent)=>void;
	protected readonly _onPointerDown:(event:PointerEvent)=>void;
	protected readonly _searchShortcut:string;

	constructor(props:Props){
		super(props);
		this.state={menuOpen:false};
		this._picker=createRef();
		this._switcher=createRef();
		this._search=createRef();
		this._onKeyDown=this._documentKeyDown.bind(this);
		this._onPointerDown=this._documentPointerDown.bind(this);
		this._searchShortcut="undefined" !== typeof navigator
			&& /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘ K":"Ctrl K";
	}

	public componentDidMount():void{
		document.addEventListener("keydown",this._onKeyDown);
		document.addEventListener("pointerdown",this._onPointerDown);
	}

	public componentDidUpdate():void{
		if(this._locked() && this.state.menuOpen){
			this.setState({menuOpen:false});
		}
	}

	public componentWillUnmount():void{
		this.destructor();
	}

	public destructor():void{
		try{
			document.removeEventListener("keydown",this._onKeyDown);
			document.removeEventListener("pointerdown",this._onPointerDown);
		}
		catch(UNUSED_e){}
	}

	protected _locked():boolean{
		return this.props.editing || this.props.saving
			|| this.props.historical;
	}

	protected _documentKeyDown(event:KeyboardEvent):void{
		if(event.defaultPrevented || event.isComposing
			|| document.querySelector("dialog[open]")){
			return;
		}
		if((event.ctrlKey || event.metaKey) && !event.altKey
			&& "k" === event.key.toLowerCase()){
			event.preventDefault();
			this._search.current?.focus();
			this._search.current?.select();
		}
		else if("Escape" === event.key && this.state.menuOpen){
			event.preventDefault();
			this.setState({menuOpen:false},this._focusSwitcher.bind(this));
		}
	}

	protected _documentPointerDown(event:PointerEvent):void{
		if(this.state.menuOpen && event.target instanceof Node
			&& !this._picker.current?.contains(event.target)){
			this.setState({menuOpen:false});
		}
	}

	protected _focusSwitcher():void{
		this._switcher.current?.focus();
	}

	protected _toggleMenu():void{
		if(!this._locked()){
			this.setState(this._toggledState);
		}
	}

	protected _toggledState(current:State):State{
		return{menuOpen:!current.menuOpen};
	}

	protected _selectLaw(source:OfficeLawSummary):void{
		if(!this._locked()){
			this.setState({menuOpen:false});
			this.props.onSelectLaw(source);
		}
	}

	protected _queryChanged(event:ChangeEvent<HTMLInputElement>):void{
		this.props.onQuery(event.target.value);
	}

	protected _clearQuery():void{
		this.props.onQuery("");
		this._search.current?.focus();
	}

	protected _renderLawOption(item:OfficeLawSummary){
		const selected=this.props.source.documentNumber
			=== item.documentNumber;
		return <button key={item.documentNumber} type="button"
			className={selected
				?"law-option is-selected":"law-option"}
			aria-pressed={selected}
			onClick={this._selectLaw.bind(this,item)}>
			<span className="law-option-abbreviation">
				{item.abbreviation}
			</span>
			<span className="law-option-title">{item.title}</span>
		</button>;
	}

	protected _renderNorm(norm:OfficeLawNorm){
		const {selectedId,changedIds,removedIds}=this.props;
		const selected=selectedId === norm.documentNumber;
		const changed=changedIds.includes(norm.documentNumber);
		const removed=removedIds.includes(norm.documentNumber);
		const path=this.props.law.normPaths?.[norm.documentNumber];
		const directories=undefined === path ? 0:path.split("/").length-1;
		const depth=Math.max(0,directories
			-("section" === norm.kind ? 1:0));
		return <button key={norm.documentNumber} type="button"
			data-depth={depth}
			style={{marginLeft:5+depth*14}}
			className={"section" === norm.kind
				?`section-label${selected ? " is-active":""}`
				:`nav-link${selected ? " is-active":""}`}
			data-changed={changed || undefined}
			title={removed ? "In diesem Commit entfernt"
				:changed ? "In diesem Commit geändert":undefined}
			onClick={this.props.onSelectNorm.bind(null,norm.documentNumber)}
			aria-current={selected ? "page":undefined}>
			{"section" === norm.kind
				?<>
					<span>
						{norm.hierarchy?.label ?? norm.identifier ?? ""}
					</span>
					{norm.hierarchy?.title ?? norm.title}
				</>
				:<>
					<span className="nav-identifier">
						{norm.identifier ?? "Norm"}
					</span>
					<span className="nav-title">
						{norm.title ?? "Ohne Titel"}
					</span>
				</>}
			{changed && <small className="change-badge">
				{removed ? "Entfernt":"Geändert"}
			</small>}
		</button>;
	}

	protected _isProvision(norm:OfficeLawNorm):boolean{
		return "norm" === norm.kind;
	}

	public render(){
		const {law,sources,norms,query,editing}=this.props;
		const count=norms.filter(this._isProvision).length;
		const locked=this._locked();
		return <aside className="sidebar">
			<a className="brand" href="#" aria-label="Zur Startseite">
				<span className="brand-mark" aria-hidden="true">§</span>
				<span className="brand-copy">
					<strong>paragraf</strong>
					<span>RECHT IM ÜBERBLICK</span>
				</span>
			</a>
			<div className="sidebar-heading">
				<span>GESETZESBIBLIOTHEK</span>
				<span className="live-dot" aria-hidden="true"/>
			</div>
			<div className="law-picker" ref={this._picker}>
				<button className="law-switcher" type="button"
					ref={this._switcher} disabled={locked}
					aria-label={`Aktuelles Gesetz: ${law.metadata.title}`}
					aria-expanded={this.state.menuOpen}
					aria-controls="law-selection"
					onClick={this._toggleMenu.bind(this)}>
					<span className="law-monogram" aria-hidden="true">
						{law.metadata.abbreviation?.slice(0,2) ?? "§"}
					</span>
					<span className="law-switcher-copy">
						<strong>
							{law.metadata.abbreviation ?? "Gesetz"}
						</strong>
						<span>{law.metadata.title}</span>
					</span>
					<span className="switcher-chevron" aria-hidden="true">
						⌄
					</span>
				</button>
				{this.state.menuOpen && <div className="law-menu"
					id="law-selection" role="group"
					aria-label="Gesetz auswählen">
					{sources.map(this._renderLawOption.bind(this))}
				</div>}
			</div>
			<div className="library-management">
				<button className="editor-button" type="button"
					disabled={locked} onClick={this.props.onAddLaw}>
					Gesetz hinzufügen
				</button>
				<button className="editor-button" type="button"
					disabled={locked} onClick={this.props.onManage}>
					Inhaltsverzeichnis verwalten
				</button>
				<button className="editor-button" type="button"
					disabled={locked} onClick={this.props.onRemoveLaw}>
					Gesetz entfernen
				</button>
				<button className="editor-button" type="button"
					disabled={locked} onClick={this.props.onPatches}>
					Änderungen importieren / exportieren
				</button>
				{editing && <span>
					Textbearbeitung zuerst speichern oder abbrechen.
				</span>}
			</div>
			<div className="search-box">
				<svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
					<circle cx="8.5" cy="8.5" r="5.75"/>
					<path d="m13 13 4 4"/>
				</svg>
				<input type="search" value={query} ref={this._search}
					onChange={this._queryChanged.bind(this)}
					placeholder="Paragraph suchen"
					aria-label="Paragraphen durchsuchen"
					aria-keyshortcuts="Control+k Meta+k"/>
				{query
					?<button type="button" className="search-clear"
						aria-label="Suche löschen"
						onClick={this._clearQuery.bind(this)}>×</button>
					:<kbd aria-hidden="true">{this._searchShortcut}</kbd>}
			</div>
			<div className="nav-caption">
				<span>INHALT</span>
				<span aria-live="polite" aria-atomic="true">
					{count} Vorschriften
				</span>
			</div>
			<nav className="law-nav" aria-label="Gesetzesinhalt">
				{norms.map(this._renderNorm.bind(this))}
				{0 === count && <p className="empty-search">
					Keine Vorschriften gefunden.
				</p>}
			</nav>
			<div className="sidebar-footer">
				<span className="status-indicator" aria-hidden="true"/>
				<span>Gesetzesstand</span>
				<strong>{law.buildDate ?? "Aktuell"}</strong>
			</div>
		</aside>;
	}
};
