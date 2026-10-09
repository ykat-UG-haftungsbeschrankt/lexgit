import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OfficeLawParser } from "../src/law/parser";
import { OfficeLawXml } from "../src/law/xml";
import { OfficeLawStorage } from "../src/law/storage";
import { OfficeLawManagement } from "../src/law/manage";

test("derives empty law directory from abbreviation",async()=>{
	const root=await mkdtemp(join(tmpdir(),"j4-empty-law-"));
	try{
		const input={
			abbreviation:"ÄnderungsG",title:"Example",shortTitle:null,
			indexPath:"https://example.org"
		};
		const law=await OfficeLawManagement.createOfficeLaw(root,input);
		assert.equal(law.slug,"aenderungsg");
		assert.equal(law.metadata.abbreviation,"ÄnderungsG");
		assert.deepEqual(law.norms,[]);
		assert.equal(OfficeLawStorage.parseOfficeLawManifest(
			await readFile(join(root,"aenderungsg","law.json"),"utf8")
		).slug,"aenderungsg");
		await assert.rejects(
			OfficeLawManagement.createOfficeLaw(root,input),
			/already exists/
		);
		await assert.rejects(OfficeLawManagement.createOfficeLaw(root,{
			...input,abbreviation:"!!!"
		}),/slug/);
	}
	finally{
		await rm(root,{recursive:true,force:true});
	}
});

test("derives XML import directory from jurabk and rejects duplicates",
	async()=>{
		const root=await mkdtemp(join(tmpdir(),"j4-jurabk-import-"));
		try{
			const xml=await readFile(resolve("public","BJNR089400004.xml"),
				"utf8");
			const input={
				xml,indexPath:"https://www.gesetze-im-internet.de/halblschv"
			};
			const law=await OfficeLawManagement.importOfficeLaw(root,input);
			assert.equal(law.slug,"halblschv");
			const manifest=await readFile(
				join(root,"halblschv","law.json"),"utf8"
			);
			assert.equal(
				OfficeLawStorage.parseOfficeLawManifest(manifest).slug,
				"halblschv"
			);
			await assert.rejects(
				OfficeLawManagement.importOfficeLaw(root,input),
				/already exists/
			);
			await assert.rejects(OfficeLawManagement.importOfficeLaw(root,{
				...input,xml:xml.replace(
					/<jurabk>[\s\S]*?<\/jurabk>/g,"<jurabk/>"
				)
			}),/jurabk/);
		}
		finally{
			await rm(root,{recursive:true,force:true});
		}
	}
);

for(const file of ["BJNR004370909.xml","BJNR089400004.xml"]){
	test(`imports original ${file} with its external DTD`,async()=>{
		const xml=await readFile(resolve("public",file),"utf8");
		const temporary=await mkdtemp(join(tmpdir(),"j4-xml-import-"));
		const parser=new OfficeLawParser();
		try{
			const document=await parser.writeDirectory(xml,{
				slug:"original",directory:temporary,
				indexPath:"https://www.gesetze-im-internet.de/original"
			});
			assert(document.norms.length>0);
			const manifest=OfficeLawStorage.parseOfficeLawManifest(
				await readFile(join(temporary,"law.json"),"utf8")
			);
			assert.deepEqual(document.normPaths,manifest.normPaths);
			assert.deepEqual(
				OfficeLawStorage.parseOfficeLawDocument(document).normPaths,
				manifest.normPaths
			);
			for(const id of manifest.normDocumentNumbers){
				const path=manifest.normPaths?.[id];
				assert(path?.endsWith(".xml"));
				const source=await readFile(
					join(temporary,"norms",path),"utf8"
				);
				assert.equal(OfficeLawXml.parse(source).documentNumber,id);
				assert(!source.includes("<!DOCTYPE"));
				assert.equal(OfficeLawXml.format(source),source);
				assert(!/<\/?[A-Z]/.test(source));
			}
		}
		finally{
			parser.destructor();
			await rm(temporary,{recursive:true});
		}
	});
}

test("rejects custom DTDs, internal subsets and entity declarations",()=>{
	for(const declaration of [
		'<!DOCTYPE dokumente SYSTEM "file:///etc/passwd">',
		'<!DOCTYPE dokumente SYSTEM "https://example.org/custom.dtd">',
		'<!DOCTYPE dokumente [<!ENTITY secret SYSTEM "file:///etc/passwd">]>',
		'<!DOCTYPE dokumente SYSTEM '
			+'"https://www.gesetze-im-internet.de/dtd/1.01/gii-norm.dtd" '
			+'[<!ENTITY custom "text">]>',
		'<!ENTITY custom "text">'
	]){
		assert.throws(()=>{
			OfficeLawXml.parseDocument(`${declaration}<dokumente/>`);
		},/DTD and entity/);
		const parser=new OfficeLawParser();
		try{
			assert.throws(()=>{
				parser.parse(`${declaration}<dokumente/>`);
			},/DTD and entity/);
		}
		finally{
			parser.destructor();
		}
	}
});
