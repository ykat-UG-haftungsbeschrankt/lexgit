import type { OutputData, OutputBlockData } from "@editorjs/editorjs";
import { OfficeLawXml } from "./xml";
import type { XmlLegalLayout } from "../editorjs/legal-xml-types";

interface OriginalBlock{
	type:string;
	data:unknown;
	xml:string;
	attributes:Record<string,string>;
	targets:XmlTextTarget[]|undefined;
	source:XmlSourceNode;
	prefixStart:number;
};

interface XmlSourceNode{
	kind:"document"|"element"|"text"|"comment"|"cdata"|"other";
	start:number;
	end:number;
	openEnd:number;
	closeStart:number;
	name:string;
	selfClosing:boolean;
	children:XmlSourceNode[];
};

interface XmlTextTarget{
	path:number[];
	start:number;
	count:number;
};

interface ListItem{
	content:string;
	meta:Record<string,unknown>;
	items:ListItem[];
};

const INLINE_TAGS:Readonly<Record<string,string>>={
	B:"b",I:"i",BR:"br"
};
const HTML_TAGS:Readonly<Record<string,string>>={
	B:"B",STRONG:"B",I:"I",EM:"I",BR:"BR",SUP:"SUP",SUB:"SUB",U:"U"
};

export class OfficeLawRichContent{
	protected readonly _source:string;
	protected readonly _originals:Map<string,OriginalBlock>;
	protected readonly _order:string[];
	protected _contentSource:XmlSourceNode|null;
	protected _contentSuffix:string;

	constructor(source:string){
		this._source=source;
		this._originals=new Map();
		this._order=[];
		this._contentSource=null;
		this._contentSuffix="";
	}

	public destructor():void{
		try{
			this._originals.clear();
			this._order.length=0;
			this._contentSource=null;
			this._contentSuffix="";
		}
		catch(UNUSED_e){}
	}

	protected _document():XMLDocument{
		OfficeLawXml.parse(this._source);
		const xml=new DOMParser().parseFromString(
			this._source,"application/xml"
		);
		if(xml.getElementsByTagName("parsererror").length>0){
			throw new Error("Ungültiges XML.");
		}
		return xml;
	}

	protected _child(parent:Element,name:string):Element|null{
		for(const child of Array.from(parent.children)){
			if(name.toLowerCase() === child.tagName.toLowerCase()){
				return child;
			}
		}
		return null;
	}

	protected _content(xml:XMLDocument):Element|null{
		const data=this._child(xml.documentElement,"textdaten");
		const text=null === data ? null : this._child(data,"text");
		return null === text ? null : this._child(text,"Content");
	}

	protected _sourceTree(source:string):XmlSourceNode{
		const root:XmlSourceNode={
			kind:"document",start:0,end:source.length,openEnd:0,
			closeStart:source.length,name:"",selfClosing:false,children:[]
		};
		const stack:XmlSourceNode[]=[root];
		let offset=0;
		while(offset<source.length){
			const parent=stack[stack.length-1];
			if(undefined === parent){
				throw new Error("XML-Quellposition fehlt.");
			}
			const opening=source.indexOf("<",offset);
			const textEnd=-1 === opening ? source.length:opening;
			if(textEnd>offset){
				parent.children.push({
					kind:"text",start:offset,end:textEnd,
					openEnd:offset,closeStart:textEnd,name:"",
					selfClosing:true,children:[]
				});
				offset=textEnd;
			}
			if(offset>=source.length){
				break;
			}
			let end:number;
			let kind:XmlSourceNode["kind"]="other";
			let name="";
			if(source.startsWith("<!--",offset)){
				end=source.indexOf("-->",offset+4);
				if(-1 === end){
					throw new Error("XML-Kommentar ist nicht geschlossen.");
				}
				end+=3;
				kind="comment";
			}
			else if(source.startsWith("<![CDATA[",offset)){
				end=source.indexOf("]]>",offset+9);
				if(-1 === end){
					throw new Error("CDATA-Abschnitt ist nicht geschlossen.");
				}
				end+=3;
				kind="cdata";
			}
			else{
				end=this._tagEnd(source,offset);
				if(source.startsWith("</",offset)){
					const closing=source.slice(offset+2,end-1).trim();
					const element=stack.pop();
					if(undefined === element
						|| "element" !== element.kind
						|| element.name !== closing){
						throw new Error("XML-Endelement stimmt nicht überein.");
					}
					element.closeStart=offset;
					element.end=end;
					offset=end;
					continue;
				}
				if(source.startsWith("<?",offset)){
					kind="other";
				}
				else if(source.startsWith("<!",offset)){
					kind="other";
				}
				else{
					kind="element";
					const match=/^<([^\s/>]+)/.exec(
						source.slice(offset,end)
					);
					if(null === match || undefined === match[1]){
						throw new Error("XML-Elementname fehlt.");
					}
					name=match[1];
				}
			}
			const selfClosing="element" === kind
				&& /\/\s*>$/.test(source.slice(offset,end));
			const node:XmlSourceNode={
				kind,start:offset,end,openEnd:end,closeStart:end,
				name,selfClosing,children:[]
			};
			parent.children.push(node);
			if("element" === kind && !selfClosing){
				stack.push(node);
			}
			offset=end;
		}
		if(1 !== stack.length){
			throw new Error("XML-Element ist nicht geschlossen.");
		}
		return root;
	}

