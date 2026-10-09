import { Component } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { OfficeLawXml } from "../../law/xml";

type XmlDocument=ReturnType<typeof OfficeLawXml.parseDocument>;
type XmlNode=NonNullable<ReturnType<XmlDocument["childNodes"]["item"]>>;
type XmlElement=NonNullable<XmlDocument["documentElement"]>;

interface Props{
	xml:string;
	disabled:boolean;
	onChange:(xml:string)=>void;
};

interface State{
	selectedPath:number[];
	elementName:string;
	attributeName:string;
	attributeValue:string;
	error:string|null;
};

export class XmlTreeEditor extends Component<Props,State>{
	constructor(props:Props){
		super(props);
		this.state={
			selectedPath:[],elementName:"P",
			attributeName:"",attributeValue:"",error:null
		};
	}

	protected _node(document:XmlDocument,path:number[]):XmlNode{
		let node:XmlNode=document.documentElement!;
		for(const index of path){
			const child=node.childNodes.item(index);
			if(null === child){
				throw new Error("Bitte einen vorhandenen XML-Knoten auswählen.");
			}
			node=child;
		}
		return node;
	}

	protected _select(path:number[]):void{
		this.setState({selectedPath:path,error:null});
	}

	protected _field(
		field:"elementName"|"attributeName"|"attributeValue",
		event:ChangeEvent<HTMLInputElement>
	):void{
		const value=event.target.value;
		if("elementName" === field){
			this.setState({elementName:value});
		}
		else if("attributeName" === field){
			this.setState({attributeName:value});
		}
		else{
			this.setState({attributeValue:value});
		}
	}

