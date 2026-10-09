import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { OfficeLawXmlFormatter } from "./xml-formatter";
import type { OfficeLawNorm } from "./types";

type XmlDocument=ReturnType<DOMParser["parseFromString"]>;
type XmlElement=NonNullable<XmlDocument["documentElement"]>;
type XmlNode=NonNullable<ReturnType<XmlElement["childNodes"]["item"]>>;

const BLOCKS=new Set(["P","DL","PRE","UL","OL","LI","TABLE","TR"]);
const OFFICIAL_DOCTYPE=new RegExp(
	'<!DOCTYPE\\s+dokumente\\s+SYSTEM\\s+(["\'])'
	+'https?:\\/\\/www\\.gesetze-im-internet\\.de'
	+'\\/dtd\\/1\\.01\\/gii-norm\\.dtd\\1\\s*>',
	"g"
);

// This codec has no filesystem dependencies; the viewer uses it too.
export class OfficeLawXml{
	public destructor():void{}

	protected static _error(
		errors:string[],level:string,message:string
	):void{
		errors.push(`${level}: ${message}`);
	}

	public static parseDocument(source:string):XmlDocument{
		// Ignore the official external declaration; never load its DTD.
		const input=source.replace(OFFICIAL_DOCTYPE,"");
		if(/<!DOCTYPE|<!ENTITY/i.test(input)){
			throw new Error("DTD and entity declarations are not supported.");
		}
		const errors:string[]=[];
		const parser=new DOMParser({
			onError:OfficeLawXml._error.bind(null,errors)
		});
		const document=parser.parseFromString(input,"application/xml");
		if(0<errors.length || null === document.documentElement){
			throw new Error(`Invalid norm XML: ${errors.join("; ")}`);
		}
		return document;
	}

	public static children(node:XmlNode,name:string):XmlElement[]{
		const result:XmlElement[]=[];
		for(let index=0;index<node.childNodes.length;index++){
			const child=node.childNodes.item(index);
			if(null !== child && 1 === child.nodeType
				&& name.toLowerCase() === child.nodeName.toLowerCase()){
				result.push(child as XmlElement);
			}
		}
		return result;
	}

	public static format(source:string):string{
		const result=OfficeLawXmlFormatter.format(
			OfficeLawXml.parseDocument(source)
		);
		OfficeLawXml.parseDocument(result);
		return result;
	}

	protected static _child(
		node:XmlNode,name:string
	):XmlElement|null{
		return OfficeLawXml.children(node,name)[0] ?? null;
	}

	protected static _text(node:XmlNode):string{
		let value="";
		for(let index=0;index<node.childNodes.length;index++){
			const child=node.childNodes.item(index);
			if(null === child){
				continue;
			}
			if(3 === child.nodeType || 4 === child.nodeType){
				value+=child.nodeValue ?? "";
			}
			else if(1 === child.nodeType){
				const tag=child.nodeName.toUpperCase();
				if("BR" === tag){
					value+="\n";
				}
				else{
					const block=BLOCKS.has(tag) || "DT" === tag;
					value+=block ? "\n" : "";
					value+=OfficeLawXml._text(child);
					value+=block || "DD" === tag ? "\n" : "";
				}
			}
		}
		const lines=value.replace(/\r\n?/g,"\n").split("\n");
		const result:string[]=[];
		for(const line of lines){
			const text=line.replace(/[ \t]+/g," ").trim();
			if(text || (0<result.length && "" !== result.at(-1))){
				result.push(text);
			}
		}
		while("" === result.at(-1)){
			result.pop();
		}
		return result.join("\n");
	}

	protected static _value(node:XmlNode,name:string):string|null{
		const child=OfficeLawXml._child(node,name);
		return null === child ? null : OfficeLawXml._text(child) || null;
	}

	protected static _content(root:XmlElement,name:string):XmlElement|null{
		const data=OfficeLawXml._child(root,"textdaten");
		const container=null === data ? null
			:OfficeLawXml._child(data,name);
		return null === container ? null
			:OfficeLawXml._child(container,"Content");
	}

	protected static _paragraph(node:XmlElement):string{
		return "plain" === node.getAttribute("office-law-text")
			?node.textContent ?? "" : OfficeLawXml._text(node);
	}

	protected static _paragraphs(root:XmlElement,name:string):string[]{
		const content=OfficeLawXml._content(root,name);
		if(null === content){
			return[];
		}
		const paragraphs=OfficeLawXml.children(content,"P");
		if(0<paragraphs.length){
			return paragraphs.map(OfficeLawXml._paragraph);
		}
		const value=OfficeLawXml._text(content);
		return value ? [value] : [];
	}

