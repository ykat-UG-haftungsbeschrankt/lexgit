import { XMLSerializer } from "@xmldom/xmldom";

type XmlDocument=import("@xmldom/xmldom").Document;
type XmlNode=import("@xmldom/xmldom").Node;
type XmlElement=import("@xmldom/xmldom").Element;
type XmlAttribute=import("@xmldom/xmldom").Attr;

const TEXT_ELEMENTS=new Set([
	"p","b","i","u","sup","sub","dt","dd","la","pre"
]);
const INLINE_ELEMENTS=new Set([
	"b","i","u","sup","sub","br","strong","em","a","span"
]);
const LINE_ELEMENTS=new Set(["p","dt","dd"]);

export class OfficeLawXmlFormatter{
	public destructor():void{}

	protected static _compare(
		left:XmlAttribute,right:XmlAttribute
	):number{
		const a=left.name.toLowerCase();
		const b=right.name.toLowerCase();
		return a<b ? -1 : a>b ? 1 : 0;
	}

	protected static _normalize(
		node:XmlNode,document:XmlDocument
	):XmlNode{
		if(1 !== node.nodeType){
			return document.importNode(node,true);
		}
		const original=node as XmlElement;
		const element=document.createElementNS(
			original.namespaceURI,original.tagName.toLowerCase()
		);
		const attributes:Array<XmlAttribute>=[];
		for(let index=0;index<original.attributes.length;index++){
			const attribute=original.attributes.item(index);
			if(null !== attribute){
				attributes.push(attribute);
			}
		}
		attributes.sort(OfficeLawXmlFormatter._compare);
		for(const attribute of attributes){
			const name=attribute.name.toLowerCase();
			if(element.hasAttribute(name)){
				throw new Error(
					`Attribute names collide after lowercasing: ${name}`
				);
			}
			element.setAttributeNS(
				attribute.namespaceURI,name,attribute.value
			);
		}
		for(let index=0;index<original.childNodes.length;index++){
			const child=original.childNodes.item(index);
			if(null !== child){
				element.appendChild(
					OfficeLawXmlFormatter._normalize(child,document)
				);
			}
		}
		if(null === element.firstChild){
			element.appendChild(document.createTextNode(""));
		}
		return element;
	}

	protected static _render(
		node:XmlNode,depth:number,preserve:boolean
	):string{
		const serializer=new XMLSerializer();
		const indent="\t".repeat(depth);
		if(1 !== node.nodeType){
			return indent+serializer.serializeToString(node);
		}
		const element=node as XmlElement;
		const space=element.getAttribute("xml:space");
		const keep="preserve" === space
			|| ("default" !== space && preserve)
			|| "pre" === element.tagName
			|| "plain" === element.getAttribute("office-law-text");
		if(!keep && TEXT_ELEMENTS.has(element.tagName)
			&& OfficeLawXmlFormatter._containsLineElement(element)){
			return OfficeLawXmlFormatter._renderNested(element,depth);
		}
		const children:XmlNode[]=[];
		let text=false;
		let hasElements=false;
		let hasText=false;
		let inline=false;
		for(let index=0;index<element.childNodes.length;index++){
			const child=element.childNodes.item(index);
			if(null === child){
				continue;
			}
			if(4 === child.nodeType
				|| (3 === child.nodeType && child.nodeValue?.trim())){
				text=true;
			}
			hasElements=hasElements || 1 === child.nodeType;
			hasText=hasText || 3 === child.nodeType;
			inline=inline || (1 === child.nodeType
				&& INLINE_ELEMENTS.has(child.nodeName));
			if(3 !== child.nodeType || child.nodeValue?.trim()){
				children.push(child);
			}
		}
		// Layout whitespace must never be inserted into mixed content.
		if(keep || TEXT_ELEMENTS.has(element.tagName)
			|| text || inline || (hasText && !hasElements
			&& element.textContent)){
			return indent+serializer.serializeToString(element);
		}
		const opening=OfficeLawXmlFormatter._opening(element);
		const lines=[indent+opening];
		for(const child of children){
			lines.push(OfficeLawXmlFormatter._render(
				child,depth+1,keep
			));
		}
		lines.push(`${indent}</${element.tagName}>`);
		return lines.join("\n");
	}

	protected static _opening(element:XmlElement):string{
		const serializer=new XMLSerializer();
		const shallow=element.cloneNode(false);
		const empty=serializer.serializeToString(shallow);
		if(empty.endsWith("/>")){
			return empty.slice(0,-2)+">";
		}
		const closing=`</${element.tagName}>`;
		if(!empty.endsWith(closing)){
			throw new Error(`Cannot format XML element: ${element.tagName}`);
		}
		return empty.slice(0,-closing.length);
	}

	protected static _containsLineElement(node:XmlNode):boolean{
		for(let index=0;index<node.childNodes.length;index++){
			const child=node.childNodes.item(index);
			if(null !== child && 1 === child.nodeType
				&& (LINE_ELEMENTS.has(child.nodeName)
					|| OfficeLawXmlFormatter._containsLineElement(child))){
				return true;
			}
		}
		return false;
	}

	protected static _renderNested(
		element:XmlElement,depth:number
	):string{
		const serializer=new XMLSerializer();
		const indent="\t".repeat(depth);
		const opening=OfficeLawXmlFormatter._opening(element);
		const lines:string[]=[];
		let run=indent+opening;
		for(let index=0;index<element.childNodes.length;index++){
			const child=element.childNodes.item(index);
			if(null === child){
				continue;
			}
			if(1 === child.nodeType && (LINE_ELEMENTS.has(child.nodeName)
				|| OfficeLawXmlFormatter._containsLineElement(child))){
				const value=OfficeLawXmlFormatter._cleanRun(run);
				if(value.trim()){
					lines.push(value);
				}
				lines.push(OfficeLawXmlFormatter._render(
					child,depth+1,false
				));
				run=indent;
			}
			else{
				const value=serializer.serializeToString(child);
				run+=3 === child.nodeType
					?OfficeLawXmlFormatter._cleanRun(value):value;
			}
		}
		// Only text nodes lose layout whitespace; CDATA stays verbatim.
		lines.push(`${run}</${element.tagName}>`);
		return lines.join("\n");
	}

	protected static _cleanRun(value:string):string{
		return value.replace(
			/^[\t ]*\n[\t \n]*|[\t ]*\n[\t \n]*$/g,""
		);
	}

	public static format(document:XmlDocument):string{
		const normalized=document.implementation.createDocument(
			null,"",null
		);
		const lines:string[]=[];
		for(let index=0;index<document.childNodes.length;index++){
			const child=document.childNodes.item(index);
			if(null === child || (3 === child.nodeType
				&& !child.nodeValue?.trim())){
				continue;
			}
			const node=OfficeLawXmlFormatter._normalize(child,normalized);
			lines.push(OfficeLawXmlFormatter._render(node,0,false));
		}
		return `${lines.join("\n")}\n`;
	}
};
