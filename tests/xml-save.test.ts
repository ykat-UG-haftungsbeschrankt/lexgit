import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeLawManagement } from "../src/law/manage";
import { OfficeLawLayout } from "../src/law/layout";
import { OfficeLawParser } from "../src/law/parser";
import { OfficeLawXml } from "../src/law/xml";
import { createOfficeLawApi } from "../src/server/api";

test("XML, text and structure saves use stable lowercase formatting",
	async()=>{
		const temporary=await mkdtemp(join(tmpdir(),"j4-xml-save-"));
		const directory=join(temporary,"laws","example");
		const parser=new OfficeLawParser();
		const initial='<norm doknr="TEST"><metadaten><enbez>1</enbez>'
			+'<titel>Original</titel></metadaten><textdaten><text>'
			+'<Content><P>a<B>b</B>c</P></Content></text></textdaten></norm>';
		const norm=OfficeLawXml.parse(initial);
		const api=createOfficeLawApi(temporary);
		const server=createServer(api.middleware);
		try{
			const document=await parser.writeDocumentDirectory({
				slug:"example",documentNumber:"LAW",buildDate:null,
				normDocumentNumbers:["TEST"],
				metadata:{
					abbreviation:"E",officialAbbreviation:null,
					shortTitle:null,title:"Example",enactmentDate:null,
					citations:[],statusNotes:[]
				},
				introductoryNotes:[],norms:[norm]
			},{
				slug:"example",directory,indexPath:"https://example.org"
			},new Map([["TEST",initial]]));
			await new Promise<void>((done)=>{
				server.listen(0,"127.0.0.1",done);
			});
			const address=server.address();
			assert(address && "object" === typeof address);
			const origin=`http://127.0.0.1:${address.port}`;
			const url=`${origin}/api/laws/example/norms/TEST`;
			const paths=OfficeLawLayout.createOfficeLawNormPaths(
				document.norms
			);

			await test("structure edits allow imported multiline titles",async()=>{
				const temporary=await mkdtemp(join(tmpdir(),"j4-structure-title-"));
				const directory=join(temporary,"laws","example");
				const parser=new OfficeLawParser();
				const sources=[
					'<norm doknr="SECTION"><metadaten><gliederungseinheit>'
						+'<gliederungskennzahl>010</gliederungskennzahl>'
						+'<gliederungsbez>Part 1</gliederungsbez>'
						+'<gliederungstitel>First<BR/>section</gliederungstitel>'
						+'</gliederungseinheit></metadaten></norm>',
					'<norm doknr="IMPORTED"><metadaten><enbez>1</enbez>'
						+'<titel>Imported<BR/>multiline title</titel></metadaten>'
						+'<textdaten><text><Content><P>Keep this text.</P>'
						+'</Content></text></textdaten></norm>',
					'<norm doknr="EDITED"><metadaten><enbez>2</enbez>'
						+'<titel>Original</titel></metadaten></norm>'
				];
				const norms=sources.map((source)=>{
					return OfficeLawXml.parse(source);
				});
				try{
					const document=await parser.writeDocumentDirectory({
						slug:"example",documentNumber:"LAW",buildDate:null,
						normDocumentNumbers:norms.map((norm)=>{
							return norm.documentNumber;
						}),
						metadata:{
							abbreviation:"E",officialAbbreviation:null,
							shortTitle:"Short\nlaw title",title:"Example\nlaw",
							enactmentDate:null,citations:[],statusNotes:[]
						},
						introductoryNotes:[],norms
					},{
						slug:"example",directory,indexPath:"https://example.org"
					},new Map(norms.map((norm,index)=>{
						return[norm.documentNumber,sources[index]!];
					})));
					const paths=OfficeLawLayout.createOfficeLawNormPaths(norms);
					const entries=document.norms.map((norm)=>{
						return{
							documentNumber:norm.documentNumber,kind:norm.kind,
							identifier:norm.identifier,title:norm.title,
							hierarchy:null === norm.hierarchy
								?null:{...norm.hierarchy},
							path:paths[norm.documentNumber]!
						};
					});
					const input={
						law:{
							abbreviation:"E",title:document.metadata.title,
							shortTitle:document.metadata.shortTitle,
							indexPath:"https://example.org"
						},
						expectedNormDocumentNumbers:document.normDocumentNumbers,
						entries
					};
					const importedFile=join(directory,"norms",paths.IMPORTED!);
					const importedSource=await readFile(importedFile,"utf8");
					const edited=entries[2]!;
					const hierarchy=entries[0]!.hierarchy!;
					edited.title="Edited provision";
					await OfficeLawManagement.updateOfficeLawStructure(
						directory,"example",input
					);
					hierarchy.title="Edited section";
					await OfficeLawManagement.updateOfficeLawStructure(
						directory,"example",input
					);
					input.law.title="Edited\tlaw\r\ntitle";
					const updated=await
						OfficeLawManagement.updateOfficeLawStructure(
						directory,"example",input
					);
					assert.equal(updated.metadata.title,input.law.title);
					assert.equal(updated.metadata.shortTitle,"Short\nlaw title");
					assert.equal(updated.norms[0]!.hierarchy!.title,"Edited section");
					assert.equal(updated.norms[1]!.title,"Imported\nmultiline title");
					assert.equal(updated.norms[2]!.title,"Edited provision");
					assert.equal(await readFile(importedFile,"utf8"),importedSource);
					assert.deepEqual(updated.norms[1]!.paragraphs,["Keep this text."]);

					for(const title of [""," \r\n\t ","Invalid\u0000title"]){
						await assert.rejects(
							OfficeLawManagement.updateOfficeLawStructure(
								directory,"example",{
									...input,law:{...input.law,title}
								}
							),/Title must be nonempty/
						);
					}
					for(const field of ["title","shortTitle"]){
						await assert.rejects(
							OfficeLawManagement.updateOfficeLawStructure(
								directory,"example",{
									...input,law:{
										...input.law,[field]:"Invalid\u007ftitle"
									}
								}
							),/invalid control characters/
						);
					}
					edited.title="Invalid\u000btitle";
					await assert.rejects(
						OfficeLawManagement.updateOfficeLawStructure(
							directory,"example",input
						),/Title of EDITED/
					);
					edited.title=null;
					hierarchy.title="Invalid\u001ftitle";
					await assert.rejects(
						OfficeLawManagement.updateOfficeLawStructure(
							directory,"example",input
						),/Section title of SECTION/
					);
					hierarchy.title=null;
					input.law.shortTitle=null;
					const cleared=await
						OfficeLawManagement.updateOfficeLawStructure(
						directory,"example",input
					);
					assert.equal(cleared.metadata.shortTitle,null);
					assert.equal(cleared.norms[0]!.hierarchy!.title,null);
					assert.equal(cleared.norms[2]!.title,null);
					edited.identifier="2\n";
					await assert.rejects(
						OfficeLawManagement.updateOfficeLawStructure(
							directory,"example",input
						),/Provision identifier.*control characters/
					);
				}
				finally{
					parser.destructor();
					await rm(temporary,{recursive:true});
				}
			});
			const file=join(directory,"norms",paths.TEST!);
			const original=await readFile(file,"utf8");
			const loadedLaw=await fetch(`${origin}/api/laws/example`);
			assert.equal(loadedLaw.status,200);
			const payload=await loadedLaw.json();
			assert.equal(payload.norms[0].sourceXml,original);
			const source='<NORM DOKNR="TEST"><METADATEN>'
				+'<ENBEZ>1</ENBEZ><TITEL>Edited</TITEL></METADATEN>'
				+'<TEXTDATEN><TEXT><CONTENT><P>a<B>b</B>c</P>'
				+'</CONTENT></TEXT></TEXTDATEN></NORM>';
			for(let index=0;index<2;index++){
				const loaded=await fetch(`${url}/xml`);
				const snapshot=await loaded.json();
				const response=await fetch(`${url}/xml`,{
					method:"PUT",
					headers:{
						"Content-Type":"application/json",Origin:origin
					},
					body:JSON.stringify({
						xml:source,token:snapshot.token
					})
				});
				assert.equal(response.status,200,await response.text());
				assert.equal(await readFile(file,"utf8"),
					OfficeLawXml.format(source));
			}
			assert.equal(await readFile(file,"utf8"),
				original.replace("Original","Edited"));
			const response=await fetch(url,{
				method:"PUT",
				headers:{"Content-Type":"text/plain",Origin:origin},
				body:"Changed text"
			});
			assert.equal(response.status,200,await response.text());
			const textSource=await readFile(file,"utf8");
			assert.equal(OfficeLawXml.format(textSource),textSource);
			assert.deepEqual(
				OfficeLawXml.parse(textSource).paragraphs,["Changed text"]
			);
			await OfficeLawManagement.updateOfficeLawStructure(
				directory,"example",{
					entries:[{
						documentNumber:norm.documentNumber,
						kind:norm.kind,identifier:norm.identifier,
						title:"Structure edit",
						hierarchy:norm.hierarchy,path:paths.TEST
					}]
				}
			);
			const structureSource=await readFile(file,"utf8");
			assert.equal(
				OfficeLawXml.format(structureSource),structureSource
			);
			assert.equal(
				OfficeLawXml.parse(structureSource).title,"Structure edit"
			);
		}
		finally{
			parser.destructor();
			if(server.listening){
				await new Promise<void>((done,fail)=>{
					server.close((error)=>{
						if(error){
							fail(error);
						}
						else{
							done();
						}
					});
				});
			}
			await rm(temporary,{recursive:true});
		}
	}
);
