import { OfficeLawXml } from "./xml";
import type { OfficeLawCitationSpan } from "./citations";

interface TextPosition{
	start:size_t;
	end:size_t;
};

export class OfficeLawXmlExcerpt{
	public destructor():void{}

	public static create(
		source:utf8_t,scopes:readonly OfficeLawCitationSpan[]
	):utf8_t{
		const norm=OfficeLawXml.parse(source);
		const text=norm.paragraphs.join("\n\n");
		for(const scope of scopes){
			if(!Number.isInteger(scope.start)
				|| !Number.isInteger(scope.end)
				|| 0>scope.start || scope.end<scope.start
				|| scope.end>text.length){
				throw new Error("Invalid citation excerpt range.");
			}
		}
		if(1 === scopes.length && 0 === scopes[0]?.start
			&& text.length === scopes[0]?.end){
			return source;
		}
		const xml=new DOMParser().parseFromString(source,"application/xml");
		const data=OfficeLawXmlExcerpt._child(xml.documentElement,"textdaten");
		const body=null === data ? null
			:OfficeLawXmlExcerpt._child(data,"text");
		const content=null === body ? null
			:OfficeLawXmlExcerpt._child(body,"content");
		if(null === content){
			throw new Error("Citation XML has no text content.");
		}
		const paragraphs=Array.from(content.children).filter(
			OfficeLawXmlExcerpt._isParagraph
		);
		const nodes=0<paragraphs.length ? paragraphs
			:Array.from(content.childNodes);
		const positions=new Map<Node,TextPosition>();
		// Match normalized citation offsets without flattening XML ancestors.
		let offset:size_t=0;
		for(const node of nodes){
			offset=OfficeLawXmlExcerpt._index(node,offset,positions);
		}
		const compact=OfficeLawXmlExcerpt._compact(text);
		const actual=nodes.map(OfficeLawXmlExcerpt._nodeText).join("");
		if(compact !== OfficeLawXmlExcerpt._compact(actual)){
			throw new Error("Citation text does not match its source XML.");
		}
		const fragment=xml.createDocumentFragment();
		for(const scope of scopes){
			const start=OfficeLawXmlExcerpt._compact(
				text.slice(0,scope.start)
			).length;
			const end=OfficeLawXmlExcerpt._compact(
				text.slice(0,scope.end)
			).length;
			for(const node of nodes){
				const copy=OfficeLawXmlExcerpt._copy(
					node,start,end,positions
				);
				if(null !== copy){
					fragment.appendChild(copy);
				}
			}
		}
		content.replaceChildren(fragment);
		return new XMLSerializer().serializeToString(xml);
	}

	protected static _child(parent:Element,name:utf8_t):Element|null{
		for(const child of Array.from(parent.children)){
			if(name === child.tagName.toLowerCase()){
				return child;
			}
		}
		return null;
	}

	protected static _isParagraph(element:Element):bool_t{
		return "p" === element.tagName.toLowerCase();
	}

	protected static _nodeText(node:Node):utf8_t{
		if(Node.COMMENT_NODE === node.nodeType
			|| Node.PROCESSING_INSTRUCTION_NODE === node.nodeType){
			return "";
		}
		return node.textContent ?? "";
	}

	protected static _compact(text:utf8_t):utf8_t{
		return text.replace(/\s/g,"");
	}

	protected static _index(
		node:Node,start:size_t,positions:Map<Node,TextPosition>
	):size_t{
		let end=start;
		if(Node.TEXT_NODE === node.nodeType
			|| Node.CDATA_SECTION_NODE === node.nodeType){
			end+=OfficeLawXmlExcerpt._compact(node.nodeValue ?? "").length;
		}
		else{
			for(const child of Array.from(node.childNodes)){
				end=OfficeLawXmlExcerpt._index(child,end,positions);
			}
		}
		positions.set(node,{start,end});
		return end;
	}

	protected static _copy(
		node:Node,start:size_t,end:size_t,
		positions:ReadonlyMap<Node,TextPosition>
	):Node|null{
		const position=positions.get(node);
		if(undefined === position){
			throw new Error("Citation XML text position is missing.");
		}
		if(position.start > end || position.end < start){
			return null;
		}
		if(Node.TEXT_NODE === node.nodeType
			|| Node.CDATA_SECTION_NODE === node.nodeType){
			const text=node.nodeValue ?? "";
			let offset=position.start;
			let value:utf8_t="";
			for(const character of text){
				if(/\s/.test(character)){
					if(start<offset && offset<end){
						value+=character;
					}
				}
				else{
					if(start <= offset && offset<end){
						value+=character;
					}
					offset+=character.length;
				}
			}
			return 0 === value.length ? null
				:node.ownerDocument!.createTextNode(value);
		}
		if(!(node instanceof Element)){
			return null;
		}
		const copy=node.cloneNode(false);
		for(const child of Array.from(node.childNodes)){
			const selected=OfficeLawXmlExcerpt._copy(
				child,start,end,positions
			);
			if(null !== selected){
				copy.appendChild(selected);
			}
		}
		if(copy.hasChildNodes()
			|| start<position.start && position.end<end
				&& !node.hasChildNodes()){
			return copy;
		}
		return null;
	}
};
