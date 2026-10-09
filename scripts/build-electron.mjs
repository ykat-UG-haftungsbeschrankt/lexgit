import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist-electron",{recursive:true});
await build({
	entryPoints:["src/electron/main.ts"],bundle:true,platform:"node",target:"node22",
	format:"cjs",outfile:"dist-electron/main.cjs",external:["electron"],sourcemap:true
});
await build({
	entryPoints:["src/electron/preload.ts"],bundle:true,platform:"node",target:"node22",
	format:"cjs",outfile:"dist-electron/preload.cjs",external:["electron"],sourcemap:true
});
for(const file of ["launcher.html","launcher.css","launcher.js"]){
	await copyFile(`electron/${file}`,`dist-electron/${file}`);
}