	protected _tagEnd(source:string,start:number):number{
		let quote="";
		let subsetDepth=0;
		for(let index=start+1;index<source.length;index++){
			const character=source[index];
			if("" !== quote){
				if(character === quote){
					quote="";
				}
				continue;
			}
			if("'" === character || '"' === character){
				quote=character;
			}
			else if("<!" === source.slice(start,start+2)
				&& "[" === character){
				subsetDepth++;
			}
			else if("<!" === source.slice(start,start+2)
				&& "]" === character && subsetDepth>0){
				subsetDepth--;
			}
			else if(">" === character && 0 === subsetDepth){
				return index+1;
			}
		}
		throw new Error("XML-Elementtag ist nicht geschlossen.");
	}

	protected _path(root:Node,target:Node):number[]|null{
		if(root === target){
			return [];
		}
		const children=Array.from(root.childNodes);
		for(let index=0;index<children.length;index++){
			const child=children[index];
			if(undefined === child){
				continue;
			}
			const path=this._path(child,target);
			if(null !== path){
				return[index,...path];
			}
		}
		return null;
	}

	protected _sourceAtPath(
		root:XmlSourceNode,path:number[]
	):XmlSourceNode{
		let node=root;
		for(const index of path){
			const child=node.children[index];
			if(undefined === child){
				throw new Error("XML-Quellposition fehlt.");
			}
			node=child;
		}
		return node;
	}

	protected _sourceChildren(
		parent:XmlSourceNode,start:number,count:number
	):{start:number;end:number}{
		if(0 === count){
			const next=parent.children[start];
			const offset=undefined === next
				?parent.closeStart:next.start;
			return{start:offset,end:offset};
		}
		const first=parent.children[start];
		const last=parent.children[start+count-1];
		if(undefined === first || undefined === last){
			throw new Error("XML-Textposition fehlt.");
		}
		return{start:first.start,end:last.end};
	}

	protected _contentBounds(node:XmlSourceNode):{
		start:number;end:number
	}{
		return{
			start:node.openEnd,
			end:node.selfClosing ? node.openEnd:node.closeStart
		};
	}

	protected _inline(node:Node):string|null{
		if(Node.TEXT_NODE === node.nodeType){
			const span=document.createElement("span");
			span.textContent=node.nodeValue ?? "";
			return span.innerHTML.replace(/\n/g,"<br>");
		}
		if(!(node instanceof Element) || node.attributes.length>0){
			return null;
		}
		const tag=INLINE_TAGS[node.tagName.toUpperCase()];
		if(undefined === tag){
			return null;
		}
		const content=this._inlineChildren(node);
		if(null === content){
			return null;
		}
		return "br" === tag ? "<br>" : `<${tag}>${content}</${tag}>`;
	}

	protected _inlineChildren(node:Node):string|null{
		let text="";
		for(const child of Array.from(node.childNodes)){
			const value=this._inline(child);
			if(null === value){
				return null;
			}
			text+=value;
		}
		return text;
	}

