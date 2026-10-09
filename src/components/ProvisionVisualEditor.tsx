import { Component } from "react";
import type { ReactNode } from "react";
import EditorJS from "@editorjs/editorjs";
import type { OutputData } from "@editorjs/editorjs";
import type { API } from "@editorjs/editorjs";
import { XmlParagraphBlock } from "./management/XmlParagraphBlock";

interface Props{
	draft:string;
	disabled:boolean;
	onChange:(draft:string)=>void;
};

interface State{
	error:string|null;
};

export default class ProvisionVisualEditor extends Component<Props,State>{
	protected _holder:HTMLDivElement|null;
	protected _editor:EditorJS|null;
	protected _generation:number;
	protected _queue:Promise<void>;
	protected _lastDraft:string|null;

	constructor(props:Props){
		super(props);
		this._holder=null;
		this._editor=null;
		this._generation=0;
		this._queue=Promise.resolve();
		this._lastDraft=null;
		this.state={error:null};
	}

	public componentDidMount():void{
		this._initialize();
	}

	public componentDidUpdate(previous:Props):void{
		if(previous.draft !== this.props.draft
			&& this._lastDraft !== this.props.draft){
			this.destructor();
			this._initialize();
		}
		if(previous.disabled !== this.props.disabled){
			this._toggleReadOnly().catch(this._fail.bind(this));
		}
	}

	public componentWillUnmount():void{
		this.destructor();
	}

	protected _setHolder(holder:HTMLDivElement|null):void{
		this._holder=holder;
	}

	protected _initialize():void{
		if(null === this._holder){
			return;
		}
		const generation=++this._generation;
		try{
			const holder=document.createElement("div");
			this._holder.replaceChildren(holder);
			const editor=new EditorJS({
				holder,data:this._load(this.props.draft),
				readOnly:this.props.disabled,minHeight:0,
				defaultBlock:"paragraph",
				tools:{
					paragraph:{
						class:XmlParagraphBlock
					}
				},
				onChange:this._onChange.bind(this,generation)
			});
			this._editor=editor;
			this._lastDraft=this.props.draft;
			editor.isReady.then(
				this._ready.bind(this,generation),
				this._initializationFailed.bind(this,generation)
			);
		}
		catch(error){
			this._fail(error);
		}
	}

	protected _load(draft:string):OutputData{
		const parts=0 === draft.length
			?[""]:draft.split(/\n{2,}/);
		return{
			blocks:parts.map((text)=>({
				type:"paragraph",
				data:{text:this._html(text)}
			}))
		};
	}

	protected _html(text:string):string{
		const span=document.createElement("span");
		span.textContent=text;
		return span.innerHTML.replace(/\n/g,"<br>");
	}

	protected _plain(html:string):string{
		const template=document.createElement("template");
		template.innerHTML=html;
		return this._plainNodes(Array.from(template.content.childNodes));
	}

	protected _plainNodes(nodes:Node[]):string{
		let text="";
		for(const node of nodes){
			if(Node.TEXT_NODE === node.nodeType){
				text+=node.nodeValue ?? "";
				continue;
			}
			if(node instanceof Element){
				if("BR" === node.tagName.toUpperCase()){
					text+="\n";
					continue;
				}
				text+=this._plainNodes(Array.from(node.childNodes));
			}
		}
		return text;
	}

	protected _ready(generation:number):void{
		if(generation === this._generation){
			this.setState({error:null});
		}
	}

	protected _initializationFailed(
		generation:number,error:unknown
	):void{
		if(generation === this._generation){
			this._fail(error);
		}
	}

	protected _fail(error:unknown):void{
		const message=error instanceof Error ? error.message
			:"Editor.js konnte den Inhalt nicht verarbeiten.";
		this.setState({error:message});
	}

	protected _onChange(generation:number,UNUSED_api:API):void{
		if(generation !== this._generation || this.props.disabled){
			return;
		}
		this.flush().catch(this._reportSaveFailure.bind(this,generation));
	}

	protected _reportSaveFailure(generation:number,error:unknown):void{
		if(generation === this._generation){
			this._fail(error);
		}
	}

	protected async _toggleReadOnly():Promise<void>{
		const editor=this._editor;
		if(null !== editor){
			await editor.isReady;
			if(editor === this._editor){
				await editor.readOnly.toggle(this.props.disabled);
			}
		}
	}

	public async flush():Promise<string>{
		const generation=this._generation;
		const editor=this._editor;
		if(null === editor){
			throw new Error("Editor.js ist noch nicht bereit.");
		}
		const pending=this._queue.then(
			this._save.bind(this,editor,generation)
		);
		this._queue=pending.then(
			this._queueCompleted.bind(this),
			this._queueFailed.bind(this,generation)
		);
		return pending;
	}

	protected _queueCompleted():void{}

	protected _queueFailed(generation:number,error:unknown):void{
		this._reportSaveFailure(generation,error);
	}

	protected async _save(
		editor:EditorJS,generation:number
	):Promise<string>{
		await editor.isReady;
		if(generation !== this._generation){
			throw new Error("Der Editor wurde geschlossen.");
		}
		const output=await editor.save();
		if(generation !== this._generation){
			throw new Error("Der Editor wurde geschlossen.");
		}
		const values:string[]=[];
		for(const block of output.blocks){
			if("paragraph" !== block.type){
				continue;
			}
			const data=block.data;
			if("object" !== typeof data || null === data
				|| "string" !== typeof data.text){
				throw new Error("Ungültiger Editor.js-Absatz.");
			}
			values.push(this._plain(data.text).replace(/\r\n?/g,"\n"));
		}
		while(0 < values.length && 0 === values[0]!.trim().length){
			values.shift();
		}
		while(0 < values.length && 0 === values.at(-1)!.trim().length){
			values.pop();
		}
		const draft=values.join("\n\n");
		this._lastDraft=draft;
		if(draft !== this.props.draft){
			this.props.onChange(draft);
		}
		this.setState({error:null});
		return draft;
	}

	public destructor():void{
		try{
			this._generation++;
			const editor=this._editor;
			this._editor=null;
			if(null !== editor){
				editor.isReady.then(
					this._destroyEditor.bind(this,editor),
					this._destroyEditor.bind(this,editor)
				).catch(this._cleanupFailed.bind(this));
			}
		}
		catch(UNUSED_e){}
	}

	protected _destroyEditor(editor:EditorJS):void{
		try{
			editor.destroy();
		}
		catch(UNUSED_e){}
	}

	protected _cleanupFailed(UNUSED_error:unknown):void{}

	public render():ReactNode{
		return(
			<div className="law-editorjs">
				<div ref={this._setHolder.bind(this)}
					className="editorjs-content"
					aria-label="Vorschrift bearbeiten"/>
				{null !== this.state.error && (
					<p className="editor-error" role="alert">
						{this.state.error}
					</p>
				)}
			</div>
		);
	}
};
