import type { BlockToolConstructorOptions } from "@editorjs/editorjs";
import type { SanitizerConfig } from "@editorjs/editorjs";
import type { BlockAPI } from "@editorjs/editorjs";
import type { XmlLegalData, XmlLegalLayout } from "./legal-xml-types";

interface Entry{
	list:XmlLegalLayout;
	dt:XmlLegalLayout;
	dd:XmlLegalLayout;
	parent:Entry|undefined;
};

export class LegalXmlBlock{
	protected readonly _data:XmlLegalData;
	protected readonly _readOnly:boolean;
	protected readonly _fields:Map<number,HTMLElement>;
	protected readonly _block:BlockAPI;
	protected _root:HTMLElement|null;
	protected _activeRow:HTMLElement|null;
	protected readonly _onOutsidePointer:(event:Event)=>void;

	constructor(options:BlockToolConstructorOptions<XmlLegalData>){
		this._data=undefined === options.data.layout
			? LegalXmlBlock.createData():structuredClone(options.data);
		this._readOnly=options.readOnly;
		this._fields=new Map();
		this._block=options.block;
		this._root=null;
		this._activeRow=null;
		this._onOutsidePointer=this._outsidePointer.bind(this);
	}

	// Editor.js requires static getters for tool capabilities.
	public static get isReadOnlySupported():boolean{
		return true;
	}

	public static get enableLineBreaks():boolean{
		return true;
	}

	public static get toolbox(){
		return{
			title:"Juristische Aufzählung",
			icon:'<svg width="18" height="18" viewBox="0 0 18 18">'
				+'<path d="M2 4h3M2 9h3M2 14h3M8 4h8M8 9h8M8 14h8" '
				+'fill="none" stroke="currentColor" stroke-width="2"/></svg>'
		};
	}

	public static createData():XmlLegalData{
		return{
			id:"",texts:["",""],
			layout:{tag:"P",children:[{
				tag:"DL",children:[
					{tag:"DT",children:[{tag:"text",field:0,children:[]}]},
					{tag:"DD",children:[{
						tag:"LA",children:[{tag:"text",field:1,children:[]}]
					}]}
				]
			}]}
		};
	}

	public static get sanitize():SanitizerConfig
		|Record<string,SanitizerConfig>{
		return{
			id:false,layout:false,
			texts:{b:true,strong:true,i:true,em:true,br:true}
		};
	}

	public render():HTMLElement{
		this._fields.clear();
		const root=this._renderLayout(this._data.layout);
		root.classList.add("xml-legal-block");
		this._root=root;
		if(!this._readOnly){
			document.addEventListener("pointerdown",this._onOutsidePointer);
			document.addEventListener("focusin",this._onOutsidePointer);
		}
		return root;
	}

	protected _renderLayout(
		layout:XmlLegalLayout,owner?:Entry
	):HTMLElement{
		const element=document.createElement(
			"text" === layout.tag ? "span":layout.tag.toLowerCase()
		);
		if("text" === layout.tag && undefined !== layout.field){
			const index=layout.field;
			element.className="xml-legal-text";
			element.contentEditable=this._readOnly ? "false":"true";
			element.setAttribute("role","textbox");
			element.setAttribute("aria-label","Aufzählungstext");
			element.dataset.placeholder="Text";
			const template=document.createElement("template");
			const text=this._data.texts[index];
			if(undefined === text){
				throw new Error("XML-Aufzählungstext fehlt.");
			}
			template.innerHTML=text;
			element.appendChild(template.content);
			this._fields.set(index,element);
			if(undefined !== owner && !this._readOnly){
				element.addEventListener(
					"keydown",this._onKey.bind(this,owner)
				);
			}
		}
		else{
			element.className=`xml-legal-${layout.tag.toLowerCase()}`;
			if("DL" === layout.tag){
				this._renderEntries(layout,element,owner);
			}
			else{
				for(const child of layout.children){
					element.appendChild(this._renderLayout(child,owner));
				}
			}
		}
		return element;
	}