	protected _listItems(list:Element):ListItem[]|null{
		const items:ListItem[]=[];
		for(const child of Array.from(list.childNodes)){
			if(Node.TEXT_NODE === child.nodeType && !child.nodeValue?.trim()){
				continue;
			}
			if(!(child instanceof Element)
				|| "LI" !== child.tagName.toUpperCase()
				|| child.attributes.length>0){
				return null;
			}
			let content="";
			let nested:ListItem[]=[];
			const nestedLists:{style:string;items:ListItem[]}[]=[];
			for(const node of Array.from(child.childNodes)){
				if(node instanceof Element
					&& ["UL","OL"].includes(node.tagName.toUpperCase())
					&& 0 === node.attributes.length){
					const parsed=this._listItems(node);
					if(null === parsed){
						return null;
					}
					nestedLists.push({
						style:"OL" === node.tagName.toUpperCase()
							?"ordered":"unordered",items:parsed
					});
				}
				else{
					const value=this._inline(node);
					if(null === value){
						return null;
					}
					content+=value;
				}
			}
			const sameStyle=1 === nestedLists.length
				&& nestedLists[0]?.style
					=== ("OL" === list.tagName.toUpperCase()
						?"ordered":"unordered");
			if(sameStyle){
				nested=nestedLists[0]?.items ?? [];
			}
			const meta=0 === nestedLists.length || sameStyle
				?{}:{nestedLists};
			items.push({content,meta,items:nested});
		}
		return items;
	}

	protected _legalLayout(
		element:Element,path:number[],texts:string[],
		targets:XmlTextTarget[]
	):XmlLegalLayout|null{
		if(!["P","DL","DT","DD","LA"].includes(
			element.tagName.toUpperCase()
		)){
			return null;
		}
		const children:XmlLegalLayout[]=[];
		const nodes=Array.from(element.childNodes);
		let index=0;
		while(index<nodes.length){
			const node=nodes[index];
			if("DL" === element.tagName.toUpperCase()
				&& Node.TEXT_NODE === node?.nodeType
				&& !node.nodeValue?.trim()){
				index++;
				continue;
			}
			if(node instanceof Element
				&& ["P","DL","DT","DD","LA"].includes(
					node.tagName.toUpperCase()
				)){
				const layout=this._legalLayout(
					node,[...path,index],texts,targets
				);
				if(null === layout){
					return null;
				}
				children.push(layout);
				index++;
				continue;
			}
			const start=index;
			let text="";
			while(index<nodes.length){
				const inline=nodes[index];
				if(undefined === inline){
					throw new Error("XML-Textposition fehlt.");
				}
				if(inline instanceof Element
					&& ["P","DL","DT","DD","LA"].includes(
						inline.tagName.toUpperCase()
					)){
					break;
				}
				const value=this._inline(inline);
				if(null === value){
					return null;
				}
				text+=value;
				index++;
			}
			if(text.trim()){
				const field=texts.length;
				texts.push(text);
				targets.push({path,start,count:index-start});
				children.push({tag:"text",field,children:[]});
			}
		}
		if(0 === children.length
			&& ("LA" === element.tagName.toUpperCase()
				|| "DT" === element.tagName.toUpperCase())){
			const field=texts.length;
			texts.push("");
			targets.push({path,start:0,count:nodes.length});
			children.push({tag:"text",field,children:[]});
		}
		if("DL" === element.tagName.toUpperCase()){
			for(let index=0;index<children.length;index+=2){
				if("DT" !== children[index]?.tag
					|| "DD" !== children[index+1]?.tag){
					return null;
				}
			}
		}
		return{tag:element.tagName.toUpperCase(),children,path};
	}

