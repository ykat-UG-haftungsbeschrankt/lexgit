import App from "../src/App";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import LawSidebar from "../src/components/LawSidebar";
import { OfficeLawClient } from "../src/law/client";
import type { OfficeLawDocument } from "../src/law/types";
import type { OfficeLawSummary } from "../src/law/storage";

type State=App["state"];
type Props=Readonly<Record<string,never>>;

class AppHarness extends App{
	public setState<K extends keyof State>(
		state:Pick<State,K>|State|null
			|((previous:Readonly<State>,props:Props)=>Pick<State,K>|State|null),
		callback?:()=>void
	):void{
		const update="function" === typeof state
			?state(this.state,this.props):state;
		if(null !== update){
			this.state={...this.state,...update};
		}
		callback?.();
	}

	public select(source:OfficeLawSummary):void{
		this._selectLaw(source);
	}

	public retry():void{
		this._retryLoad();
	}

	public patchApplied():void{
		this._patchApplied();
	}
};

function source(slug:string):OfficeLawSummary{
	return{
		slug,documentNumber:slug.toUpperCase(),abbreviation:slug,
		title:slug,shortTitle:null,indexPath:`https://example.org/${slug}`
	};
}

function law(slug:string):OfficeLawDocument{
	return{
		slug,documentNumber:slug.toUpperCase(),buildDate:null,
		normDocumentNumbers:[],norms:[],introductoryNotes:[],
		metadata:{
			abbreviation:slug,officialAbbreviation:null,title:slug,
			shortTitle:null,enactmentDate:null,citations:[],statusNotes:[]
		}
	};
}

async function settle():Promise<void>{
	await Promise.resolve();
	await Promise.resolve();
}

function check(condition:boolean,message:string):void{
	if(!condition){
		throw new Error(message);
	}
}

export async function testAppSelection():Promise<string[]>{
	const originalSources=OfficeLawClient.loadLawSources;
	const originalLaw=OfficeLawClient.loadLaw;
	const sources=[source("other"),source("stvg")];
	OfficeLawClient.loadLawSources=async()=>{
		return sources;
	};
	OfficeLawClient.loadLaw=async(
		selected:OfficeLawSummary
	)=>{
		return law(selected.slug);
	};
	const app=new AppHarness({});
	try{
		app.componentDidMount();
		await settle();
		check("stvg" === app.state.source?.slug,"Default law selection");
		check("stvg" === app.state.law?.slug,"Default law loading");
		app.select(sources[0]!);
		await settle();
		app.patchApplied();
		await settle();
		check("other" === app.state.source?.slug,"Reload selection");
		check("other" === app.state.law?.slug,"Reload law loading");
		check(1 === app.state.version,"Reload remount version");
		return["initial selection","patch reload selection"];
	}
	finally{
		app.destructor();
		OfficeLawClient.loadLawSources=originalSources;
		OfficeLawClient.loadLaw=originalLaw;
	}
}

export async function testAppStaleLoads():Promise<string[]>{
	const originalSources=OfficeLawClient.loadLawSources;
	const originalLaw=OfficeLawClient.loadLaw;
	const pending=new Map<string,(document:OfficeLawDocument)=>void>();
	const signals=new Map<string,AbortSignal>();
	const sources=[source("stvg"),source("other")];
	OfficeLawClient.loadLawSources=async()=>{
		return sources;
	};
	OfficeLawClient.loadLaw=(
		selected:OfficeLawSummary,signal:AbortSignal
	)=>{
		signals.set(selected.slug,signal);
		return new Promise<OfficeLawDocument>((resolve)=>{
			pending.set(selected.slug,resolve);
		});
	};
	const app=new AppHarness({});
	try{
		app.componentDidMount();
		await settle();
		app.select(sources[1]!);
		check(true === signals.get("stvg")?.aborted,"Cancel old request");
		pending.get("other")!(law("other"));
		await settle();
		pending.get("stvg")!(law("stvg"));
		await settle();
		check("other" === app.state.law?.slug,"Ignore stale law");
		check("other" === app.state.source?.slug,"Keep selected source");
		return["cancel previous load","discard stale response"];
	}
	finally{
		app.destructor();
		OfficeLawClient.loadLawSources=originalSources;
		OfficeLawClient.loadLaw=originalLaw;
	}
}

export async function testAppRetries():Promise<string[]>{
	const originalSources=OfficeLawClient.loadLawSources;
	const originalLaw=OfficeLawClient.loadLaw;
	let sourceCalls=0;
	let lawCalls=0;
	OfficeLawClient.loadLawSources=async()=>{
		sourceCalls++;
		if(1 === sourceCalls){
			throw new Error("Source failure");
		}
		return[source("stvg")];
	};
	OfficeLawClient.loadLaw=async()=>{
		lawCalls++;
		if(1 === lawCalls){
			throw new Error("Law failure");
		}
		return law("stvg");
	};
	const app=new AppHarness({});
	try{
		app.componentDidMount();
		await settle();
		check("Source failure" === app.state.error,"Report list failure");
		app.retry();
		await settle();
		check("Law failure" === app.state.error,"Report law failure");
		app.retry();
		await settle();
		check(null === app.state.error,"Clear error on successful retry");
		check("stvg" === app.state.law?.slug,"Retry loads the law");
		check(2 === sourceCalls,"Law retry does not reload sources");
		check(2 === lawCalls,"Law request is retried");
		return["source retry","law retry"];
	}
	finally{
		app.destructor();
		OfficeLawClient.loadLawSources=originalSources;
		OfficeLawClient.loadLaw=originalLaw;
	}
}

