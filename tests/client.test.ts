import assert from "node:assert/strict";
import { test } from "node:test";
import { OfficeLawClient } from "../src/law/client";

const preview={
	head:null,token:"preview-token",
	files:["laws/example/law.json"],patch:"example patch"
};

test("typed patch methods validate responses and send confirmation tokens",
	async(context)=>{
		const calls:{url:unknown; options:RequestInit|undefined}[]=[];
		context.mock.method(globalThis,"fetch",async(
			url:unknown,options?:RequestInit
		)=>{
			calls.push({url,options});
			return new Response(JSON.stringify(preview));
		});
		const signal=new AbortController().signal;
		assert.deepEqual(await OfficeLawClient.loadPatchExport(signal),preview);
		assert.deepEqual(await OfficeLawClient.checkPatch("patch",signal),{
			files:preview.files,token:preview.token
		});
		await OfficeLawClient.applyPatch("patch","confirmed",signal);
		assert.equal(calls[0]?.url,"/api/git/patch");
		assert.equal(calls[0]?.options?.signal,signal);
		assert.equal(calls[1]?.options?.method,"POST");
		assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)),{
			patch:"patch",checkOnly:true
		});
		assert.deepEqual(JSON.parse(String(calls[2]?.options?.body)),{
			patch:"patch",checkOnly:false,token:"confirmed"
		});
	}
);

test("typed mutations reject success-shaped invalid responses",
	async(context)=>{
		context.mock.method(globalThis,"fetch",async()=>{
			return new Response(JSON.stringify({ok:true}));
		});
		const signal=new AbortController().signal;
		await assert.rejects(
			OfficeLawClient.commitChanges("message","token",signal),
			/Ungültige Commit/
		);
		await assert.rejects(
			OfficeLawClient.checkPatch("patch",signal),/Ungültige Patch/
		);
		await assert.rejects(
			OfficeLawClient.removeLaw({
				slug:"example",documentNumber:"EXAMPLE",abbreviation:"E",
				title:"Example",shortTitle:null,indexPath:"https://example.org"
			},signal),/Ungültige Antwort/
		);
		await assert.rejects(
			OfficeLawClient.saveProvision("example","NORM","text"),
			/Ungültige Antwort/
		);
	}
);

test("server errors are preserved and non-JSON errors get context",
	async(context)=>{
		const fetch=context.mock.method(globalThis,"fetch",async()=>{
			return new Response(JSON.stringify({error:"Conflict details"}),{
				status:409
			});
		});
		await assert.rejects(
			OfficeLawClient.request("/api/test"),/Conflict details/
		);
		fetch.mock.mockImplementation(async()=>{
			return new Response("<html>Server failure</html>",{status:500});
		});
		await assert.rejects(
			OfficeLawClient.request("/api/test",{},"Laden fehlgeschlagen"),
			/Laden fehlgeschlagen.*ungültige Serverantwort.*500/
		);
	}
);

test("valid commit and provision save responses retain typed results",
	async(context)=>{
		const hash="a".repeat(40);
		const fetch=context.mock.method(globalThis,"fetch",async()=>{
			return new Response(JSON.stringify({hash}));
		});
		assert.deepEqual(await OfficeLawClient.commitChanges(
			"message","token",new AbortController().signal
		),{hash});
		fetch.mock.mockImplementation(async()=>{
			return new Response(JSON.stringify({
				saved:true,documentNumber:"NORM"
			}));
		});
		await OfficeLawClient.saveProvision("example","NORM","text");
	}
);