	public load():OutputData{
		this._originals.clear();
		this._order.length=0;
		const xml=this._document();
		const sourceTree=this._sourceTree(this._source);
		const content=this._content(xml);
		let contentPath:number[]|null=null;
		if(null !== content){
			contentPath=this._path(xml,content);
			if(null === contentPath){
				throw new Error("XML-Inhaltsbereich fehlt.");
			}
			this._contentSource=this._sourceAtPath(
				sourceTree,contentPath
			);
		}
		else{
			this._contentSource=null;
		}
		const blocks:OutputBlockData<string,Record<string,unknown>>[]=[];
		let prefixStart=null === this._contentSource
			?0:this._contentBounds(this._contentSource).start;
		const nodes=Array.from(content?.childNodes ?? []);
		for(let index=0;index<nodes.length;index++){
			const node=nodes[index];
			if(undefined === node){
				throw new Error("XML-Inhaltsposition fehlt.");
			}
			if(Node.TEXT_NODE === node.nodeType && !node.nodeValue?.trim()){
				continue;
			}
			if(null === contentPath){
				throw new Error("XML-Inhaltsposition fehlt.");
			}
			const id=`xmlblock${blocks.length}`;
			const sourceNode=this._sourceAtPath(
				sourceTree,[...contentPath,index]
			);
			const source=this._source.slice(
				sourceNode.start,sourceNode.end
			);
			let type="preservedXml";
			let data:Record<string,unknown>={id,label:node.nodeName};
			const attributes:Record<string,string>={};
			let targets:XmlTextTarget[]|undefined;
			if(node instanceof Element){
				for(const attribute of Array.from(node.attributes)){
					attributes[attribute.name]=attribute.value;
				}
				const text="P" === node.tagName.toUpperCase()
					?this._inlineChildren(node):null;
				if(null !== text){
					type="paragraph";
					data={text};
					targets=[{
						path:[],start:0,count:node.childNodes.length
					}];
				}
				else if(("UL" === node.tagName.toUpperCase()
					|| "OL" === node.tagName.toUpperCase())
					&& 0 === node.attributes.length){
					const items=this._listItems(node);
					if(null !== items){
						type="list";
						data={
							style:"OL" === node.tagName.toUpperCase()
								?"ordered":"unordered",
							meta:"OL" === node.tagName.toUpperCase()
								?{start:1,counterType:"numeric"}:{},
							items
						};
					}
				}
				else if(["P","DL"].includes(node.tagName.toUpperCase())
					&& ("DL" === node.tagName.toUpperCase()
						|| this._hasLegalList(node))){
					const texts:string[]=[];
					const locations:XmlTextTarget[]=[];
					const layout=this._legalLayout(node,[],texts,locations);
					if(null !== layout){
						type="legalXml";
						data={id,texts,layout};
						targets=locations;
					}
				}
			}
			this._order.push(id);
			this._originals.set(id,{
				type,data:structuredClone(data),xml:source,attributes,
				targets,source:sourceNode,prefixStart
			});
			blocks.push({id,type,data});
			prefixStart=sourceNode.end;
		}
		if(null !== this._contentSource){
			const bounds=this._contentBounds(this._contentSource);
			this._contentSuffix=this._source.slice(
				prefixStart,bounds.end
			);
		}
		else{
			this._contentSuffix="";
		}
		return{blocks};
	}

	protected _hasLegalList(node:Element):boolean{
		for(const child of Array.from(node.getElementsByTagName("*"))){
			if("DL" === child.tagName.toUpperCase()){
				return true;
			}
		}
		return false;
	}

	protected _appendInline(
		html:string,parent:Element,xml:XMLDocument
	):void{
		const template=document.createElement("template");
		template.innerHTML=html;
		for(const node of Array.from(template.content.childNodes)){
			parent.appendChild(this._inlineXml(node,xml));
		}
	}

	protected _inlineXml(node:Node,xml:XMLDocument):Node{
		if(Node.TEXT_NODE === node.nodeType){
			return xml.createTextNode(node.nodeValue ?? "");
		}
		if(!(node instanceof Element)){
			throw new Error("Nicht unterstützte Textformatierung.");
		}
		const tag=HTML_TAGS[node.tagName];
		if(undefined === tag){
			throw new Error(`Nicht unterstützte Formatierung: ${node.tagName}`);
		}
		const element=xml.createElement(tag);
		for(const child of Array.from(node.childNodes)){
			element.appendChild(this._inlineXml(child,xml));
		}
		return element;
	}

	protected _record(value:unknown):value is Record<string,unknown>{
		return "object" === typeof value && null !== value
			&& !Array.isArray(value);
	}

