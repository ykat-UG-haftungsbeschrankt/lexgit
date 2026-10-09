import type { JSONContent } from "@tiptap/core";
import type { OutputData, OutputBlockData } from "@editorjs/editorjs";
import type { XmlLegalLayout } from "../editorjs/legal-xml-types";
import { LEGAL_NAMES } from "../tiptap/legal-xml";
import { OfficeLawRichContent } from "./rich-content";

interface XmlListItem{
	content:utf8_t;
	items:XmlListItem[];
	meta?:{nestedLists?:XmlNestedList[]};
};

interface XmlNestedList{
	style:utf8_t;
	items:XmlListItem[];
};

export class OfficeLawTiptapXml{
	protected readonly _codec:OfficeLawRichContent;
	protected _output:OutputData;
	protected _initial:JSONContent;
	protected readonly _nodes:Map<utf8_t,JSONContent>;

	constructor(source:utf8_t){
		this._codec=new OfficeLawRichContent(source);
		this._output={blocks:[]};
		this._initial={type:"doc"};
		this._nodes=new Map();
	}

	public destructor():void{
		try{
			this._codec.destructor();
			this._nodes.clear();
		}
		catch(UNUSED_e){}
	}

	public load():JSONContent{
		this._output=this._codec.load();
		this._nodes.clear();
		const content=this._output.blocks.map(this._loadBlock.bind(this));
		this._initial={type:"doc",content};
		return this._initial;
	}

	public acceptInitial(document:JSONContent):void{
		this._initial=structuredClone(document);
		this._nodes.clear();
		for(const node of document.content ?? []){
			const id=node.attrs?.xmlId;
			if(null !== id && undefined !== id){
				this._nodes.set(id,structuredClone(node));
			}
		}
	}

	protected _loadBlock(block:OutputBlockData):JSONContent{
		let node:JSONContent;
		if("paragraph" === block.type){
			node={
				type:"paragraph",content:this._inline(block.data.text)
			};
		}
		else if("legalXml" === block.type){
			node=this._legal(block.data.layout,block.data.texts);
		}
		else if("list" === block.type){
			node=this._list(block.data.items,block.data.style);
		}
		else{
			node={
				type:"protectedXml",attrs:{label:block.data.label}
			};
		}
		node.attrs={...node.attrs,xmlId:block.id};
		if(undefined !== block.id){
			this._nodes.set(block.id,structuredClone(node));
		}
		return node;
	}

	protected _inline(html:utf8_t):JSONContent[]{
		const template=document.createElement("template");
		template.innerHTML=html;
		return this._inlineNodes(template.content,[]);
	}

	protected _inlineNodes(
		parent:Node,marks:{type:utf8_t}[]
	):JSONContent[]{
		const result:JSONContent[]=[];
		for(const node of Array.from(parent.childNodes)){
			if(Node.TEXT_NODE === node.nodeType){
				if(node.nodeValue){
					result.push({
						type:"text",text:node.nodeValue,
						...(0 < marks.length ? {marks}: {})
					});
				}
			}
			else if(node instanceof Element){
				if("BR" === node.tagName){
					result.push({type:"hardBreak"});
				}
				else{
					const type=["B","STRONG"].includes(node.tagName)
						?"bold":"italic";
					result.push(...this._inlineNodes(
						node,[...marks,{type}]
					));
				}
			}
		}
		return result;
	}

	protected _legal(
		layout:XmlLegalLayout,texts:utf8_t[]
	):JSONContent{
		const attrs:Record<utf8_t,unknown>={};
		if(undefined !== layout.path){
			attrs.path=layout.path;
		}
		if("text" === layout.tag){
			attrs.field=layout.field;
			return{
				type:"legalText",attrs,
				content:this._inline(texts[layout.field ?? 0] ?? "")
			};
		}
		const content:JSONContent[]=[];
		if("DL" === layout.tag){
			for(let index=0;index<layout.children.length;index+=2){
				const term=layout.children[index];
				const definition=layout.children[index+1];
				if(undefined === term || undefined === definition){
					throw new Error("DT/DD-Paar fehlt.");
				}
				content.push({
					type:"legalEntry",content:[
						this._legal(term,texts),
						this._legal(definition,texts)
					]
				});
			}
		}
		else{
			for(const child of layout.children){
				content.push(this._legal(child,texts));
			}
		}
		const type=LEGAL_NAMES[layout.tag];
		if(undefined === type){
			throw new Error("Unbekanntes XML-Element.");
		}
		return{type,attrs,content};
	}

	protected _list(
		items:XmlListItem[],style:utf8_t
	):JSONContent{
		return{
			type:"ordered" === style ? "orderedList":"bulletList",
			content:items.map(this._listItem.bind(this,style))
		};
	}

	protected _listItem(style:utf8_t,item:XmlListItem):JSONContent{
		const content:JSONContent[]=[{
			type:"paragraph",content:this._inline(item.content)
		}];
		if(0 < item.items.length){
			content.push(this._list(item.items,style));
		}
		for(const nested of item.meta?.nestedLists ?? []){
			content.push(this._list(nested.items,nested.style));
		}
		return{type:"listItem",content};
	}

