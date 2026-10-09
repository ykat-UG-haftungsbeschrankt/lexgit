import { OfficeLawRichContent } from "../src/law/rich-content";
import { OfficeLawXml } from "../src/law/xml";

function check(condition:boolean,message:string):void{
	if(!condition){
		throw new Error(message);
	}
}

export function testLegalXmlRoundTrip():string[]{
	const content='<P keep="yes">Before <B>bold</B>'
		+'<DL Type="arabic"><DT>1.</DT><DD Font="normal">'
		+'<LA Size="normal">First <I>item</I>'
		+'<DL Type="alpha"><DT>a)</DT><DD><LA>Nested</LA></DD></DL>'
		+' after nested</LA></DD><DT>2.</DT><DD><LA/></DD></DL>'
		+' trailing</P><P><TABLE><TR><TD>Protected</TD></TR></TABLE></P>';
	const source='<norm doknr="TEST"><metadaten><enbez>§ 1</enbez>'
		+'</metadaten><textdaten><text><Content>'+content
		+'</Content></text><fussnoten>Keep footnotes</fussnoten>'
		+'</textdaten></norm>';
	const codec=new OfficeLawRichContent(source);
	try{
		const output=codec.load();
		const block=output.blocks[0];
		if(undefined === block){
			throw new Error("Legal list block missing");
		}

		check("legalXml" === block.type,"Legal list should be editable");
		check("preservedXml" === output.blocks[1]?.type,
			"Unsupported tables should remain protected");
		check(source === codec.update(output),"No-op must preserve source");
		const texts:unknown=block.data.texts;
		if(!Array.isArray(texts)){
			throw new Error("Legal list text fields missing");
		}
		check(texts.includes("Nested"),"Nested list text missing");
		check(texts.includes(""),"Empty list item must be editable");
		const originalTexts=[...texts];
		for(let index=0;index<texts.length;index++){
			texts[index]=`Changed ${index}<b>bold</b><i>italic</i><br>end`;
		}
		const result=codec.update(output);
		const xml=new DOMParser().parseFromString(result,"application/xml");
		check(0 === xml.getElementsByTagName("parsererror").length,
			"Updated XML must parse");
		check(2 === xml.getElementsByTagName("DL").length,
			"Nested list structure must survive");
		check("yes" === xml.getElementsByTagName("P")[0]
			?.getAttribute("keep"),"Paragraph attributes must survive");
		check("normal" === xml.getElementsByTagName("LA")[0]
			?.getAttribute("Size"),"List attributes must survive");
		check(result.includes("<TABLE>"),"Protected table must survive");
		check(result.includes("Keep footnotes"),"Footnotes must survive");
		check(texts.length === xml.getElementsByTagName("B").length,
			"Every edited field should preserve bold");
		check(texts.length === xml.getElementsByTagName("I").length,
			"Every edited field should preserve italic");
		block.data.texts=originalTexts;
		check(source === codec.update(output),
			"Restoring text must restore original source");
		texts[0]="Detached mutation";
		check(source === codec.update(output),"Baseline must not be aliased");
		return[
			"no-op", "nested lists", "empty items", "mixed content",
			"attributes", "bold/italic", "protected XML", "footnotes"
		];
	}
	finally{
		codec.destructor();
	}
}

