import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { OfficeLawGit } from "../src/law/git";
import { OfficeLawParser } from "../src/law/parser";
import { OfficeLawXml } from "../src/law/xml";
import { OfficeLawLayout } from "../src/law/layout";
import { OfficeLawHistoryParser } from "../src/law/history";
import { createOfficeLawApi } from "../src/server/api";

function xml(id:utf8_t,text:utf8_t):utf8_t{
	return `<norm doknr="${id}"><metadaten><enbez>${id}</enbez>`
		+`</metadaten><textdaten><text><Content><P>${text}</P>`
		+'</Content></text></textdaten></norm>';
}

async function commit(root:utf8_t,message:utf8_t):Promise<utf8_t>{
	await OfficeLawGit._git(root,["add","--all"]);
	await OfficeLawGit._git(root,[
		"-c","user.name=Test","-c","user.email=test@example.org",
		"commit","-m",message
	]);
	return(await OfficeLawGit._git(root,["rev-parse","HEAD"])).trim();
}

test("compares selected commit to HEAD, not its parent or working tree",
	async()=>{
		const root=await mkdtemp(join(tmpdir(),"j4-comparison-"));
		const directory=join(root,"laws","example");
		const parser=new OfficeLawParser();
		const server=createServer(createOfficeLawApi(root).middleware);
		try{
			await OfficeLawGit._git(root,["init"]);
			const sources=new Map([
				["A",xml("A","Original A")],
				["B",xml("B","Deleted B")],
				["C",xml("C","Unchanged C")]
			]);
			const norms=[...sources.values()].map(OfficeLawXml.parse);
			await parser.writeDocumentDirectory({
				slug:"example",documentNumber:"LAW",buildDate:null,
				normDocumentNumbers:["A","B","C"],norms,
				introductoryNotes:[],
				metadata:{
					abbreviation:"E",officialAbbreviation:null,
					shortTitle:null,title:"Example",enactmentDate:null,
					citations:[],statusNotes:[]
				}
			},{
				slug:"example",directory,indexPath:"https://example.org"
			},sources);
			const paths=OfficeLawLayout.createOfficeLawNormPaths(norms);
			const manifestPath=join(directory,"law.json");
			const baseline=await commit(root,"Baseline");
			await writeFile(join(directory,"norms",paths.A!),
				xml("A","Earlier change"));
			await rm(join(directory,"norms",paths.B!));
			await writeFile(join(directory,"norms","D.xml"),
				xml("D","Added D"));
			await writeFile(join(directory,"norms",paths.C!),
				xml("C","Temporary change"));
			const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
			manifest.normDocumentNumbers=["A","C","D"];
			delete manifest.normPaths.B;
			manifest.normPaths.D="D.xml";
			await writeFile(manifestPath,JSON.stringify(manifest));
			const intermediate=await commit(root,"Earlier changes");
			await writeFile(join(directory,"norms","D.xml"),
				xml("D","Latest change"));
			await writeFile(join(directory,"norms",paths.C!),
				await OfficeLawGit._git(root,[
					"show",`${baseline}:laws/example/norms/${paths.C}`
				]));
			await rename(join(directory,"norms",paths.A!),
				join(directory,"norms","Renamed A.xml"));
			manifest.normPaths.A="Renamed A.xml";
			await writeFile(manifestPath,JSON.stringify(manifest));
			const head=await commit(root,"Latest changes");
			await writeFile(join(directory,"norms","Renamed A.xml"),
				xml("A","Uncommitted text"));
			const result=await OfficeLawGit.readRepositoryLawComparison(
				root,baseline,"example"
			);
			assert(result);
			assert.equal(result.comparisonVersion,head);
			assert.deepEqual(new Set(result.changedIds),
				new Set(["A","B","D"]));
			assert.deepEqual(result.removedNorms.map((norm)=>{
				return norm.documentNumber;
			}),["B"]);
			assert.deepEqual(result.document?.norms[0]?.paragraphs,
				["Earlier change"]);
			assert.deepEqual(result.previousNorms[0]?.paragraphs,
				["Original A"]);
			const latest=await OfficeLawGit.readRepositoryLawComparison(
				root,head,"example"
			);
			assert.deepEqual(latest?.changedIds,[]);
			const historical=await OfficeLawGit.readRepositoryLawSnapshot(
				root,intermediate,"example"
			);
			assert.deepEqual(historical?.document?.norms[0]?.paragraphs,
				["Earlier change"]);
			assert.equal(historical?.comparisonVersion,intermediate);
			const selected=await OfficeLawGit.readRepositoryLawComparison(
				root,intermediate,"example","selected"
			);
			assert.deepEqual(selected,historical);
			const latestOnly=await OfficeLawGit.readRepositoryLawComparison(
				root,baseline,"example","latest"
			);
			assert.equal(latestOnly?.comparisonVersion,head);
			assert.deepEqual(latestOnly?.previousNorms[0]?.paragraphs,
				["Earlier change"]);
			assert(!latestOnly?.changedIds.includes("B"));
			await OfficeLawGit._git(root,["restore","--worktree","."]);
			await OfficeLawGit._git(root,["checkout","-b","side",baseline]);
			await writeFile(join(directory,"norms",paths.C!),
				xml("C","Merged change"));
			await commit(root,"Side branch change");
			await OfficeLawGit._git(root,["checkout","--detach",head]);
			await OfficeLawGit._git(root,[
				"-c","user.name=Test","-c","user.email=test@example.org",
				"merge","--no-ff","side","-m","Merge side branch"
			]);
			const mergedHead=(await OfficeLawGit._git(root,[
				"rev-parse","HEAD"
			])).trim();
			const merged=await OfficeLawGit.readRepositoryLawComparison(
				root,baseline,"example"
			);
			assert.equal(merged?.comparisonVersion,mergedHead);
			assert.deepEqual(new Set(merged?.changedIds),
				new Set(["A","B","C","D"]));
			await new Promise<void>((resolve)=>{
				server.listen(0,"127.0.0.1",resolve);
			});
			const address=server.address();
			assert(address && "object" === typeof address);
			const url=`http://127.0.0.1:${address.port}/api/git/history/`
				+`${baseline}/laws/example`;
			const response=await fetch(`${url}?compare=head`);
			assert.equal(response.status,200);
			const payload=OfficeLawHistoryParser.parseRepositoryLawSnapshot(
				await response.json()
			);
			assert.equal(payload.comparisonVersion,mergedHead);
			assert.deepEqual(payload.changedIds,merged?.changedIds);
			for(const mode of ["selected","latest"] as const){
				const actual=await fetch(`${url}?compare=${mode}`);
				assert.equal(actual.status,200);
				const snapshot=
					OfficeLawHistoryParser.parseRepositoryLawSnapshot(
						await actual.json()
					);
				assert.equal(snapshot.comparisonVersion,
					"selected" === mode ? baseline:mergedHead);
				if("selected" === mode){
					assert.equal(snapshot.previousNorms.length,0);
				}
				else{
					assert.deepEqual(snapshot.changedIds,["C"]);
				}
			}
			assert.equal((await fetch(`${url}?compare=bad`)).status,400);
			assert.throws(()=>{
				OfficeLawHistoryParser.parseRepositoryLawSnapshot({
					...payload,comparisonVersion:"invalid"
				});
			});
		}
		finally{
			parser.destructor();
			if(server.listening){
				await new Promise<void>((resolve,reject)=>{
					server.close((error)=>{
						if(error){
							reject(error);
						}
						else{
							resolve();
						}
					});
				});
			}
			await rm(root,{recursive:true,force:true});
		}
	}
);
