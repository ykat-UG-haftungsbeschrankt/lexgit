import assert from "node:assert/strict";
import { test } from "node:test";
import { OfficeLawVitePlugin } from "../src/server/vite";

test("backend watcher covers domain and API files but not UI/data",()=>{
	const root="/workspace/j4";
	for(const file of [
		"src/server/api.ts","src/server/new-route.ts","src/law/storage.ts",
		"src/law/parser.ts","src/law/patch.ts"
	]){
		assert.equal(
			OfficeLawVitePlugin._isBackendFile(root,`${root}/${file}`),true
		);
	}
	for(const file of [
		"src/law/client.ts","src/law/request.ts","src/law/rich-content.ts",
		"src/law/patch-types.ts","src/App.tsx",
		"laws/example/law.json","src/server/api.ts.bak","../other/api.ts"
	]){
		assert.equal(
			OfficeLawVitePlugin._isBackendFile(root,`${root}/${file}`),false
		);
	}
});

test("plugin exposes development reload and preview hooks",()=>{
	const plugin=new OfficeLawVitePlugin("/workspace/j4");
	try{
		const descriptor=plugin.createPlugin();
		assert.equal(descriptor.name,"law-files-api");
		assert.equal(typeof descriptor.configureServer,"function");
		assert.equal(typeof descriptor.configurePreviewServer,"function");
		assert.equal(typeof descriptor.handleHotUpdate,"function");
	}
	finally{
		plugin.destructor();
	}
});
