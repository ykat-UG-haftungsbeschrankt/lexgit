import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import SourceLegalText from "../src/components/legal/SourceLegalText";
import { OfficeLawXml } from "../src/law/xml";
import { OfficeLawStorage } from "../src/law/storage";

function check(condition:bool_t,message:utf8_t):void{
	if(!condition){
		throw new Error(message);
	}
}

export async function testSourceLegalText():Promise<utf8_t[]>{
	const source='<norm doknr="TEST"><metadaten/><textdaten><text>'
		+'<Content><P>Intro <B>bold</B><DL Type="arabic">'
		+'<DT>1.</DT><DD><LA>First<DL><DT>a)</DT>'
		+'<DD><LA>Nested</LA></DD></DL> tail</LA></DD></DL>'
		+' end</P><P><table><tgroup><tbody><row><entry>'
		+'Table cell</entry></row></tbody></tgroup></table></P>'
		+'</Content></text><fussnoten><Content><P>Footnote</P>'
		+'</Content></fussnoten></textdaten></norm>';
	const norm=OfficeLawStorage.parseOfficeLawNorm(
		OfficeLawXml.parse(source)
	);
	check(source === norm.sourceXml,"API parsing must retain source XML");
	const holder=document.createElement("div");
	document.body.appendChild(holder);
	const root=createRoot(holder);
	try{
		await act(async()=>{
			root.render(createElement(SourceLegalText,{
				source,container:"text"
			}));
		});
		const host=holder.querySelector(".source-legal-text");
		check(null !== host,"Source host missing");
		check(null !== host?.querySelector(
			":scope > p > dl > dt + dd > la > dl > dt + dd > la"
		),"Nested source tags must retain their original parents");
		check(null !== host?.querySelector(
			"p > table > tgroup > tbody > row > entry"
		),"CALS tables must retain their original tags");
		check(0 === host?.querySelectorAll("div,span").length,
			"Source structure must not be replaced by div/span wrappers");
		check("arabic" === host?.querySelector("dl")?.getAttribute("type"),
			"Source layout attributes must survive");
		check("bold" === host?.querySelector("b")?.textContent,
			"Inline formatting must survive");
		check(host?.textContent?.includes("Nested tail") ?? false,
			"Mixed text must retain its order");
		check(null === holder.querySelector('[role="alert"]'),
			"Source rendering must not report errors");
		await act(async()=>{
			root.render(createElement(SourceLegalText,{
				source,container:"fussnoten"
			}));
		});
		check("Footnote" === host?.querySelector("p")?.textContent,
			"Switching containers must render raw footnote tags");
		const plain=OfficeLawXml.write({
			...norm,paragraphs:["Literal <b>text</b>\nSecond line"]
		},source);
		await act(async()=>{
			root.render(createElement(SourceLegalText,{
				source:plain,container:"text"
			}));
		});
		check(null === host?.querySelector("b"),
			"Plain-text edits must not be interpreted as HTML");
		check(host?.textContent?.includes("Literal <b>text</b>") ?? false,
			"Plain-text edits must retain literal markup");
		const unsafe=source.replace(
			"<B>bold</B>",'<B onclick="throw 1">bold</B>'
		);
		await act(async()=>{
			root.render(createElement(SourceLegalText,{
				source:unsafe,container:"text"
			}));
		});
		check(!host?.querySelector("b")?.hasAttribute("onclick"),
			"XML event attributes must not become executable");
		await act(async()=>{
			root.render(createElement(SourceLegalText,{
				source:source.replace("<B>bold</B>","<script>bad</script>"),
				container:"text"
			}));
		});
		check(null !== holder.querySelector('[role="alert"]'),
			"Unsupported active tags must surface an error");
		check(null === host?.querySelector("script"),
			"Unsupported active tags must not be mounted");
		return[
			"source transport","p/dl/dt/dd/la","nested lists","mixed text",
			"inline formatting","CALS tables","footnotes","plain edits",
			"inert attributes","unsupported tag errors"
		];
	}
	finally{
		await act(async()=>{
			root.unmount();
		});
		holder.remove();
	}
}