	protected _html(node:JSONContent):utf8_t{
		let result="";
		for(const child of node.content ?? []){
			if("hardBreak" === child.type){
				result+="<br>";
				continue;
			}
			if("text" !== child.type){
				throw new Error("Nicht unterstützter Inline-Inhalt.");
			}
			const span=document.createElement("span");
			span.textContent=child.text ?? "";
			let text=span.innerHTML;
			for(const mark of child.marks ?? []){
				if(!["bold","italic"].includes(mark.type)){
					throw new Error("Nicht unterstützte Textformatierung.");
				}
				const tag="bold" === mark.type ? "b":"i";
				text=`<${tag}>${text}</${tag}>`;
			}
			result+=text;
		}
		return result;
	}

	protected _layout(
		node:JSONContent,texts:utf8_t[]
	):XmlLegalLayout{
		const tag=Object.keys(LEGAL_NAMES).find(
			this._matchesType.bind(this,node.type)
		);
		if(undefined === tag){
			throw new Error("Unbekanntes juristisches Element.");
		}
		const layout:XmlLegalLayout={tag,children:[]};
		if(null !== node.attrs?.path && undefined !== node.attrs?.path){
			layout.path=node.attrs.path;
		}
		if("text" === tag){
			const field=node.attrs?.field;
			const index:size_t=null === field || undefined === field
				?texts.length:field;
			layout.field=index;
			texts[index]=this._html(node);
		}
		else{
			for(const child of node.content ?? []){
				if("legalEntry" === child.type){
					for(const part of child.content ?? []){
						layout.children.push(this._layout(part,texts));
					}
				}
				else{
					layout.children.push(this._layout(child,texts));
				}
			}
		}
		return layout;
	}

	protected _listItems(node:JSONContent):unknown[]{
		return(node.content ?? []).map(
			this._saveListItem.bind(this,node.type)
		);
	}

	protected _matchesType(type:utf8_t|undefined,key:utf8_t):bool_t{
		return LEGAL_NAMES[key] === type;
	}

	protected _saveListItem(
		type:utf8_t|undefined,item:JSONContent
	):unknown{
		let content="";
		const nestedLists:{style:utf8_t;items:unknown[]}[]=[];
		for(const child of item.content ?? []){
			if("paragraph" === child.type){
				if("" !== content){
					content+="<br>";
				}
				content+=this._html(child);
			}
			else if(["bulletList","orderedList"].includes(
				child.type ?? ""
			)){
				nestedLists.push({
					style:"orderedList" === child.type
						?"ordered":"unordered",
					items:this._listItems(child)
				});
			}
			else{
				throw new Error(
					"Nicht unterstützte Listenelemente im XML bearbeiten."
				);
			}
		}
		const style="orderedList" === type ? "ordered":"unordered";
		if(1 === nestedLists.length && style === nestedLists[0]?.style){
			return{
				content,meta:{},items:nestedLists[0]?.items ?? []
			};
		}
		return{
			content,meta:0 === nestedLists.length ? {}:{nestedLists},
			items:[]
		};
	}

	protected _saveBlock(node:JSONContent):OutputBlockData{
		const id=node.attrs?.xmlId ?? undefined;
		const original=this._output.blocks.find(
			this._matchesId.bind(this,id)
		);
		if(undefined !== original
			&& this._same(node,this._nodes.get(id))){
			return structuredClone(original);
		}
		if("protectedXml" === node.type){
			throw new Error("Geschützter XML-Block wurde verändert.");
		}
		if("paragraph" === node.type){
			return{id,type:"paragraph",data:{text:this._html(node)}};
		}
		if(["bulletList","orderedList"].includes(node.type ?? "")){
			const ordered="orderedList" === node.type;
			return{
				id,type:"list",data:{
					style:ordered ? "ordered":"unordered",
					meta:ordered ? {
						start:node.attrs?.start ?? 1,
						counterType:"numeric"
					}:{},
					items:this._listItems(node)
				}
			};
		}
		const texts:utf8_t[]="legalXml" === original?.type
			?[...original.data.texts]:[];
		return{
			id,type:"legalXml",data:{
				id:"legalXml" === original?.type ? id:"",
				texts,layout:this._layout(node,texts)
			}
		};
	}

	protected _matchesId(
		id:utf8_t|undefined,block:OutputBlockData
	):bool_t{
		return id === block.id;
	}

	protected _same(
		left:JSONContent,right:JSONContent|undefined
	):bool_t{
		if(undefined === right || left.type !== right.type
			|| left.text !== right.text){
			return false;
		}
		for(const key of ["xmlId","path","field","label","start"]){
			const fallback="start" === key ? 1:null;
			if(JSON.stringify(left.attrs?.[key] ?? fallback)
				!== JSON.stringify(right.attrs?.[key] ?? fallback)){
				return false;
			}
		}
		if(JSON.stringify(left.marks ?? [])
			!== JSON.stringify(right.marks ?? [])){
			return false;
		}
		const a=left.content ?? [];
		const b=right.content ?? [];
		return a.length === b.length && a.every(
			this._sameChild.bind(this,b)
		);
	}

	protected _sameChild(
		siblings:JSONContent[],child:JSONContent,index:size_t
	):bool_t{
		return this._same(child,siblings[index]);
	}

	public update(document:JSONContent):utf8_t{
		if(this._same(document,this._initial)){
			return this._codec.update(this._output);
		}
		return this._codec.update({
			blocks:(document.content ?? []).map(this._saveBlock.bind(this))
		});
	}
};