	public static parse(source:string):OfficeLawNorm{
		const document=OfficeLawXml.parseDocument(source);
		const root=document.documentElement!;
		if("norm" !== root.nodeName.toLowerCase()){
			throw new Error("Expected a standalone norm XML root.");
		}
		const documentNumber=root.getAttribute("doknr") ?? "";
		if(!/^[A-Z0-9]+$/.test(documentNumber)){
			throw new Error("Invalid norm XML document number.");
		}
		const metadata=OfficeLawXml._child(root,"metadaten");
		if(null === metadata){
			throw new Error("Norm XML has no metadaten element.");
		}
		const hierarchy=OfficeLawXml._child(metadata,"gliederungseinheit");
		return{
			documentNumber,
			kind:null === hierarchy ? "norm" : "section",
			identifier:OfficeLawXml._value(metadata,"enbez"),
			title:OfficeLawXml._value(metadata,"titel"),
			hierarchy:null === hierarchy ? null : {
				number:OfficeLawXml._value(
					hierarchy,"gliederungskennzahl"
				),
				label:OfficeLawXml._value(hierarchy,"gliederungsbez"),
				title:OfficeLawXml._value(hierarchy,"gliederungstitel")
			},
			paragraphs:OfficeLawXml._paragraphs(root,"text"),
			footnotes:OfficeLawXml._paragraphs(root,"fussnoten"),
			sourceXml:source
		};
	}

	public static serialize(node:XmlNode):string{
		return new XMLSerializer().serializeToString(node);
	}

	protected static _set(
		document:XmlDocument,parent:XmlElement,
		name:string,value:string|null
	):void{
		let element=OfficeLawXml._child(parent,name);
		if(null === value){
			if(null !== element){
				parent.removeChild(element);
			}
			return;
		}
		if(null === element){
			element=document.createElement(name);
			parent.appendChild(element);
		}
		while(null !== element.firstChild){
			element.removeChild(element.firstChild);
		}
		element.appendChild(document.createTextNode(value));
	}

	protected static _ensure(
		document:XmlDocument,parent:XmlElement,name:string
	):XmlElement{
		let element=OfficeLawXml._child(parent,name);
		if(null === element){
			element=document.createElement(name);
			parent.appendChild(element);
		}
		return element;
	}

	protected static _writeParagraphs(
		document:XmlDocument,root:XmlElement,
		name:string,values:string[],previous:string[]
	):void{
		if(JSON.stringify(values) === JSON.stringify(previous)){
			return;
		}
		const data=OfficeLawXml._ensure(document,root,"textdaten");
		const container=OfficeLawXml._ensure(document,data,name);
		const content=OfficeLawXml._ensure(document,container,"Content");
		const old=OfficeLawXml.children(content,"P");
		const available=old.slice();
		const selected:XmlElement[]=[];
		for(const value of values){
			const index=available.findIndex((node)=>{
				return value === OfficeLawXml._paragraph(node);
			});
			if(0 <= index){
				selected.push(available.splice(index,1)[0]!);
			}
			else{
				const paragraph=document.createElement("P");
				paragraph.setAttribute("office-law-text","plain");
				paragraph.appendChild(document.createTextNode(value));
				selected.push(paragraph);
			}
		}
		// Keep unknown siblings (comments, tables, annotations) intact.
		const marker=document.createComment("paragraph edit");
		content.insertBefore(marker,old[0] ?? null);
		for(const paragraph of selected){
			content.insertBefore(paragraph,marker);
		}
		for(const paragraph of available){
			content.removeChild(paragraph);
		}
		content.removeChild(marker);
	}

	public static write(norm:OfficeLawNorm,source?:string):string{
		const document=OfficeLawXml.parseDocument(source ??
			`<norm doknr="${norm.documentNumber}"><metadaten/></norm>`);
		const root=document.documentElement!;
		const previous=undefined === source ? null
			:OfficeLawXml.parse(source);
		if(null !== previous
			&& previous.documentNumber !== norm.documentNumber){
			throw new Error("Norm XML identity mismatch.");
		}
		const metadata=OfficeLawXml._ensure(document,root,"metadaten");
		for(const [name,value,old] of [
			["enbez",norm.identifier,previous?.identifier],
			["titel",norm.title,previous?.title]
		]){
			if(value !== old){
				OfficeLawXml._set(document,metadata,name!,value ?? null);
			}
		}
		if(JSON.stringify(norm.hierarchy)
			!== JSON.stringify(previous?.hierarchy ?? null)){
			const old=OfficeLawXml._child(metadata,"gliederungseinheit");
			if(null === norm.hierarchy){
				if(null !== old){
					metadata.removeChild(old);
				}
			}
			else{
				const hierarchy=OfficeLawXml._ensure(
					document,metadata,"gliederungseinheit"
				);
				OfficeLawXml._set(document,hierarchy,
					"gliederungskennzahl",norm.hierarchy.number);
				OfficeLawXml._set(document,hierarchy,
					"gliederungsbez",norm.hierarchy.label);
				OfficeLawXml._set(document,hierarchy,
					"gliederungstitel",norm.hierarchy.title);
			}
		}
		OfficeLawXml._writeParagraphs(document,root,"text",
			norm.paragraphs,previous?.paragraphs ?? []);
		OfficeLawXml._writeParagraphs(document,root,"fussnoten",
			norm.footnotes,previous?.footnotes ?? []);
		const result=OfficeLawXmlFormatter.format(document);
		OfficeLawXml.parse(result);
		return `${result.trimEnd()}\n`;
	}
};