	protected _appendList(
		items:unknown,list:Element,xml:XMLDocument
	):void{
		if(!Array.isArray(items)){
			throw new Error("Ungültige Editor.js-Liste.");
		}
		for(const item of items){
			if(!this._record(item) || "string" !== typeof item.content){
				throw new Error("Ungültiger Listeneintrag.");
			}
			const li=xml.createElement("LI");
			this._appendInline(item.content,li,xml);
			if(!Array.isArray(item.items)){
				throw new Error("Ungültige verschachtelte Liste.");
			}
			const nestedLists=this._record(item.meta)
				?item.meta.nestedLists:undefined;
			if(Array.isArray(nestedLists)){
				for(const entry of nestedLists){
					if(!this._record(entry)
						|| !["ordered","unordered"].includes(
							String(entry.style)
						)){
						throw new Error("Ungültige verschachtelte Liste.");
					}
					const nested=xml.createElement(
						"ordered" === entry.style ? "OL":"UL"
					);
					this._appendList(entry.items,nested,xml);
					li.appendChild(nested);
				}
			}
			else if(item.items.length>0){
				const nested=xml.createElement(list.tagName);
				this._appendList(item.items,nested,xml);
				li.appendChild(nested);
			}
			list.appendChild(li);
		}
	}

	protected _block(block:OutputBlockData,xml:XMLDocument):Node{
		const original=undefined === block.id ? undefined
			:this._originals.get(block.id);
		if("legalXml" === block.type){
			return this._legalBlock(block,xml);
		}
		if("preservedXml" === block.type){
			const data:unknown=block.data;
			if(!this._record(data) || "string" !== typeof data.id){
				throw new Error("Ungültiger geschützter XML-Block.");
			}
			const stored=this._originals.get(data.id);
			if(undefined === stored || "preservedXml" !== stored.type){
				throw new Error("Geschützter XML-Block fehlt.");
			}
			return this._import(stored.xml,xml);
		}
		if(undefined !== original && original.type === block.type
			&& JSON.stringify(original.data) === JSON.stringify(block.data)){
			return this._import(original.xml,xml);
		}
		const data:unknown=block.data;
		if(!this._record(data)){
			throw new Error("Ungültiger Editor.js-Block.");
		}
		if("paragraph" === block.type && "string" === typeof data.text){
			const paragraph=xml.createElement("P");
			for(const [name,value] of Object.entries(
				original?.attributes ?? {}
			)){
				if("office-law-text" !== name){
					paragraph.setAttribute(name,value);
				}
			}
			this._appendInline(data.text,paragraph,xml);
			return paragraph;
		}
		if("list" === block.type
			&& ("ordered" === data.style || "unordered" === data.style)){
			const list=xml.createElement(
				"ordered" === data.style ? "OL":"UL"
			);
			if(this._record(data.meta) && "ordered" === data.style){
				if(undefined !== data.meta.start && 1 !== data.meta.start
					|| undefined !== data.meta.counterType
						&& "numeric" !== data.meta.counterType){
					throw new Error("Nur numerische Listen ab 1 sind unterstützt.");
				}
			}
			this._appendList(data.items,list,xml);
			return list;
		}
		throw new Error(`Nicht unterstützter Blocktyp: ${block.type}`);
	}

	protected _legalBlock(
		block:OutputBlockData,xml:XMLDocument
	):Node{
		const data:unknown=block.data;
		if(!this._record(data) || "string" !== typeof data.id
			|| !Array.isArray(data.texts)){
			throw new Error("Ungültige juristische XML-Aufzählung.");
		}
		const original=this._originals.get(data.id);
		if("" === data.id){
			return this._rebuildLegal(
				data.layout,new Map(),new Map(),new Set(),data.texts,xml
			);
		}
		if(undefined === original || "legalXml" !== original.type
			|| undefined === original.targets
			|| original.targets.length>data.texts.length
			|| !this._record(original.data)
			|| !Array.isArray(original.data.texts)){
			throw new Error("Ursprüngliche XML-Aufzählung fehlt.");
		}
		const root=this._import(original.xml,xml);
		const sources=new Map<string,Node>();
		this._collectLegalSources(original.data.layout,root,sources);
		const fields=new Map<number,{parent:Node;nodes:Node[]}>();
		// Resolve all positions before replacing mixed-content text runs.
		const parents=original.targets.map((target)=>{
			let parent:Node=root;
			for(const index of target.path){
				const child=parent.childNodes[index];
				if(undefined === child){
					throw new Error("XML-Textposition fehlt.");
				}
				parent=child;
			}
			return parent;
		});
		for(let index=original.targets.length-1;0 <= index;index--){
			const text:unknown=data.texts[index];
			if("string" !== typeof text){
				throw new Error("Ungültiger Aufzählungstext.");
			}
			const target=original.targets[index];
			const parent=parents[index];
			if(undefined === target || undefined === parent){
				throw new Error("XML-Textposition fehlt.");
			}
			const removed=Array.from(parent.childNodes).slice(
				target.start,target.start+target.count
			);
			if(original.data.texts[index] === text){
				fields.set(index,{parent,nodes:removed});
				continue;
			}
			const next=parent.childNodes[target.start+target.count] ?? null;
			const fragment=xml.createElement("fragment");
			this._appendInline(text,fragment,xml);
			for(const node of removed){
				parent.removeChild(node);
			}
			const inserted=Array.from(fragment.childNodes);
			for(const node of inserted){
				parent.insertBefore(node,next);
			}
			fields.set(index,{parent,nodes:inserted});
		}
		if(JSON.stringify(data.layout)
			=== JSON.stringify(original.data.layout)){
			return root;
		}
		return this._rebuildLegal(
			data.layout,sources,fields,new Set(),data.texts,xml
		);
	}

