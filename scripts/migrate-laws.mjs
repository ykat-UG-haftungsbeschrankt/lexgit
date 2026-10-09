import { build } from "esbuild";
import {
	link, lstat, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const repository=resolve(process.argv[2] ?? project);
const scratch=await mkdtemp(join(project,".j4-migration-"));

async function exists(path){
	try{
		await lstat(path);
		return true;
	}
	catch(error){
		if("ENOENT" === error.code){
			return false;
		}
		throw error;
	}
}

try{
	const codecPath=join(scratch,"codec.cjs");
	await build({
		entryPoints:[join(project,"src/law/storage.ts")],
		outfile:codecPath,bundle:true,platform:"node",format:"cjs",
		logLevel:"silent"
	});
	const { OfficeLawStorage:codec }=createRequire(import.meta.url)(
		codecPath
	);
	const lawsRoot=join(repository,"laws");
	const plans=[];
	if(await exists(lawsRoot)){
		for(const entry of await readdir(lawsRoot,{withFileTypes:true})){
			if(!entry.isDirectory() || !/^[a-z0-9-]+$/.test(entry.name)){
				continue;
			}
			const directory=join(lawsRoot,entry.name);
			const manifestPath=join(directory,"law.json");
			if(!await exists(manifestPath)){
				continue;
			}
			const source=await readFile(manifestPath,"utf8");
			const raw=JSON.parse(source);
			const manifest=codec.parseOfficeLawManifest(source);
			const files=[];
			const paths={...manifest.normPaths};
			for(const id of manifest.normDocumentNumbers){
				const path=manifest.normPaths?.[id] ?? `${id}.md`;
				const original=join(directory,"norms",path);
				const info=await lstat(original);
				if(!info.isFile() || info.isSymbolicLink()){
					throw new Error(`Unsafe norm file: ${original}`);
				}
				const input=await readFile(original,"utf8");
				const norm=codec.parseOfficeLawNormSource(input);
				if(id !== norm.documentNumber){
					throw new Error(`Norm identity mismatch: ${original}`);
				}
				if(path.endsWith(".xml")){
					paths[id]=path;
					continue;
				}
				const next=path.replace(/\.md$/,".xml");
				const target=join(directory,"norms",next);
				if(await exists(target)){
					throw new Error(`Target already exists: ${target}`);
				}
				const output=codec.writeOfficeLawNorm(norm);
				if(JSON.stringify(norm)
					!== JSON.stringify(codec.parseOfficeLawNormSource(output))){
					throw new Error(`Norm round trip failed: ${original}`);
				}
				paths[id]=next;
				files.push({original,target,input,output});
			}
			if(0<files.length){
				const output=JSON.stringify(
					{...raw,normPaths:paths},null,"\t"
				)+"\n";
				codec.parseOfficeLawManifest(output);
				plans.push({directory,manifestPath,source,output,files});
			}
		}
	}
	let converted=0;
	for(const plan of plans){
		const stage=await mkdtemp(join(plan.directory,".xml-migration-"));
		const installed=[];
		const backups=[];
		let committed=false;
		let recovered=true;
		try{
			await writeFile(join(stage,"law.json"),plan.output,{flag:"wx"});
			for(let index=0;index<plan.files.length;index++){
				const file=plan.files[index];
				await writeFile(join(stage,`${index}.xml`),file.output,
					{flag:"wx"});
				if(file.input !== await readFile(file.original,"utf8")){
					throw new Error("A norm changed during migration.");
				}
				await link(join(stage,`${index}.xml`),file.target);
				installed.push(file.target);
			}
			if(plan.source !== await readFile(plan.manifestPath,"utf8")){
				throw new Error("The manifest changed during migration.");
			}
			for(let index=0;index<plan.files.length;index++){
				const file=plan.files[index];
				const backup=join(stage,`${index}.md`);
				await rename(file.original,backup);
				backups.push({original:file.original,backup});
			}
			await rename(join(stage,"law.json"),plan.manifestPath);
			committed=true;
			converted+=plan.files.length;
		}
		catch(error){
			try{
				for(const target of installed){
					await unlink(target);
				}
				for(const file of backups){
					await link(file.backup,file.original);
				}
			}
			catch(rollbackError){
				recovered=false;
				throw new Error(
					`Recovery files retained at ${stage}`,
					{cause:rollbackError}
				);
			}
			throw error;
		}
		finally{
			if(committed || recovered){
				await rm(stage,{recursive:true,force:true});
			}
		}
	}
	console.log(`Converted ${converted} norms in ${plans.length} laws.`);
}
finally{
	await rm(scratch,{recursive:true,force:true});
}