	protected _renderEntries(
		list:XmlLegalLayout,element:HTMLElement,parent?:Entry
	):void{
		for(let index=0;index<list.children.length;index+=2){
			const dt=list.children[index];
			const dd=list.children[index+1];
			if(undefined === dt || undefined === dd
				|| "DT" !== dt.tag || "DD" !== dd.tag){
				throw new Error("Aufzählung benötigt DT/DD-Paare.");
			}
			const entry:Entry={list,dt,dd,parent};
			const row=document.createElement("div");
			row.className="xml-legal-entry";
			row.appendChild(this._renderLayout(dt,entry));
			row.appendChild(this._renderLayout(dd,entry));
			if(!this._readOnly){
				row.addEventListener("focusin",this._selectRow.bind(this,row));
				row.addEventListener(
					"pointerdown",this._selectRow.bind(this,row)
				);
				const controls=document.createElement("div");
				controls.className="xml-legal-controls";
				controls.setAttribute("role","toolbar");
				controls.setAttribute("aria-label","Aufzählungseintrag");
				controls.addEventListener("keydown",this._toolbarKey.bind(this));
				for(const [action,label] of [
					["up","Nach oben"],["down","Nach unten"],
					["indent","Einrücken (Tab)"],
					["outdent","Ausrücken (Umschalt+Tab)"],
					["before","Davor einfügen"],
					["delete","Eintrag löschen"]
				]){
					const button=document.createElement("button");
					button.type="button";
					button.title=label ?? "";
					button.setAttribute("aria-label",label ?? "");
					button.dataset.action=action;
					button.appendChild(this._actionIcon(action ?? ""));
					button.disabled=!this._canAct(entry,action ?? "");
					button.addEventListener(
						"click",this._toolbarAction.bind(
							this,entry,action ?? ""
						)
					);
					controls.appendChild(button);
				}
				row.appendChild(controls);
			}
			element.appendChild(row);
		}
		if(!this._readOnly){
			const button=document.createElement("button");
			button.type="button";
			button.textContent="Neuer Eintrag";
			button.addEventListener(
				"click",this._appendEntry.bind(this,list)
			);
			element.appendChild(button);
		}
	}

	protected _actionIcon(action:string):SVGElement{
		const paths:Record<string,string>={
			up:"M5 11l4-4 4 4M9 7v8",
			down:"M5 9l4 4 4-4M9 3v10",
			indent:"M3 4h12M9 9h6M9 14h6M2 7l3 3-3 3",
			outdent:"M3 4h12M9 9h6M9 14h6M5 7l-3 3 3 3",
			before:"M3 13h12M9 2v7M5 5.5h8",
			delete:"M3 5h12M7 5V3h4v2M5 5l1 11h6l1-11M8 8v5M10 8v5"
		};
		const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
		svg.setAttribute("viewBox","0 0 18 18");
		svg.setAttribute("width","18");
		svg.setAttribute("height","18");
		svg.setAttribute("aria-hidden","true");
		const path=document.createElementNS(
			"http://www.w3.org/2000/svg","path"
		);
		path.setAttribute("d",paths[action] ?? "");
		path.setAttribute("fill","none");
		path.setAttribute("stroke","currentColor");
		path.setAttribute("stroke-width","1.6");
		path.setAttribute("stroke-linecap","round");
		path.setAttribute("stroke-linejoin","round");
		svg.appendChild(path);
		return svg;
	}

	protected _selectRow(row:HTMLElement,event:Event):void{
		if(!(event.target instanceof Element)
			|| event.target.closest(".xml-legal-entry") !== row){
			return;
		}
		this._activeRow?.classList.remove("xml-legal-entry-active");
		this._activeRow=row;
		row.classList.add("xml-legal-entry-active");
	}

	protected _outsidePointer(event:Event):void{
		if(event.target instanceof Node
			&& !this._activeRow?.contains(event.target)){
			this._hideToolbar();
		}
	}

	protected _hideToolbar():void{
		this._activeRow?.classList.remove("xml-legal-entry-active");
		this._activeRow=null;
	}

	protected _toolbarKey(event:KeyboardEvent):void{
		if("Escape" === event.key){
			event.preventDefault();
			event.stopPropagation();
			this._activeRow?.querySelector<HTMLElement>(
				":scope > .xml-legal-dt .xml-legal-text"
			)?.focus();
			this._hideToolbar();
		}
	}

	protected _toolbarAction(
		entry:Entry,action:string,event:MouseEvent
	):void{
		event.stopPropagation();
		this._act(entry,action);
	}

	protected _canAct(entry:Entry,action:string):boolean{
		const index=entry.list.children.indexOf(entry.dt);
		if("up" === action || "indent" === action){
			return index>0;
		}
		if("down" === action){
			return index+2<entry.list.children.length;
		}
		if("outdent" === action){
			return undefined !== entry.parent;
		}
		return "delete" === action || "before" === action;
	}

