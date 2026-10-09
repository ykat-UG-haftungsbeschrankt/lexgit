import assert from "node:assert/strict";
import { test } from "node:test";
import { OfficeLawCitationResolver } from "../src/law/client";
import { OfficeLawCitations } from "../src/law/citations";
import { OfficeLawXml } from "../src/law/xml";
import type { OfficeLawDocument } from "../src/law/types";
import type { OfficeLawSummary } from "../src/law/storage";

const XML='<norm doknr="TEST"><metadaten><enbez>§ 1</enbez>'
	+'</metadaten><textdaten><text><Content>'
	+'<P>(1) Before <B>bold</B><DL><DT>1.</DT>'
	+'<DD><LA>First item.</LA></DD><DT>2.</DT>'
	+'<DD><LA>Second <I>item</I>.</LA></DD></DL></P>'
	+'<P>(2) Other paragraph.</P>'
	+'</Content></text></textdaten></norm>';

const SUMMARY:OfficeLawSummary={
	slug:"example",documentNumber:"TEST",abbreviation:"E",
	title:"Example",shortTitle:null,indexPath:"https://example.org"
};

function law(withXml:bool_t):OfficeLawDocument{
	const norm=OfficeLawXml.parse(XML);
	if(!withXml){
		delete norm.sourceXml;
	}
	return{
		slug:"example",documentNumber:"TEST",buildDate:null,
		normDocumentNumbers:["TEST"],introductoryNotes:[],norms:[norm],
		metadata:{
			abbreviation:"E",officialAbbreviation:"E",shortTitle:null,
			title:"Example",enactmentDate:null,citations:[],statusNotes:[]
		}
	};
}

test("citation resolver returns source XML and exact excerpt scopes",
	async()=>{
		const document=law(true);
		const reference=OfficeLawCitations.findOfficeLawCitations(
			"§ 1 Absatz 1 Nummer 2",[SUMMARY]
		)[0]!;
		const resolver=new OfficeLawCitationResolver(document,[SUMMARY]);
		try{
			const result=await resolver.resolve(
				reference,new AbortController().signal
			);
			assert.equal(result.sources[0]?.xml,XML);
			assert.equal(result.text,"2.\nSecond item.");
			const text=document.norms[0]!.paragraphs.join("\n\n");
			assert.deepEqual(result.sources[0]?.scopes.map((scope)=>{
				return text.slice(scope.start,scope.end).trim();
			}),[result.text]);
			assert(result.fullText.includes("Other paragraph."));
		}
		finally{
			resolver.destructor();
		}
	}
);

test("legacy citations retain text fallback without partial XML previews",
	async()=>{
		const document=law(false);
		const reference=OfficeLawCitations.findOfficeLawCitations(
			"§ 1 Absatz 2",[SUMMARY]
		)[0]!;
		const resolver=new OfficeLawCitationResolver(document,[SUMMARY]);
		try{
			const result=await resolver.resolve(
				reference,new AbortController().signal
			);
			assert.equal(result.text,"(2) Other paragraph.");
			assert.deepEqual(result.sources,[]);
		}
		finally{
			resolver.destructor();
		}
	}
);
