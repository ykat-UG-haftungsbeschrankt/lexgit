import { Extension, Node } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { NodeSelection,TextSelection } from "@tiptap/pm/state";

const LEGAL_NAMES:Record<utf8_t,utf8_t>={
	P:"legalParagraph",DL:"legalDescriptionList",DT:"legalTerm",
	DD:"legalDefinition",LA:"legalLabel",text:"legalText"
};

export { LEGAL_NAMES };

function legalNode(
	name:utf8_t,content:utf8_t,group:utf8_t,tag:utf8_t
):Node{
	return Node.create({
		name,content,group,isolating:"legalText" !== name,
		addAttributes(){
			return{
				path:{default:null,rendered:false},
				field:{default:null,rendered:false}
			};
		},
		parseHTML(){
			return[{tag:`div[data-legal-node="${name}"]`}];
		},
		renderHTML(){
			return["div",{
				"data-legal-node":name,
				class:`tiptap-legal-${tag.toLowerCase()}`
			},0];
		}
	});
}

export const LegalXmlNodes=[
	legalNode("legalParagraph","legalPart*","block legalPart","P"),
	legalNode("legalDescriptionList","legalEntry*",
		"block legalPart","DL"),
	legalNode("legalEntry","legalTerm legalDefinition","","entry"),
	legalNode("legalTerm","legalPart*","","DT"),
	legalNode("legalDefinition","legalPart*","","DD"),
	legalNode("legalLabel","legalPart*","legalPart","LA"),
	legalNode("legalText","inline*","legalPart","text"),
	Node.create({
		name:"protectedXml",group:"block",atom:true,
		selectable:false,draggable:false,
		addAttributes(){
			return{
				xmlId:{default:null,rendered:false},
				label:{default:"XML",rendered:false}
			};
		},
		renderHTML({node}){
			return["div",{
				class:"tiptap-protected",contenteditable:"false"
			},`Geschützter XML-Block: ${node.attrs.label}`];
		}
	})
];

export const XmlIdentity=Extension.create({
	name:"xmlIdentity",
	addGlobalAttributes(){
		return[{
			types:[
				"paragraph","bulletList","orderedList",
				"legalParagraph","legalDescriptionList"
			],
			attributes:{xmlId:{default:null,rendered:false}}
		}];
	},
	addProseMirrorPlugins(){
		return[new Plugin({
			filterTransaction(transaction,state){
				const before:utf8_t[]=[];
				const after:utf8_t[]=[];
				state.doc.descendants((node)=>{
					if("protectedXml" === node.type.name){
						before.push(node.attrs.xmlId);
					}
				});
				transaction.doc.descendants((node)=>{
					if("protectedXml" === node.type.name){
						after.push(node.attrs.xmlId);
					}
				});
				return JSON.stringify(before) === JSON.stringify(after);
			},
			appendTransaction(transactions,UNUSED_old,state){
				if(!transactions.some((transaction)=>{
					return transaction.docChanged;
				})){
					return null;
				}
				const seen=new Set<utf8_t>();
				const transaction=state.tr;
				state.doc.forEach((node,position)=>{
					const id=node.attrs.xmlId;
					if(null === id || undefined === id){
						return;
					}
					if(seen.has(id)){
						transaction.setNodeMarkup(position,undefined,{
							...node.attrs,xmlId:null
						});
					}
					seen.add(id);
				});
				state.doc.forEach((block,offset)=>{
					const paths=new Set<utf8_t>();
					const fields=new Set<size_t>();
					block.descendants((node,position)=>{
						const path=node.attrs.path;
						const field=node.attrs.field;
						const key=JSON.stringify(path);
						if(null !== path && undefined !== path){
							if(paths.has(key)){
								transaction.setNodeMarkup(
									offset+position+1,undefined,{
										...node.attrs,path:null,
										field:null
									}
								);
							}
							paths.add(key);
						}
						if(null !== field && undefined !== field){
							if(fields.has(field)){
								transaction.setNodeMarkup(
									offset+position+1,undefined,{
										...node.attrs,field:null
									}
								);
							}
							fields.add(field);
						}
					});
				});
				return transaction.docChanged ? transaction:null;
			}
		})];
	},
	addKeyboardShortcuts(){
		return{
			Enter:()=>{
				if(this.editor.isActive("legalText")){
					return this.editor.commands.setHardBreak();
				}
				return false;
			},
			Tab:()=>{
				return OfficeLegalXmlCommands.run(this.editor,"indent");
			},
			"Shift-Tab":()=>{
				return OfficeLegalXmlCommands.run(this.editor,"outdent");
			}
		};
	}
});

type LegalAction="add"|"before"|"remove"|"up"|"down"|"indent"|"outdent";

export class OfficeLegalXmlCommands{
	public destructor():void{}

