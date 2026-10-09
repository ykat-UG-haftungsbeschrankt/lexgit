import EditorJS from "@editorjs/editorjs";
import { OfficeLawRichContent } from "../src/law/rich-content";
import { LegalXmlBlock } from "../src/editorjs/LegalXmlBlock";

function check(condition:boolean,message:string):void{
	if(!condition){
		throw new Error(message);
	}
}

export async function testLegalXmlActions():Promise<string[]>{
	const source='<norm doknr="TEST"><metadaten/><textdaten><text>'
		+'<Content><P>Intro<DL Type="arabic">'
		+'<DT>1.</DT><DD><LA Size="normal">First</LA></DD>'
		+'<DT>2.</DT><DD><LA Size="normal">Second</LA></DD>'
		+'<DT>3.</DT><DD><LA Size="normal">Third</LA></DD>'
		+'</DL>Tail</P></Content></text>'
		+'<fussnoten>Keep</fussnoten></textdaten></norm>';
	const holder=document.createElement("div");
	holder.style.position="fixed";
	holder.style.left="-10000px";
	const host=document.querySelector("dialog[open]") ?? document.body;
	host.appendChild(holder);
	const codec=new OfficeLawRichContent(source);
	const editor=new EditorJS({
		holder,data:codec.load(),tools:{legalXml:{class:LegalXmlBlock}}
	});
	try{
		await editor.isReady;
		check(null !== holder.querySelector(
			"p.xml-legal-p > dl.xml-legal-dl"
		),"Legal XML must render its source paragraph and list tags");
		check(null !== holder.querySelector(
			"dt.xml-legal-dt + dd.xml-legal-dd > la.xml-legal-la"
		),"Legal XML must render its source entry tags");
		const rows=()=>{
			return Array.from(holder.querySelectorAll(".xml-legal-entry"));
		};
		const field=(index:number):HTMLElement=>{
			const element=rows()[index]?.querySelector(".xml-legal-text");
			if(!(element instanceof HTMLElement)){
				throw new Error("Entry text field missing");
			}
			return element;
		};
		const tab=(index:number,shiftKey:boolean):void=>{
			field(index).dispatchEvent(new KeyboardEvent("keydown",{
				key:"Tab",shiftKey,bubbles:true,cancelable:true
			}));
		};
		const xml=async():Promise<XMLDocument>=>{
			const output=await editor.save();
			return new DOMParser().parseFromString(
				codec.update(output),"application/xml"
			);
		};
		const labels=(document:XMLDocument):string=>{
			const texts=Array.from(document.querySelectorAll("DT")).map(
				(dt)=>{return dt.textContent;}
			);
			return texts.join(",");
		};
		tab(0,false);
		check("1.,2.,3." === labels(await xml()),
			"First entry cannot indent without a preceding entry");
		field(1).focus();
		check(1 === holder.querySelectorAll(".xml-legal-entry-active").length,
			"Only the focused entry should display its toolbar");
		check(rows()[1]?.classList.contains("xml-legal-entry-active") ?? false,
			"Toolbar must follow the focused DT/DD pair");
		tab(1,false);
		let result=await xml();
		check("2." === result.querySelector("DD LA DL DT")?.textContent,
			"Tab must nest DT/DD together inside LA");
		check("Second" === result.querySelector("DD LA DL DD LA")
			?.textContent,"Indented entry must retain its body");
		check(rows()[1]?.classList.contains("xml-legal-entry-active") ?? false,
			"Toolbar must follow the indented entry");
		check(1 === holder.querySelectorAll(".xml-legal-entry-active").length,
			"Nested focus must not activate the parent toolbar");
		const toolbar=rows()[1]?.querySelector(
			":scope > .xml-legal-controls"
		);
		toolbar?.dispatchEvent(new KeyboardEvent("keydown",{
			key:"Escape",bubbles:true,cancelable:true
		}));
		check(0 === holder.querySelectorAll(".xml-legal-entry-active").length,
			"Escape must hide the entry toolbar");
		field(1).focus();
		document.body.dispatchEvent(new Event("pointerdown",{bubbles:true}));
		check(0 === holder.querySelectorAll(".xml-legal-entry-active").length,
			"Clicking outside must hide the toolbar");
		tab(2,false);
		result=await xml();
		check(4 === result.querySelector("DL DL")?.children.length,
			"Third entry should nest under first, with second");
		tab(1,true);
		result=await xml();
		check("1.,2.,3." === labels(result),"Outdent must preserve order");
		check("3." === result.querySelector("DL DL DT")?.textContent,
			"Following sibling must stay under lifted entry");
		const up=rows()[1]?.querySelector<HTMLButtonElement>(
			":scope > .xml-legal-controls button"
		);
		if(undefined === up || null === up){
			throw new Error("Move-up button missing");
		}
		up.click();
		result=await xml();
		check("2.,3.,1." === labels(result),
			"Moving must include descendants and keep labels");
		const down=rows()[0]?.querySelector<HTMLButtonElement>(
			":scope > .xml-legal-controls button:nth-child(2)"
		);
		if(undefined === down || null === down){
			throw new Error("Move-down button missing");
		}
		down.click();
		result=await xml();
		check("1.,2.,3." === labels(result),
			"Move-down must preserve the subtree");
		rows()[1]?.querySelector<HTMLButtonElement>(
			":scope > .xml-legal-controls button"
		)?.click();
		result=await xml();
		check("2.,3.,1." === labels(result),"Move-up should be repeatable");
		check("normal" === result.querySelector("DD LA")
			?.getAttribute("Size"),"Moving must retain XML attributes");
		const remove=rows()[0]?.querySelector<HTMLButtonElement>(
			":scope > .xml-legal-controls button:last-child"
		);
		if(undefined === remove || null === remove){
			throw new Error("Delete button missing");
		}
		remove.click();
		result=await xml();
		check("1." === labels(result),"Delete must remove the whole subtree");
		check(result.documentElement.textContent?.includes("Intro") ?? false,
			"Mixed paragraph text must survive");
		check(result.documentElement.textContent?.includes("Tail") ?? false,
			"Trailing paragraph text must survive");
		check("Keep" === result.querySelector("fussnoten")?.textContent,
			"Footnotes must survive structural editing");
		const before=rows()[0]?.querySelector<HTMLButtonElement>(
			":scope > .xml-legal-controls button:nth-child(5)"
		);
		if(undefined === before || null === before){
			throw new Error("Insert-before button missing");
		}
		before.click();
		field(0).innerHTML="New label";
		const body=rows()[0]?.querySelector(".xml-legal-dd .xml-legal-text");
		if(!(body instanceof HTMLElement)){
			throw new Error("New body missing");
		}
		body.innerHTML="<b>New body</b>";
		result=await xml();
		check("New label,1." === labels(result),
			"New entry must be inserted before the selected entry");
		check("New body" === result.querySelector("DD LA B")?.textContent,
			"New body must preserve formatting");
		tab(1,false);
		result=await xml();
		check("1." === result.querySelector("DD LA DL DT")?.textContent,
			"Existing entries must nest under new entries");
		const nestedBefore=rows()[1]?.querySelector<HTMLButtonElement>(
			":scope > .xml-legal-controls button:nth-child(5)"
		);
		if(undefined === nestedBefore || null === nestedBefore){
			throw new Error("Nested insert-before button missing");
		}
		nestedBefore.click();
		field(1).innerHTML="Nested new";
		result=await xml();
		check("Nested new" === result.querySelector("DD LA DL DT")
			?.textContent,"Insert-before must work inside nested lists");
		tab(2,true);
		// Delete every entry, then recreate one through the empty-list button.
		while(rows().length>0){
			rows()[0]?.querySelector<HTMLButtonElement>(
				":scope > .xml-legal-controls button:last-child"
			)?.click();
		}
		const append=holder.querySelector<HTMLButtonElement>(
			".xml-legal-dl > button"
		);
		if(null === append){
			throw new Error("Empty list must have a create button");
		}
		append.click();
		result=await xml();
		check(1 === result.querySelectorAll("DT").length,
			"Empty lists must accept new entries");
		editor.blocks.insert("legalXml");
		const output=await editor.save();
		const created=new DOMParser().parseFromString(
			codec.update(output),"application/xml"
		);
		check(2 === created.querySelectorAll("DL").length,
			"Toolbox insertion must create a standalone legal list");
		const reloaded=new OfficeLawRichContent(
			new XMLSerializer().serializeToString(created)
		);
		try{
			const blocks=reloaded.load().blocks;
			check(2 === blocks.length && blocks.every((block)=>{
				return "legalXml" === block.type;
			}),"Created entries must remain visually editable after reload");
		}
		finally{
			reloaded.destructor();
		}
		return[
			"Tab","Shift+Tab","move up/down","delete subtree","labels",
			"attributes","mixed text","footnotes","insert before",
			"nested insertion","empty-list creation","new block","reload",
			"floating toolbar","nested focus","Escape/outside dismissal"
		];
	}
	finally{
		try{
			await editor.isReady;
		}
		finally{
			editor.destroy();
			codec.destructor();
			holder.remove();
		}
	}
}