	protected _onKey(entry:Entry,event:Event):void{
		if(!(event instanceof KeyboardEvent)
			|| "Tab" !== event.key || event.ctrlKey || event.altKey
			|| event.metaKey){
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this._act(entry,event.shiftKey ? "outdent":"indent");
	}

	protected _act(entry:Entry,action:string):void{
		if(!this._canAct(entry,action)){
			return;
		}
		this._data.texts=this.save().texts;
		const list=entry.list;
		const index=list.children.indexOf(entry.dt);
		let focus=entry.dt.children[0]?.field;
		if("before" === action){
			const pair=this._createEntry();
			list.children.splice(index,0,...pair);
			focus=pair[0].children[0]?.field;
		}
		else if("up" === action || "down" === action){
			list.children.splice(index,2);
			const target="up" === action ? index-2:index+2;
			list.children.splice(target,0,entry.dt,entry.dd);
		}
		else if("indent" === action){
			const previous=list.children[index-1];
			if(undefined === previous){
				throw new Error("Vorheriger Aufzählungseintrag fehlt.");
			}
			const container=this._nestedContainer(previous);
			let nested=container.children[container.children.length-1];
			if(undefined === nested || "DL" !== nested.tag){
				nested={tag:"DL",children:[]};
				if(undefined !== list.path){
					nested.path=[...list.path];
				}
				container.children.push(nested);
			}
			list.children.splice(index,2);
			nested.children.push(entry.dt,entry.dd);
		}
		else if("outdent" === action && undefined !== entry.parent){
			const parent=entry.parent;
			// Following siblings stay beneath the entry being lifted.
			const trailing=list.children.splice(index+2);
			if(trailing.length>0){
				const nested:XmlLegalLayout={tag:"DL",children:trailing};
				if(undefined !== list.path){
					nested.path=[...list.path];
				}
				this._nestedContainer(entry.dd).children.push(nested);
			}
			list.children.splice(index,2);
			const target=parent.list.children.indexOf(parent.dt)+2;
			parent.list.children.splice(target,0,entry.dt,entry.dd);
		}
		else if("delete" === action){
			list.children.splice(index,2);
		}
		this._removeEmptyLists(this._data.layout);
		this._refresh(focus);
	}

	protected _createEntry():[XmlLegalLayout,XmlLegalLayout]{
		const label=this._data.texts.length;
		this._data.texts.push("","");
		return[
			{tag:"DT",children:[{tag:"text",field:label,children:[]}]},
			{tag:"DD",children:[{
				tag:"LA",children:[{tag:"text",field:label+1,children:[]}]
			}]}
		];
	}

	protected _appendEntry(list:XmlLegalLayout):void{
		this._data.texts=this.save().texts;
		const pair=this._createEntry();
		list.children.push(...pair);
		this._refresh(pair[0].children[0]?.field);
	}

	protected _refresh(focus:number|undefined):void{
		const root=this._root;
		if(null !== root){
			this._hideToolbar();
			this._fields.clear();
			const replacement=this._renderLayout(this._data.layout);
			root.replaceChildren(...Array.from(replacement.childNodes));
			if(undefined !== focus){
				this._fields.get(focus)?.focus();
			}
			this._block.dispatchChange();
		}
	}

	protected _nestedContainer(dd:XmlLegalLayout):XmlLegalLayout{
		for(let index=dd.children.length-1;0 <= index;index--){
			const child=dd.children[index];
			if("LA" === child?.tag){
				return child;
			}
		}
		return dd;
	}

	protected _removeEmptyLists(layout:XmlLegalLayout):void{
		for(const child of layout.children){
			this._removeEmptyLists(child);
		}
		// Keep top-level lists so deleting all entries is reversible.
		if("LA" === layout.tag || "DD" === layout.tag){
			layout.children=layout.children.filter(
				this._keepChild.bind(this)
			);
		}
	}

	protected _keepChild(child:XmlLegalLayout):boolean{
		return "DL" !== child.tag || child.children.length>0;
	}

	public save():XmlLegalData{
		const data=structuredClone(this._data);
		for(const [index,element] of this._fields){
			const copy=element.cloneNode(true);
			if(!(copy instanceof HTMLElement)){
				throw new Error("XML-Aufzählungstext fehlt.");
			}
			for(const line of Array.from(copy.querySelectorAll("div,p"))){
				if(null !== line.previousSibling){
					line.before(document.createElement("br"));
				}
				line.replaceWith(...Array.from(line.childNodes));
			}
			data.texts[index]=copy.innerHTML;
		}
		return data;
	}

	public destroy():void{
		this.destructor();
	}

	public destructor():void{
		try{
			this._fields.clear();
			this._root=null;
			this._hideToolbar();
			document.removeEventListener("pointerdown",this._onOutsidePointer);
			document.removeEventListener("focusin",this._onOutsidePointer);
		}
		catch(UNUSED_e){}
	}
};