export function testLowercaseXmlRoundTrip():string[]{
	const source=OfficeLawXml.format(
		'<norm doknr="TEST"><metadaten/><textdaten><text><Content>'
		+'<P>a<B>b</B>c</P><DL Type="arabic"><DT>1.</DT>'
		+'<DD><LA>First <I>item</I></LA></DD></DL>'
		+'<UL><LI>Item</LI></UL><TABLE><TR><TD>Keep</TD></TR></TABLE>'
		+'</Content></text></textdaten></norm>'
	);
	const codec=new OfficeLawRichContent(source);
	try{
		const output=codec.load();
		check("paragraph" === output.blocks[0]?.type,
			"Lowercase paragraphs must be editable");
		check("legalXml" === output.blocks[1]?.type,
			"Indented lowercase legal lists must be editable");
		check("list" === output.blocks[2]?.type,
			"Lowercase lists must be editable");
		check("preservedXml" === output.blocks[3]?.type,
			"Lowercase tables must remain protected");
		check("a<b>b</b>c" === output.blocks[0]?.data.text,
			"Formatting must not add spaces around inline text");
		check(source === codec.update(output),
			"Lowercase no-op must preserve source exactly");
		const legal=output.blocks[1];
		if(undefined === legal || !Array.isArray(legal.data.texts)){
			throw new Error("Lowercase legal list fields missing");
		}
		check("1." === legal.data.texts[0],
			"Indentation must not become editable legal text");
		legal.data.texts[1]="Edited <b>body</b>";
		const updated=OfficeLawXml.format(codec.update(output));
		check(updated.includes("Edited <b>body</b>"),
			"Lowercase legal list edits must survive normalization");
		const reloaded=new OfficeLawRichContent(updated);
		try{
			check("legalXml" === reloaded.load().blocks[1]?.type,
				"Edited lowercase lists must reload as editable");
		}
		finally{
			reloaded.destructor();
		}
		return["lowercase blocks","exact inline text","legal list edits"];
	}
	finally{
		codec.destructor();
	}
}

export function testSourcePreservingXmlEdits():string[]{
	const source='<norm doknr="TEST"><metadaten a=\'raw\'/>'
		+'<textdaten><text><Content>\n'
		+"<P keep='exact'>Old &amp; value</P>\n"
		+"<P id='second'>Two</P>\n"
		+"<TABLE z='2'><TR><TD>x</TD></TR></TABLE>\n"
		+'</Content></text><fussnoten keep=\'footnotes\'>Keep</fussnoten>'
		+'</textdaten></norm>';
	const codec=new OfficeLawRichContent(source);
	try{
		const output=codec.load();
		check(source === codec.update(output),
			"An untouched document must remain byte-for-byte identical");
		const first=output.blocks[0];
		if(undefined === first){
			throw new Error("Paragraph block missing");
		}
		first.data.text="Changed <b>bold</b>";
		const edited=codec.update(output);
		check(edited === source.replace(
			"Old &amp; value","Changed <B>bold</B>"
		),"Text edits must patch only the corresponding source text");
		check(edited.includes("<P id='second'>Two</P>"),
			"Untouched paragraph markup must retain its original bytes");
		check(edited.includes(
			"<TABLE z='2'><TR><TD>x</TD></TR></TABLE>"
		),"Unknown XML blocks must retain their original bytes");
		check(edited.includes("<fussnoten keep='footnotes'>Keep</fussnoten>"),
			"Footnotes must retain their original bytes");
	}
	finally{
		codec.destructor();
	}
	const structureCodec=new OfficeLawRichContent(source);
	try{
		const output=structureCodec.load();
		const second=output.blocks[1];
		const table=output.blocks[2];
		if(undefined === second || undefined === table){
			throw new Error("Structural XML blocks missing");
		}
		output.blocks=[
			table,
			{id:"added",type:"paragraph",data:{text:"New"}},
			second
		];
		const changed=structureCodec.update(output);
		check(-1 === changed.indexOf("<P keep='exact'>"),
			"Deleting a paragraph must remove its original source range");
		check(changed.indexOf("<TABLE")<changed.indexOf("<P>New</P>")
			&& changed.indexOf("<P>New</P>")
				<changed.indexOf("<P id='second'>"),
			"Additions and reordering must follow Editor.js block order");
		check(changed.includes("<TABLE z='2'><TR><TD>x</TD></TR></TABLE>"),
			"Reordering must preserve unknown block bytes");
		check(changed.includes("<metadaten a='raw'/>"),
			"Metadata must remain byte-for-byte untouched");
		check(changed.includes(
			"<fussnoten keep='footnotes'>Keep</fussnoten>"
		),"Structural edits must preserve footnotes");
		return["text patches","block add/delete/reorder","raw XML retention"];
	}
	finally{
		structureCodec.destructor();
	}
}
