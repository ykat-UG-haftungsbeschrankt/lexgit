import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { OfficeLawTiptapXml } from "../src/law/tiptap-xml";
import { OfficeLawClient } from "../src/law/client";
import { XmlEditorDialog } from
	"../src/components/management/XmlEditorDialog";
import {
	LegalXmlNodes,XmlIdentity,OfficeLegalXmlCommands
} from "../src/tiptap/legal-xml";

function check(condition:bool_t,message:utf8_t):void{
	if(!condition){
		throw new Error(message);
	}
}

const SOURCE='<norm doknr="TEST"><metadaten><enbez>1</enbez>'
	+'</metadaten><textdaten><text><Content>\n'
	+"<P keep='yes'>Intro <B>bold</B><DL Type='arabic'>"
	+'<DT>1.</DT><DD><LA Size="normal">First</LA></DD>'
	+'<DT>2.</DT><DD><LA>Second</LA></DD>'
	+'<DT>3.</DT><DD><LA>Third</LA></DD>'
	+'</DL>Tail</P><P>Simple</P>'
	+'<TABLE><TR><TD>Protected</TD></TR></TABLE>'
	+'</Content></text><fussnoten>Keep</fussnoten></textdaten></norm>';

function extensions(){
	return[
		StarterKit.configure({
			heading:false,blockquote:false,code:false,codeBlock:false,
			strike:false,horizontalRule:false,link:false,underline:false,
			trailingNode:false
		}),
		...LegalXmlNodes,XmlIdentity
	];
}

function select(editor:Editor,label:utf8_t):void{
	let selected=-1;
	editor.state.doc.descendants((node,position)=>{
		if("legalTerm" === node.type.name && label === node.textContent){
			selected=position+2;
		}
	});
	check(0 <= selected,`Entry ${label} missing`);
	editor.commands.setTextSelection(selected);
}

export function testTiptapLegalXml():utf8_t[]{
	const holder=document.createElement("div");
	document.body.appendChild(holder);
	const codec=new OfficeLawTiptapXml(SOURCE);
	const editor=new Editor({
		element:holder,extensions:extensions(),content:codec.load()
	});
	codec.acceptInitial(editor.getJSON());
	const xml=():XMLDocument=>{
		return new DOMParser().parseFromString(
			codec.update(editor.getJSON()),"application/xml"
		);
	};
	const action=(name:Parameters<typeof OfficeLegalXmlCommands.run>[1])=>{
		check(OfficeLegalXmlCommands.run(editor,name),`${name} failed`);
		xml();
	};
	try{
		check(SOURCE === codec.update(editor.getJSON()),
			"Tiptap no-edit output must be byte-identical");
		check(null === holder.querySelector("p dl"),
			"Mixed XML must not render invalid paragraph HTML");
		select(editor,"1.");
		check(!OfficeLegalXmlCommands.run(editor,"indent"),
			"First entry must not indent");
		select(editor,"2.");
		editor.view.dom.dispatchEvent(new KeyboardEvent("keydown",{
			key:"Tab",code:"Tab",keyCode:9,
			bubbles:true,cancelable:true
		}));
		check("2." === xml().querySelector("DD LA DL DT")?.textContent,
			"Indent must move the pair into the preceding LA");
		check("normal" === xml().querySelector("DD LA")
			?.getAttribute("Size"),"Indent must retain attributes");
		action("outdent");
		check(3 === xml().querySelector("P > DL")?.children.length/2,
			"Outdent must restore three pairs");
		select(editor,"2.");
		action("up");
		check("2." === xml().querySelector("P > DL > DT")?.textContent,
			"Move up must keep DT/DD paired");
		action("down");
		check("1." === xml().querySelector("P > DL > DT")?.textContent,
			"Move down must restore order");
		check(SOURCE === codec.update(editor.getJSON()),
			"Restoring the original entry structure must restore raw XML");
		action("before");
		check(4 === xml().querySelector("P > DL")?.children.length/2,
			"Insert before must create a pair");
		editor.commands.insertContent("new");
		check(xml().querySelector("DT")?.parentElement?.textContent
			?.includes("new") ?? false,"New term must be editable");
		action("remove");
		check(3 === xml().querySelector("P > DL")?.children.length/2,
			"Remove must delete both DT and DD");
		select(editor,"3.");
		action("add");
		editor.commands.insertContent("4.");
		check(4 === xml().querySelector("P > DL")?.children.length/2,
			"Add must append a pair");
		action("remove");
		let textPosition=-1;
		editor.state.doc.descendants((node,position)=>{
			if("legalText" === node.type.name
				&& "Second" === node.textContent){
				textPosition=position+1;
			}
		});
		editor.commands.setTextSelection({
			from:textPosition,to:textPosition+6
		});
		editor.commands.toggleBold();
		editor.commands.toggleItalic();
		check("Second" === xml().querySelector("LA B I")?.textContent
			|| "Second" === xml().querySelector("LA I B")?.textContent,
			"Bold and italic must serialize to legal inline XML");
		editor.commands.setTextSelection(textPosition+6);
		editor.view.dom.dispatchEvent(new KeyboardEvent("keydown",{
			key:"Enter",code:"Enter",keyCode:13,
			bubbles:true,cancelable:true
		}));
		check(1 === xml().querySelectorAll("LA BR").length,
			"Legal Enter must insert a serializable line break");
		check("yes" === xml().querySelector("P")?.getAttribute("keep"),
			"Outer attributes must survive");
		check(codec.update(editor.getJSON()).includes(
			"<TABLE><TR><TD>Protected</TD></TR></TABLE>"
		),"Unsupported block must stay byte-identical");
		let protectedStart=0;
		editor.state.doc.forEach((node,position)=>{
			if("protectedXml" === node.type.name){
				protectedStart=position;
			}
		});
		editor.view.dispatch(editor.state.tr.delete(
			protectedStart,protectedStart+1
		));
		check(1 === xml().getElementsByTagName("TABLE").length,
			"Protected XML must resist deletion");
		editor.commands.setTextSelection(1);
		check(OfficeLegalXmlCommands.addList(editor),
			"A new legal list must be insertable");
		check(2 === xml().getElementsByTagName("DL").length,
			"New standalone list must serialize");
		let listPosition=-1;
		editor.state.doc.descendants((node,position)=>{
			if("legalDescriptionList" === node.type.name
				&& 1 === node.childCount
				&& "" === node.firstChild?.firstChild?.textContent){
				listPosition=position;
			}
		});
		editor.commands.setTextSelection(listPosition+4);
		action("remove");
		check(0 === xml().querySelector("DL:not([Type])")?.children.length,
			"Removing the final pair must retain an empty list");
		action("add");
		check(2 === xml().querySelector("DL:not([Type])")?.children.length,
			"The selected empty list must accept a new pair");
		return[
			"exact no-op","mixed P/DL","paired add/remove/reorder",
			"indent/outdent","bold/italic","attributes","protected XML"
		];
	}

	finally{
		editor.destroy();
		codec.destructor();
		holder.remove();
	}
}

