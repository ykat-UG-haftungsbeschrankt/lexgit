import { Component } from "react";
import type { ReactNode, MouseEvent } from "react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { OfficeLawTiptapXml } from "../../law/tiptap-xml";
import {
	LegalXmlNodes,XmlIdentity,OfficeLegalXmlCommands
} from "../../tiptap/legal-xml";

interface Props{
	xml:utf8_t;
	disabled:bool_t;
	onChange:(xml:utf8_t)=>void;
	onError:(error:utf8_t|null)=>void;
};

interface State{
	error:utf8_t|null;
};

type Action="bold"|"italic"|"paragraph"|"bullet"|"ordered"|"list"
	|"add"|"before"|"remove"|"up"|"down"|"indent"|"outdent"|"undo"|"redo";

const ACTIONS:[Action,utf8_t][]=[
	["bold","Fett"],["italic","Kursiv"],["paragraph","Absatz"],
	["bullet","Aufzählung"],["ordered","Nummerierte Liste"],
	["list","Juristische Liste"],["before","Davor einfügen"],
	["add","Neuer Eintrag"],["remove","Eintrag löschen"],
	["up","Nach oben"],["down","Nach unten"],
	["indent","Einrücken"],["outdent","Ausrücken"],
	["undo","Rückgängig"],["redo","Wiederholen"]
];

export class XmlVisualEditor extends Component<Props,State>{
	protected _holder:HTMLDivElement|null;
	protected _editor:Editor|null;
	protected _codec:OfficeLawTiptapXml|null;
	protected _lastXml:utf8_t|null;

	constructor(props:Props){
		super(props);
		this._holder=null;
		this._editor=null;
		this._codec=null;
		this._lastXml=null;
		this.state={error:null};
	}

	public componentDidMount():void{
		this._initialize();
	}

	public componentDidUpdate(previous:Props):void{
		if(previous.xml !== this.props.xml
			&& this._lastXml !== this.props.xml){
			this.destructor();
			this._initialize();
		}
		if(previous.disabled !== this.props.disabled){
			this._editor?.setEditable(!this.props.disabled);
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
		try{
			this._codec=new OfficeLawTiptapXml(this.props.xml);
			this._lastXml=this.props.xml;
			this._editor=new Editor({
				element:this._holder,
				extensions:[
					StarterKit.configure({
						heading:false,blockquote:false,code:false,
						codeBlock:false,strike:false,horizontalRule:false,
						link:false,underline:false,trailingNode:false
					}),
					...LegalXmlNodes,XmlIdentity
				],
				content:this._codec.load(),
				editable:!this.props.disabled,
				editorProps:{attributes:{
					"aria-label":"Tiptap Vorschrifteninhalt",
					role:"textbox","aria-multiline":"true"
				}},
				onUpdate:this._onChange.bind(this)
			});
			this._codec.acceptInitial(this._editor.getJSON());
			this.props.onError(null);
			this.setState({error:null});
		}
		catch(error){
			this._fail(error);
		}
	}

	protected _fail(error:unknown):void{
		const message=error instanceof Error ? error.message
			:"Tiptap konnte den Inhalt nicht verarbeiten.";
		this.setState({error:message});
		this.props.onError(message);
	}

	protected _onChange():void{
		if(this.props.disabled){
			return;
		}
		try{
			this._save();
		}
		catch(error){
			this._fail(error);
		}
	}

	protected _save():utf8_t{
		if(null === this._editor || null === this._codec){
			throw new Error("Tiptap ist noch nicht bereit.");
		}
		const xml=this._codec.update(this._editor.getJSON());
		this._lastXml=xml;
		this.props.onChange(xml);
		this.props.onError(null);
		this.setState({error:null});
		return xml;
	}

	public async flush():Promise<utf8_t>{
		return this._save();
	}

	protected _keepSelection(event:MouseEvent<HTMLButtonElement>):void{
		event.preventDefault();
	}

	protected _action(action:Action):void{
		const editor=this._editor;
		if(null === editor || this.props.disabled){
			return;
		}
		try{
			editor.commands.focus();
			switch(action){
				case "bold":editor.commands.toggleBold();break;
				case "italic":editor.commands.toggleItalic();break;
				case "paragraph":editor.commands.insertContent({
					type:"paragraph"
				});break;
				case "bullet":editor.commands.toggleBulletList();break;
				case "ordered":editor.commands.toggleOrderedList();break;
				case "list":OfficeLegalXmlCommands.addList(editor);break;
				case "undo":editor.commands.undo();break;
				case "redo":editor.commands.redo();break;
				default:OfficeLegalXmlCommands.run(editor,action);
			}
		}
		catch(error){
			this._fail(error);
		}
	}

	public destructor():void{
		try{
			this._editor?.destroy();
			this._editor=null;
			this._codec?.destructor();
			this._codec=null;
		}
		catch(UNUSED_e){}
	}

	protected _button(item:[Action,utf8_t]):ReactNode{
		const [action,label]=item;
		return(
			<button key={action} type="button"
				className="editor-button" disabled={this.props.disabled}
				onMouseDown={this._keepSelection.bind(this)}
				onClick={this._action.bind(this,action)}>
				{label}
			</button>
		);
	}

	public render():ReactNode{
		return(
			<div>
				<p className="management-note">
					Tiptap: Text markieren für Fett/Kursiv. Juristische
					DT/DD-Paare über die Eintragsaktionen bearbeiten;
					Tab/Umschalt+Tab zum Ein-/Ausrücken. Nummerierung
					bleibt erhalten und ist direkt bearbeitbar.
					Geschützte XML-Blöcke im Baum/Quelltext bearbeiten.
					Metadaten und Fußnoten bleiben unverändert.
				</p>
				<div className="management-actions"
					role="toolbar" aria-label="Text und Aufzählungen">
					{ACTIONS.map(this._button.bind(this))}
				</div>
				<div ref={this._setHolder.bind(this)}
					className="xml-visual-content tiptap-content"/>
				{null !== this.state.error && (
					<p className="editor-error" role="alert">
						{this.state.error}
					</p>
				)}
			</div>
		);
	}
};