	protected _collectLegalSources(
		value:unknown,root:Node,sources:Map<string,Node>
	):void{
		if(!this._record(value) || !Array.isArray(value.children)){
			throw new Error("Ungültige ursprüngliche Aufzählungsstruktur.");
		}
		if(Array.isArray(value.path)){
			let source=root;
			for(const index of value.path){
				const child=source.childNodes[index];
				if(undefined === child){
					throw new Error("Ursprüngliche XML-Position fehlt.");
				}
				source=child;
			}
			sources.set(JSON.stringify(value.path),source);
		}
		for(const child of value.children){
			this._collectLegalSources(child,root,sources);
		}
	}

	protected _rebuildLegal(
		value:unknown,sources:Map<string,Node>,
		fields:Map<number,{parent:Node;nodes:Node[]}>,used:Set<string>,
		texts:unknown[],xml:XMLDocument
	):Node{
		if(!this._record(value) || "string" !== typeof value.tag
			|| !Array.isArray(value.children)){
			throw new Error("Ungültige Aufzählungsstruktur.");
		}
		if("text" === value.tag){
			throw new Error("Text ohne XML-Elternelement.");
		}
		if(!["P","DL","DT","DD","LA"].includes(value.tag)){
			throw new Error("Unbekanntes Aufzählungselement.");
		}
		if("DL" === value.tag){
			for(let index=0;index<value.children.length;index+=2){
				const dt:unknown=value.children[index];
				const dd:unknown=value.children[index+1];
				if(!this._record(dt) || "DT" !== dt.tag
					|| !this._record(dd) || "DD" !== dd.tag){
					throw new Error("Aufzählung benötigt DT/DD-Paare.");
				}
			}
		}
		const existing=undefined !== value.path;
		const key=JSON.stringify(value.path);
		const source=existing ? sources.get(key):undefined;
		if(existing && (!(source instanceof Element)
			|| source.tagName.toUpperCase() !== value.tag)){
			throw new Error("XML-Element stimmt nicht überein.");
		}
		if(existing && "DL" !== value.tag && used.has(key)){
			throw new Error("Doppeltes Aufzählungselement.");
		}
		if(existing){
			used.add(key);
		}
		const element=undefined === source
			? xml.createElement(value.tag):source.cloneNode(false);
		for(const child of value.children){
			if(this._record(child) && "text" === child.tag){
				// Text runs are copied from the already updated original.
				if("number" !== typeof child.field
					|| !Number.isInteger(child.field) || child.field<0){
					throw new Error("Ungültiges Textfeld.");
				}
				const stored=fields.get(child.field);
				if(undefined === stored && element instanceof Element){
					const text=texts[child.field];
					if("string" !== typeof text){
						throw new Error("Neuer Aufzählungstext fehlt.");
					}
					this._appendInline(text,element,xml);
					continue;
				}
				if(undefined === stored || stored.parent !== source){
					throw new Error("Textfeld gehört nicht zum XML-Element.");
				}
				for(const node of stored.nodes){
					element.appendChild(node.cloneNode(true));
				}
			}
			else{
				element.appendChild(
					this._rebuildLegal(child,sources,fields,used,texts,xml)
				);
			}
		}
		return element;
	}