export function testTiptapEmptyContent():utf8_t[]{
	const cases=["<textdaten><text/></textdaten>","<textdaten/>",""];
	for(const inner of cases){
		const source="<norm doknr='TEST'><metadaten keep='yes'/>"
			+inner+"</norm>";
		const holder=document.createElement("div");
		document.body.appendChild(holder);
		const codec=new OfficeLawTiptapXml(source);
		const editor=new Editor({
			element:holder,extensions:extensions(),content:codec.load()
		});
		codec.acceptInitial(editor.getJSON());
		try{
			check(source === codec.update(editor.getJSON()),
				"An empty document must not insert XML before editing");
			editor.commands.insertContent("New paragraph");
			const updated=codec.update(editor.getJSON());
			check(updated.includes("<Content><P>New paragraph</P>"),
				"Typing must create the missing content ancestors");
			check(updated.includes("<metadaten keep='yes'/>"),
				"Creating content must preserve unrelated raw XML");
		}
		finally{
			editor.destroy();
			codec.destructor();
			holder.remove();
		}
	}
	return["empty content","missing ancestors","source preservation"];
}

async function settle():Promise<void>{
	await new Promise<void>((resolve)=>{
		setTimeout(resolve,40);
	});
}

function button(holder:HTMLElement,label:utf8_t):HTMLButtonElement{
	const found=Array.from(holder.querySelectorAll("button")).find(
		(element)=>{return label === element.textContent?.trim();}
	);
	if(undefined === found){
		throw new Error(`Button ${label} missing`);
	}
	return found;
}