	protected _validName(name:string):void{
		if(!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)){
			throw new Error("Bitte einen gültigen XML-Namen eingeben.");
		}
	}

	protected _change(
		action:"add"|"remove"|"text"|"attribute"|"removeAttribute",
		value:string=""
	):void{
		if(this.props.disabled){
			return;
		}
		try{
			const document=OfficeLawXml.parseDocument(this.props.xml);
			const node=this._node(document,this.state.selectedPath);
			if("remove" === action){
				if(0 === this.state.selectedPath.length){
					throw new Error("Das Wurzelelement darf nicht entfernt werden.");
				}
				node.parentNode!.removeChild(node);
				this.setState({
					selectedPath:this.state.selectedPath.slice(0,-1)
				});
			}
			else if("text" === action){
				if(3 !== node.nodeType && 4 !== node.nodeType
					&& 8 !== node.nodeType){
					throw new Error("Bitte einen Text- oder Kommentarknoten wählen.");
				}
				node.nodeValue=value;
			}
			else{
				if(1 !== node.nodeType){
					throw new Error("Bitte ein XML-Element auswählen.");
				}
				const element=node as XmlElement;
				if("add" === action){
					this._validName(this.state.elementName);
					const child=document.createElement(this.state.elementName);
					element.appendChild(child);
				}
				else if("attribute" === action){
					this._validName(this.state.attributeName);
					element.setAttribute(
						this.state.attributeName,this.state.attributeValue
					);
				}
				else{
					element.removeAttribute(value);
				}
			}
			const xml=OfficeLawXml.serialize(document);
			OfficeLawXml.parseDocument(xml);
			this.setState({error:null});
			this.props.onChange(xml);
		}
		catch(error){
			this.setState({
				error:error instanceof Error ? error.message
					:"XML-Knoten konnte nicht geändert werden."
			});
		}
	}

	protected _addText():void{
		if(this.props.disabled){
			return;
		}
		try{
			const document=OfficeLawXml.parseDocument(this.props.xml);
			const node=this._node(document,this.state.selectedPath);
			if(1 !== node.nodeType){
				throw new Error("Bitte ein XML-Element auswählen.");
			}
			const index=node.childNodes.length;
			node.appendChild(document.createTextNode("Text"));
			this.props.onChange(OfficeLawXml.serialize(document));
			this.setState({
				selectedPath:[...this.state.selectedPath,index],error:null
			});
		}
		catch(error){
			this.setState({
				error:error instanceof Error ? error.message
					:"Text konnte nicht hinzugefügt werden."
			});
		}
	}

	protected _text(event:ChangeEvent<HTMLTextAreaElement>):void{
		this._change("text",event.target.value);
	}

	protected _renderNode(node:XmlNode,path:number[]):ReactNode{
		const children:ReactNode[]=[];
		for(let index=0;index<node.childNodes.length;index++){
			const child=node.childNodes.item(index);
			if(null !== child){
				children.push(this._renderNode(child,[...path,index]));
			}
		}
		const selected=JSON.stringify(path)
			=== JSON.stringify(this.state.selectedPath);
		const label=1 === node.nodeType ? `<${node.nodeName}>`
			:8 === node.nodeType ? `Kommentar: ${node.nodeValue ?? ""}`
				:`Text: ${node.nodeValue ?? ""}`;
		return(
			<li key={path.join(".") || "root"}>
				<button type="button" className="xml-tree-node"
					aria-pressed={selected} disabled={this.props.disabled}
					onClick={this._select.bind(this,path)}>
					{label.slice(0,100)}
				</button>
				{children.length>0 && <ul>{children}</ul>}
			</li>
		);
	}

	protected _attribute(node:XmlElement,index:number):ReactNode{
		const attribute=node.attributes.item(index)!;
		return(
			<li key={attribute.name}>
				<code>{attribute.name}="{attribute.value}"</code>
				<button type="button" className="editor-button"
					onClick={this._change.bind(
						this,"removeAttribute",attribute.name
					)}>
					Attribut entfernen
				</button>
			</li>
		);
	}

	public render():ReactNode{
		let document:XmlDocument;
		let node:XmlNode;
		try{
			document=OfficeLawXml.parseDocument(this.props.xml);
			node=this._node(document,this.state.selectedPath);
		}
		catch(error){
			return <p className="editor-error" role="alert">
				{error instanceof Error ? error.message : "Ungültiges XML."}
				{" "}Bitte im Quelltext korrigieren oder
				<button type="button" className="editor-button"
					onClick={this._select.bind(this,[])}>
					Wurzel auswählen
				</button>
			</p>;
		}
		const attributes:ReactNode[]=[];
		if(1 === node.nodeType){
			const element=node as XmlElement;
			for(let index=0;index<element.attributes.length;index++){
				attributes.push(this._attribute(element,index));
			}
		}
		return(
			<div className="xml-tree-layout">
				<nav className="xml-tree" aria-label="XML-Struktur">
					<ul>{this._renderNode(document.documentElement!,[])}</ul>
				</nav>
				<fieldset disabled={this.props.disabled}
					className="management-fields">
					<strong>Ausgewählt: {node.nodeName}</strong>
					{1 === node.nodeType ? (
						<>
							<ul>{attributes}</ul>
							<label>Attributname
								<input value={this.state.attributeName}
									onChange={this._field.bind(
										this,"attributeName"
									)}/>
							</label>
							<label>Attributwert
								<input value={this.state.attributeValue}
									onChange={this._field.bind(
										this,"attributeValue"
									)}/>
							</label>
							<button type="button" className="editor-button"
								onClick={this._change.bind(this,"attribute","")}>
								Attribut setzen / ändern
							</button>
							<label>Neues Kindelement
								<input value={this.state.elementName}
									onChange={this._field.bind(
										this,"elementName"
									)}/>
							</label>
							<button type="button" className="editor-button"
								onClick={this._change.bind(this,"add","")}>
								Element hinzufügen
							</button>
							<button type="button" className="editor-button"
								onClick={this._addText.bind(this)}>
								Textknoten hinzufügen
							</button>
						</>
					) : (
						<label>Knoteninhalt
							<textarea value={node.nodeValue ?? ""}
								onChange={this._text.bind(this)}/>
						</label>
					)}
					<button type="button" className="editor-button"
						disabled={0 === this.state.selectedPath.length}
						onClick={this._change.bind(this,"remove","")}>
						Knoten entfernen
					</button>
					{null !== this.state.error && (
						<p className="editor-error" role="alert">
							{this.state.error}
						</p>
					)}
				</fieldset>
			</div>
		);
	}
};
