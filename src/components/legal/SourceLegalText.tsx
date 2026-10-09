import { Component, createRef } from "react";
import type { ContextType, ReactNode, ReactPortal } from "react";
import { createPortal } from "react-dom";
import { OfficeLawXml } from "../../law/xml";
import { OfficeLawDiff } from "../../law/diff";
import { OfficeLawXmlExcerpt } from "../../law/xml-excerpt";
import type { OfficeLawCitationSpan } from "../../law/citations";
import { OfficeLawCitations } from "../../law/citations";
import { CitationContext } from "../citations/CitationContext";
import CitationPreview from "../citations/CitationPreview";

interface Props{
	source:utf8_t;
	container:"text"|"fussnoten";
	diffOriginal?:utf8_t|null;
	diffRemoved?:bool_t;
	excerptScopes?:readonly OfficeLawCitationSpan[];
};

interface State{
	portals:ReactPortal[];
	error:utf8_t|null;
};

const CONTENT_TAGS=new Set([
	"p","dl","dt","dd","la","b","strong","i","em","u","sup","sub","br",
	"pre","ul","ol","li","table","thead","tbody","tfoot","tr","td","th",
	"colgroup","col","caption","a","span","div","hr","tgroup","colspec",
	"row","entry","noindex","title"
]);
const CONTENT_ATTRIBUTES=new Set([
	"type","size","font","align","valign","colspan","rowspan","width",
	"height","border","cellpadding","cellspacing","xml:space",
	"office-law-text","title","frame","pgwide","tocentry","char","charoff",
	"cols","colsep","rowsep","colname","colnum","colwidth","namest",
	"nameend","morerows","colspan","rowspan"
]);

export default class SourceLegalText extends Component<Props,State>{
	public static contextType=CitationContext;
	declare context:ContextType<typeof CitationContext>;
	protected readonly _host:ReturnType<typeof createRef<HTMLDivElement>>;
	protected _context:ContextType<typeof CitationContext>;

	constructor(props:Props){
		super(props);
		this._host=createRef<HTMLDivElement>();
		this._context=null;
		this.state={portals:[],error:null};
	}

	public componentDidMount():void{
		this._updateContent();
	}

	public componentDidUpdate(previous:Props):void{
		if(previous.source !== this.props.source
			|| previous.container !== this.props.container
			|| previous.diffOriginal !== this.props.diffOriginal
			|| previous.diffRemoved !== this.props.diffRemoved
			|| previous.excerptScopes !== this.props.excerptScopes
			|| this._context !== this.context){
			this._updateContent();
		}
	}

	public componentWillUnmount():void{
		this.destructor();
	}

	public destructor():void{
		try{
			this._host.current?.replaceChildren();
			this._context=null;
		}
		catch(UNUSED_e){}
	}

	protected _updateContent():void{
		this._context=this.context;
		const host=this._host.current;
		if(null === host){
			throw new Error("Law content host is missing.");
		}
		const portals:ReactPortal[]=[];
		try{
			const original=this.props.diffOriginal;
			let source=undefined === original ? this.props.source
				:OfficeLawDiff.createXmlDiff(
					original,this.props.diffRemoved ? null:this.props.source,
					this.props.container
				);
			if(undefined !== this.props.excerptScopes){
				source=OfficeLawXmlExcerpt.create(
					source,this.props.excerptScopes
				);
			}
			OfficeLawXml.parseDocument(source);
			const xml=new DOMParser().parseFromString(
				source,"application/xml"
			);
			if(0<xml.getElementsByTagName("parsererror").length){
				throw new Error("Invalid law content XML.");
			}
			const data=this._child(xml.documentElement,"textdaten");
			const container=null === data ? null
				:this._child(data,this.props.container);
			const content=null === container ? null
				:this._child(container,"content");
			const fragment=document.createDocumentFragment();
			if(null !== content){
				for(const node of Array.from(content.childNodes)){
					this._appendNode(node,fragment,portals);
				}
			}
			// Build DOM directly: HTML parsing would split a source P around DL.
			host.replaceChildren(fragment);
			this.setState({portals,error:null});
		}
		catch(error){
			host.replaceChildren();
			this.setState({
				portals:[],error:error instanceof Error ? error.message
					:"Gesetzestext konnte nicht dargestellt werden."
			});
		}
	}

	protected _child(parent:Element,name:utf8_t):Element|null{
		for(const child of Array.from(parent.children)){
			if(name === child.tagName.toLowerCase()){
				return child;
			}
		}
		return null;
	}

	protected _appendNode(
		node:Node,parent:Node,portals:ReactPortal[]
	):void{
		if(Node.TEXT_NODE === node.nodeType
			|| Node.CDATA_SECTION_NODE === node.nodeType){
			this._appendText(node.nodeValue ?? "",parent,portals);
			return;
		}
		if(!(node instanceof Element)){
			return;
		}
		const tag=node.tagName.toLowerCase();
		if("diff" !== tag && !CONTENT_TAGS.has(tag)){
			throw new Error(`Unsupported law content tag: ${tag}`);
		}
		const element=document.createElement("diff" === tag ? "span":tag);
		if(undefined !== this.props.diffOriginal){
			const kind=node.getAttribute("diff");
			if("added" === kind || "removed" === kind){
				element.setAttribute("diff",kind);
				element.classList.add(`legal-diff-${kind}`);
			}
		}
		for(const attribute of Array.from(node.attributes)){
			const name=attribute.name.toLowerCase();
			if(CONTENT_ATTRIBUTES.has(name)){
				element.setAttribute(name,attribute.value);
			}
		}
		for(const child of Array.from(node.childNodes)){
			this._appendNode(child,element,portals);
		}
		parent.appendChild(element);
	}

	protected _appendText(
		text:utf8_t,parent:Node,portals:ReactPortal[]
	):void{
		const context=this.context;
		if(null === context){
			parent.appendChild(document.createTextNode(text));
			return;
		}
		const references=OfficeLawCitations.findOfficeLawCitations(
			text,context.sources
		);
		let position:size_t=0;
		for(const reference of references){
			parent.appendChild(document.createTextNode(
				text.slice(position,reference.start)
			));
			const anchor=document.createElement("span");
			parent.appendChild(anchor);
			portals.push(createPortal(
				<CitationPreview reference={reference} context={context}/>,
				anchor
			));
			position=reference.end;
		}
		parent.appendChild(document.createTextNode(text.slice(position)));
	}

	public render():ReactNode{
		return <>
			<div className="source-legal-text" ref={this._host}/>
			{this.state.portals}
			{null !== this.state.error && (
				<p className="editor-error" role="alert">
					{this.state.error}
				</p>
			)}
		</>;
	}
};