	public static newEntry():JSONContent{
		return{
			type:"legalEntry",content:[
				{type:"legalTerm",content:[{type:"legalText"}]},
				{type:"legalDefinition",content:[
					{type:"legalLabel",content:[{type:"legalText"}]}
				]}
			]
		};
	}

	public static addList(editor:Editor):bool_t{
		return editor.commands.insertContent({
			type:"legalDescriptionList",
			content:[OfficeLegalXmlCommands.newEntry()]
		});
	}

	public static run(editor:Editor,action:LegalAction):bool_t{
		if(!editor.isEditable){
			return false;
		}
		const {state}=editor;
		const {$from}=state.selection;
		let depth=$from.depth;
		while(depth>0 && "legalEntry" !== $from.node(depth).type.name){
			depth--;
		}
		if(0 === depth){
			return OfficeLegalXmlCommands._editEmptyList(editor,action);
		}
		const entry=$from.node(depth);
		const list=$from.node(depth-1);
		const index=$from.index(depth-1);
		const start=$from.before(depth);
		const transaction=state.tr;
		let focus=start;
		if("add" === action || "before" === action){
			focus="before" === action ? start:start+entry.nodeSize;
			transaction.insert(focus,state.schema.nodeFromJSON(
				OfficeLegalXmlCommands.newEntry()
			));
		}
		else if("remove" === action){
			transaction.delete(start,start+entry.nodeSize);
			if(1 === list.childCount){
				transaction.setSelection(NodeSelection.create(
					transaction.doc,$from.before(depth-1)
				));
				editor.view.dispatch(transaction.scrollIntoView());
				editor.commands.focus();
				return true;
			}
		}
		else if("up" === action || "down" === action){
			const adjacentIndex=index+("up" === action ? -1:1);
			if(adjacentIndex<0 || adjacentIndex>=list.childCount){
				return false;
			}
			const adjacent=list.child(adjacentIndex);
			const from="up" === action ? start-adjacent.nodeSize:start;
			const nodes="up" === action
				?[entry,adjacent]:[adjacent,entry];
			transaction.replaceWith(
				from,from+entry.nodeSize+adjacent.nodeSize,nodes
			);
			focus="up" === action ? from:from+adjacent.nodeSize;
		}
		else if("indent" === action){
			if(0 === index){
				return false;
			}
			const previous=list.child(index-1);
			const previousStart=start-previous.nodeSize;
			const definition=previous.child(1);
			let container=definition;
			let containerStart=previousStart+previous.child(0).nodeSize+2;
			if(0 < definition.childCount
				&& "legalLabel" === definition.lastChild?.type.name){
				container=definition.lastChild;
				containerStart+=definition.content.size-container.nodeSize+1;
			}
			let insert=containerStart+container.content.size;
			let nested:ProseMirrorNode;
			if("legalDescriptionList" === container.lastChild?.type.name){
				nested=container.lastChild;
				insert--;
				transaction.delete(start,start+entry.nodeSize);
				transaction.insert(insert,entry);
				focus=insert;
			}
			else{
				const type=state.schema.nodes.legalDescriptionList;
				if(undefined === type){
					return false;
				}
				nested=type.create(null,entry);
				transaction.delete(start,start+entry.nodeSize);
				transaction.insert(insert,nested);
				focus=insert+1;
			}
		}
		else{
			let outerDepth=depth-2;
			while(outerDepth>0
				&& "legalEntry" !== $from.node(outerDepth).type.name){
				outerDepth--;
			}
			if(0 === outerDepth){
				return false;
			}
			const insert=$from.after(outerDepth);
			if(1 === list.childCount){
				transaction.delete(
					$from.before(depth-1),$from.after(depth-1)
				);
			}
			else{
				transaction.delete(start,start+entry.nodeSize);
			}
			focus=transaction.mapping.map(insert);
			transaction.insert(focus,entry);
		}
		const position=Math.min(
			transaction.doc.content.size,focus+2
		);
		transaction.setSelection(TextSelection.near(
			transaction.doc.resolve(position)
		));
		editor.view.dispatch(transaction.scrollIntoView());
		editor.commands.focus();
		return true;
	}

	protected static _editEmptyList(
		editor:Editor,action:LegalAction
	):bool_t{
		const {state}=editor;
		const selection=state.selection;
		if(!(selection instanceof NodeSelection)
			|| "legalDescriptionList" !== selection.node.type.name
			|| 0 !== selection.node.childCount
			|| !["add","before"].includes(action)){
			return false;
		}
		const position=selection.from+1;
		const transaction=state.tr.insert(
			position,state.schema.nodeFromJSON(
				OfficeLegalXmlCommands.newEntry()
			)
		);
		transaction.setSelection(TextSelection.near(
			transaction.doc.resolve(position+2)
		));
		editor.view.dispatch(transaction.scrollIntoView());
		editor.commands.focus();
		return true;
	}
};