export async function testAppRemount():Promise<string[]>{
	const originalSources=OfficeLawClient.loadLawSources;
	const pending:Array<(sources:OfficeLawSummary[])=>void>=[];
	const signals:AbortSignal[]=[];
	OfficeLawClient.loadLawSources=(signal:AbortSignal)=>{
		signals.push(signal);
		return new Promise<OfficeLawSummary[]>((resolve)=>{
			pending.push(resolve);
		});
	};
	const app=new AppHarness({});
	try{
		app.componentDidMount();
		app.componentWillUnmount();
		app.componentDidMount();
		check(true === signals[0]?.aborted,"Unmount cancels requests");
		pending[0]!([source("old")]);
		pending[1]!([]);
		await settle();
		check(0 === app.state.sources.length,"Discard old sources");
		check(app.state.sourcesLoaded,"Remount loads sources");
		check(null === app.state.source,"Empty library");
		return["StrictMode remount","empty library"];
	}
	finally{
		app.destructor();
		app.destructor();
		OfficeLawClient.loadLawSources=originalSources;
	}
}

export async function testSidebarInteractions():Promise<string[]>{
	const holder=document.createElement("div");
	document.body.appendChild(holder);
	const root=createRoot(holder);
	let unmounted=false;
	let query="needle";
	let selected=false;
	const props={
		law:law("stvg"),source:source("stvg"),
		sources:[source("stvg"),source("other")],norms:[],
		selectedId:"",query,editing:false,saving:false,historical:false,
		changedIds:[],removedIds:[],
		onSelectLaw:()=>{selected=true;},
		onSelectNorm:()=>{},
		onQuery:(value:string)=>{query=value;},
		onAddLaw:()=>{},onRemoveLaw:()=>{},onPatches:()=>{},onManage:()=>{}
	};
	try{
		await act(async()=>{
			root.render(createElement(LawSidebar,props));
		});
		const switcher=holder.querySelector<HTMLButtonElement>(
			".law-switcher"
		);
		const search=holder.querySelector<HTMLInputElement>(
			'input[type="search"]'
		);
		if(null === switcher || null === search){
			throw new Error("Sidebar controls missing");
		}
		document.dispatchEvent(new KeyboardEvent("keydown",{
			key:"k",ctrlKey:true,bubbles:true,cancelable:true
		}));
		check(search === document.activeElement,"Search shortcut focus");
		holder.querySelector<HTMLButtonElement>(".search-clear")?.click();
		check("" === query,"Search clear callback");
		check(search === document.activeElement,"Clear keeps focus");
		await act(async()=>{
			switcher.click();
		});
		check("true" === switcher.getAttribute("aria-expanded"),
			"Picker opens");
		await act(async()=>{
			document.dispatchEvent(new KeyboardEvent("keydown",{
				key:"Escape",bubbles:true,cancelable:true
			}));
		});
		check("false" === switcher.getAttribute("aria-expanded"),
			"Escape closes picker");
		check(switcher === document.activeElement,
			"Escape restores switcher focus");
		await act(async()=>{
			switcher.click();
		});
		await act(async()=>{
			document.body.dispatchEvent(new PointerEvent("pointerdown",{
				bubbles:true
			}));
		});
		check("false" === switcher.getAttribute("aria-expanded"),
			"Outside click closes picker");
		for(const locked of [
			{editing:true},{saving:true},{historical:true}
		]){
			await act(async()=>{
				root.render(createElement(LawSidebar,{...props,...locked}));
			});
			check(switcher.disabled,"Law switching is locked");
			switcher.click();
			check(null === holder.querySelector(".law-menu"),
				"Locked picker does not open");
		}
		check(!selected,"Locked switching cannot discard a draft");
		await act(async()=>{
			root.unmount();
		});
		unmounted=true;
		const fallback=document.createElement("input");
		holder.appendChild(fallback);
		fallback.focus();
		document.dispatchEvent(new KeyboardEvent("keydown",{
			key:"k",ctrlKey:true,bubbles:true,cancelable:true
		}));
		check(search !== document.activeElement,
			"Unmount removes the sidebar keyboard listener");
		return["search shortcut","clear search","picker dismissal",
			"editing/saving/history locks","listener cleanup"];
	}
	finally{
		if(!unmounted){
			await act(async()=>{
				root.unmount();
			});
		}
		holder.remove();
	}
}