	protected _import(source:string,xml:XMLDocument):Node{
		const wrapper=new DOMParser().parseFromString(
			`<wrapper>${source}</wrapper>`,"application/xml"
		);
		const node=wrapper.documentElement.firstChild;
		if(null === node
			|| wrapper.getElementsByTagName("parsererror").length>0){
			throw new Error("Ungültiger ursprünglicher XML-Block.");
		}
		return xml.importNode(node,true);
	}

	protected _ensure(
		parent:Element,name:string,xml:XMLDocument
	):Element{
		let child=this._child(parent,name);
		if(null === child){
			child=xml.createElement(name);
			parent.appendChild(child);
		}
		return child;
	}

	protected _inlineMarkup(html:string,xml:XMLDocument):string{
		const fragment=xml.createElement("fragment");
		this._appendInline(html,fragment,xml);
		return Array.from(fragment.childNodes).map((node)=>{
			return new XMLSerializer().serializeToString(node);
		}).join("");
	}

	protected _patchTextTargets(
		block:OutputBlockData,original:OriginalBlock,xml:XMLDocument
	):{start:number;end:number;value:string}[]|null{
		if(undefined === original.targets){
			return null;
		}
		const data:unknown=block.data;
		if(!this._record(data)){
			return null;
		}
		const changed:{index:number;value:string}[]=[];
		if("paragraph" === block.type && "string" === typeof data.text
			&& this._record(original.data)
			&& "string" === typeof original.data.text
			&& original.data.text !== data.text){
			changed.push({index:0,value:data.text});
		}
		else if("legalXml" === block.type
			&& this._record(original.data)
			&& JSON.stringify(original.data.layout)
				=== JSON.stringify(data.layout)
			&& Array.isArray(original.data.texts)
			&& Array.isArray(data.texts)){
			for(let index=0;index<data.texts.length;index++){
				const value=data.texts[index];
				if("string" !== typeof value){
					throw new Error("Ungültiger Aufzählungstext.");
				}
				if(original.data.texts[index] !== value){
					changed.push({index,value});
				}
			}
		}
		else{
			return null;
		}
		const patches:{start:number;end:number;value:string}[]=[];
		for(const entry of changed){
			const target=original.targets[entry.index];
			if(undefined === target){
				throw new Error("XML-Textposition fehlt.");
			}
			const parent=this._sourceAtPath(
				original.source,target.path
			);
			const bounds=this._sourceChildren(
				parent,target.start,target.count
			);
			if(parent.selfClosing){
				return null;
			}
			patches.push({
				...bounds,value:this._inlineMarkup(entry.value,xml)
			});
		}
		return patches;
	}

	protected _patchedElement(
		original:OriginalBlock,generated:string
	):string{
		const generatedRoot=this._sourceTree(generated).children.find(
			(node)=>"element" === node.kind
		);
		if(undefined === generatedRoot){
			throw new Error("Editor.js-XML-Element fehlt.");
		}
		if(original.source.name.toUpperCase()
			!== generatedRoot.name.toUpperCase()){
			return generated;
		}
		const source=this._source.slice(
			original.source.start,original.source.end
		);
		const opening=source.slice(
			0,original.source.openEnd-original.source.start
		);
		const inner=generated.slice(
			generatedRoot.openEnd,
			generatedRoot.selfClosing
				?generatedRoot.openEnd:generatedRoot.closeStart
		);
		if(original.source.selfClosing){
			const expanded=opening.replace(/\/\s*>$/,"");
			return expanded+">"+inner
				+`</${original.source.name}>`;
		}
		const close=source.slice(
			original.source.closeStart-original.source.start
		);
		return opening+inner+close;
	}

	protected _applyPatches(
		source:string,patches:{start:number;end:number;value:string}[]
	):string{
		const ordered=[...patches].sort((left,right)=>{
			return right.start-left.start;
		});
		let result=source;
		let nextStart=source.length;
		for(const patch of ordered){
			if(patch.end>nextStart || patch.start>patch.end){
				throw new Error("XML-Änderungen überschneiden sich.");
			}
			result=result.slice(0,patch.start)+patch.value
				+result.slice(patch.end);
			nextStart=patch.start;
		}
		return result;
	}