export async function testTiptapSharedDraft():Promise<utf8_t[]>{
	const originalLoad=OfficeLawClient.loadProvisionXml;
	const originalSave=OfficeLawClient.saveProvisionXml;
	let saved:utf8_t|null=null;
	let savedCount=0;
	OfficeLawClient.loadProvisionXml=async()=>{
		return{xml:SOURCE,token:"original-conflict-token"};
	};
	OfficeLawClient.saveProvisionXml=async(
		slug,id,source,UNUSED_signal
	)=>{
		check("example" === slug && "TEST" === id,"Save target");
		check("original-conflict-token" === source.token,
			"Save must retain conflict token");
		saved=source.xml;
	};
	const holder=document.createElement("div");
	document.body.appendChild(holder);
	const root=createRoot(holder);
	try{
		root.render(createElement(XmlEditorDialog,{
			slug:"example",documentNumber:"TEST",inline:true,
			initialMode:"visual",onClose:()=>{},
			onSaved:()=>{savedCount++;}
		}));
		await settle();
		const element=holder.querySelector(".tiptap") as
			(HTMLElement & {editor:Editor})|null;
		check(null !== element,"Active inline editor must be Tiptap");
		const editor=element!.editor;
		select(editor,"2.");
		check(OfficeLegalXmlCommands.run(editor,"indent"),
			"Active editor indent");
		await settle();
		button(holder,"XML-Quelltext").click();
		await settle();
		const textarea=holder.querySelector("textarea");
		check(null !== textarea,"Source mode must appear");
		check(textarea!.value.includes('<DL><DT>2.</DT>'),
			"Switch must flush nested visual changes into shared draft");
		const draft=textarea!.value;
		const setter=Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,"value"
		)?.set;
		if(undefined === setter){
			throw new Error("Textarea setter missing");
		}
		setter.call(textarea,draft.replace("Second","Source <I>edit</I>"));
		textarea!.dispatchEvent(new Event("input",{bubbles:true}));
		await settle();
		button(holder,"Inhalt visuell bearbeiten").click();
		await settle();
		check(holder.querySelector(".tiptap")?.textContent
			?.includes("Source edit") ?? false,
			"Source edits must reload into the same visual draft");
		button(holder,"XML-Quelltext").click();
		await settle();
		const sourceDraft=draft.replace("Second","Source <I>edit</I>");
		check(sourceDraft === holder.querySelector("textarea")?.value,
			"Visual/source roundtrip must preserve the same draft");
		button(holder,"XML prüfen und speichern").click();
		await settle();
		check(sourceDraft === saved && 1 === savedCount,
			"XML save must receive the flushed draft unchanged");
		return["active Tiptap","shared draft","mode flush","save token"];
	}
	finally{
		root.unmount();
		holder.remove();
		OfficeLawClient.loadProvisionXml=originalLoad;
		OfficeLawClient.saveProvisionXml=originalSave;
	}
}

export function testTiptapParagraphsAndLists():utf8_t[]{
	const source='<norm doknr="TEST"><metadaten/><textdaten><text>'
		+'<Content><P>First</P><P>Second</P>'
		+'<UL><LI>one</LI><LI>two<UL><LI>child</LI></UL></LI></UL>'
		+'</Content></text></textdaten></norm>';
	const holder=document.createElement("div");
	document.body.appendChild(holder);
	const codec=new OfficeLawTiptapXml(source);
	const editor=new Editor({
		element:holder,extensions:extensions(),content:codec.load()
	});
	codec.acceptInitial(editor.getJSON());
	const xml=():XMLDocument=>{
		return new DOMParser().parseFromString(
			codec.update(editor.getJSON()),"application/xml"
		);
	};
	try{
		check(source === codec.update(editor.getJSON()),
			"Normal lists must roundtrip exactly");
		editor.commands.setTextSelection(4);
		editor.commands.splitBlock();
		check(3 === xml().querySelector("Content")?.querySelectorAll(
			":scope > P"
		).length,"Enter must add a normal paragraph with a unique identity");
		editor.commands.undo();
		check(source === codec.update(editor.getJSON()),
			"Undo must restore exact source");
		let position=0;
		editor.state.doc.forEach((node,offset)=>{
			if("paragraph" === node.type.name
				&& "Second" === node.textContent){
				position=offset+1;
			}
		});
		editor.commands.setTextSelection(position);
		editor.commands.toggleBulletList();
		check(0 === xml().getElementsByTagName("parsererror").length,
			"Paragraph-to-list conversion must produce valid XML");
		check(Array.from(xml().querySelectorAll("UL > LI")).some(
			(item)=>{return "Second" === item.textContent;}
		),"Changing an existing paragraph to a list must not drop edits");
		editor.commands.undo();
		editor.commands.setContent({
			type:"doc",content:[{
				type:"bulletList",content:[{
					type:"listItem",content:[
						{type:"paragraph",content:[
							{type:"text",text:"outer"}
						]},
						{type:"orderedList",content:[{
							type:"listItem",content:[
								{type:"paragraph",content:[
									{type:"text",text:"inner"}
								]}
							]
						}]}
					]
				}]
			}]
		});
		const mixed=codec.update(editor.getJSON());
		check("inner" === xml().querySelector("UL LI OL LI")?.textContent,
			"Normal lists must support mixed nested ordered/unordered lists");
		const reloaded=new OfficeLawTiptapXml(mixed);
		try{
			editor.commands.setContent(reloaded.load());
			reloaded.acceptInitial(editor.getJSON());
			check(mixed === reloaded.update(editor.getJSON()),
				"Mixed nested lists must reload exactly");
		}
		finally{
			reloaded.destructor();
		}
		return["paragraph split/undo","list conversion","mixed nested lists"];
	}
	finally{
		editor.destroy();
		codec.destructor();
		holder.remove();
	}
}