	protected _withNewContent(
		output:OutputData,xml:XMLDocument
	):string{
		const data=this._child(xml.documentElement,"textdaten");
		const text=null === data ? null:this._child(data,"text");
		const parent=text ?? data ?? xml.documentElement;
		const path=this._path(xml,parent);
		if(null === path){
			throw new Error("XML-Inhaltsposition fehlt.");
		}
		const node=this._sourceAtPath(
			this._sourceTree(this._source),path
		);
		let value="<Content>";
		for(const block of output.blocks){
			value+=new XMLSerializer().serializeToString(
				this._block(block,xml)
			);
		}
		value+="</Content>";
		if(null === text){
			value="<text>"+value+"</text>";
		}
		if(null === data){
			value="<textdaten>"+value+"</textdaten>";
		}
		let start=node.closeStart;
		let end=start;
		if(node.selfClosing){
			start=node.start;
			end=node.end;
			const opening=this._source.slice(
				node.start,node.openEnd
			).replace(/\/\s*>$/,">");
			value=opening+value+`</${node.name}>`;
		}
		const result=this._source.slice(0,start)+value
			+this._source.slice(end);
		OfficeLawXml.parse(result);
		return result;
	}

	public update(output:OutputData):string{
		const xml=this._document();
		const unchanged=output.blocks.length === this._order.length
			&& output.blocks.every((block,index)=>{
				const original=this._originals.get(this._order[index] ?? "");
				return block.id === this._order[index]
					&& original?.type === block.type
					&& JSON.stringify(original.data)
						=== JSON.stringify(block.data);
			});
		if(unchanged){
			return this._source;
		}
		if(null === this._contentSource){
			return this._withNewContent(output,xml);
		}
		const seen=new Set<string>();
		for(const block of output.blocks){
			if(undefined !== block.id){
				if(seen.has(block.id)){
					throw new Error("Doppelter Editor.js-Block.");
				}
				seen.add(block.id);
			}
		}
		const sameOrder=output.blocks.length === this._order.length
			&& output.blocks.every((block,index)=>{
				return block.id === this._order[index];
			});
		if(sameOrder){
			const patches:{
				start:number;end:number;value:string
			}[]=[];
			for(const block of output.blocks){
				const original=undefined === block.id ? undefined
					:this._originals.get(block.id);
				if(undefined === original
					|| JSON.stringify(original.data)
						=== JSON.stringify(block.data)){
					continue;
				}
				const textPatches=this._patchTextTargets(
					block,original,xml
				);
				if(null !== textPatches && textPatches.length>0){
					patches.push(...textPatches);
					continue;
				}
				const generated=new XMLSerializer().serializeToString(
					this._block(block,xml)
				);
				const value=this._patchedElement(original,generated);
				if(value === generated){
					patches.push({
						start:original.source.start,
						end:original.source.end,value
					});
					continue;
				}
				if(original.source.selfClosing){
					patches.push({
						start:original.source.start,
						end:original.source.end,value
					});
				}
				else{
					patches.push({
						start:original.source.start,
						end:original.source.end,value
					});
				}
			}
			const result=this._applyPatches(this._source,patches);
			OfficeLawXml.parse(result);
			return result;
		}
		const parts:string[]=[];
		for(const block of output.blocks){
			const original=undefined === block.id ? undefined
				:this._originals.get(block.id);
			if(undefined === original){
				parts.push(new XMLSerializer().serializeToString(
					this._block(block,xml)
				));
				continue;
			}
			let value=original.xml;
			if(original.type !== block.type
				|| JSON.stringify(original.data)
					!== JSON.stringify(block.data)){
				const generated=new XMLSerializer().serializeToString(
					this._block(block,xml)
				);
				value=this._patchedElement(original,generated);
			}
			parts.push(
				this._source.slice(
					original.prefixStart,original.source.start
				)+value
			);
		}
		parts.push(this._contentSuffix);
		const bounds=this._contentBounds(this._contentSource);
		let result:string;
		if(this._contentSource.selfClosing){
			const opening=this._source.slice(
				this._contentSource.start,this._contentSource.openEnd
			).replace(/\/\s*>$/i,">");
			result=this._source.slice(0,this._contentSource.start)
				+opening+parts.join("")
				+`</${this._contentSource.name}>`
				+this._source.slice(this._contentSource.end);
		}
		else{
			result=this._source.slice(0,bounds.start)+parts.join("")
				+this._source.slice(bounds.end);
		}
		OfficeLawXml.parse(result);
		return result;
	}
};
