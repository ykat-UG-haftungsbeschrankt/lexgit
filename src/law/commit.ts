import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RepositoryCommitPreview } from "./history";

export class OfficeLawCommitError extends Error{
	constructor(message:string,public readonly status=409){ super(message); }
}

export class OfficeLawCommitService{
	private static execute=promisify(execFile);
	private static async git(root:string,args:string[],index?:string):Promise<string>{
		const {stdout}=await this.execute("git",["--no-pager","--literal-pathspecs",...args],{
			cwd:root,encoding:"utf8",timeout:15000,maxBuffer:8*1024*1024,
			env:{...process.env,GIT_TERMINAL_PROMPT:"0",...(index === undefined ? {} : {GIT_INDEX_FILE:index})}
		});
		return stdout;
	}
	private static async exists(path:string):Promise<boolean>{
		try{ await stat(path); return true; }
		catch(error){
			if(error instanceof Error && "code" in error && error.code === "ENOENT"){ return false; }
			throw error;
		}
	}
	private static async head(root:string):Promise<string|null>{
		const refs=await this.git(root,["rev-parse","--verify","--quiet","HEAD"]).catch(error=>{
			if(error instanceof Error && "code" in error && error.code === 1){ return ""; }
			throw error;
		});
		return refs.trim() || null;
	}
	private static async prepare(directory:string,lawsOnly=false){
		const root=(await this.git(directory,["rev-parse","--show-toplevel"])).trim();
		for(const name of ["MERGE_HEAD","CHERRY_PICK_HEAD","REVERT_HEAD","rebase-merge","rebase-apply","sequencer"]){
			const path=(await this.git(root,["rev-parse","--path-format=absolute","--git-path",name])).trim();
			if(await this.exists(path)){ throw new OfficeLawCommitError("Eine Git-Operation läuft bereits. Bitte zuerst im Terminal abschließen."); }
		}
		const gitDirectory=(await this.git(root,[
			"rev-parse","--path-format=absolute","--git-dir"
		])).trim();
		const temporary=await mkdtemp(join(gitDirectory,"j4-commit-"));
		const index=join(temporary,"index");
		try{
			const head=await this.head(root);
			await this.git(root,head === null ? ["read-tree","--empty"] : ["read-tree",head],index);
			const scope=lawsOnly ? "laws" : ".";
			if(!lawsOnly || await this.exists(join(root,"laws"))
				|| (await this.git(root,[
					"ls-files","--","laws"
				],index)).length>0){
				await this.git(root,["add","--all","--",scope],index);
			}
			const tree=(await this.git(root,["write-tree"],index)).trim();
			const realIndex=(await this.git(root,["rev-parse","--path-format=absolute","--git-path","index"])).trim();
			const indexBytes=await this.exists(realIndex) ? await readFile(realIndex) : Buffer.alloc(0);
			const token=createHash("sha256").update(JSON.stringify({head,tree})).update(indexBytes).digest("hex");
			const args=[
				"diff","--cached","--no-ext-diff","--no-textconv",
				...(lawsOnly ? ["--binary","--full-index","--no-renames"] : []),
				...(head === null ? [] : [head])
			];
			const paths=lawsOnly ? ["--","laws"] : [];
			const files=(await this.git(root,[
				...args,"--name-only","-z",...paths
			],index)).split("\0").filter(Boolean);
			const patch=await this.git(root,[...args,...paths],index);
			return {root,temporary,index,realIndex,preview:{head,token,files,patch}};
		}
		catch(error){ await rm(temporary,{recursive:true}); throw error; }
	}
	public static async preview(
		directory:string,lawsOnly=false
	):Promise<RepositoryCommitPreview>{
		const prepared=await this.prepare(directory,lawsOnly);
		try{ return prepared.preview; }
		finally{ await rm(prepared.temporary,{recursive:true}); }
	}
	public static async commit(directory:string,input:unknown):Promise<{hash:string}>{
		if(typeof input !== "object" || input === null || !("message" in input)
			|| typeof input.message !== "string" || !input.message.trim() || input.message.length>10000
			|| input.message.includes("\0") || !("token" in input) || typeof input.token !== "string"){
			throw new OfficeLawCommitError("Commit-Nachricht und gültige Vorschau sind erforderlich.",400);
		}
		const prepared=await this.prepare(directory);
		const lock=prepared.realIndex+".lock";
		let locked=false;
		try{
			const handle=await open(lock,"wx");
			locked=true;
			await handle.close();
			const latest=await this.prepare(directory);
			let unchanged:boolean;
			try{ unchanged=latest.preview.token === prepared.preview.token; }
			finally{ await rm(latest.temporary,{recursive:true}); }
			if(input.token !== prepared.preview.token || !unchanged){
				throw new OfficeLawCommitError("Repository geändert. Bitte die Vorschau aktualisieren.");
			}
			if(prepared.preview.files.length === 0){ throw new OfficeLawCommitError("Keine Änderungen zum Committen."); }
			// The real index stays untouched if identity validation or a commit hook fails.
			await this.git(prepared.root,["commit","-m",input.message.trim(),"-m",
				"Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"],prepared.index);
			const hash=(await this.git(prepared.root,["rev-parse","HEAD"])).trim();
			await this.git(prepared.root,["read-tree",hash],prepared.index);
			await copyFile(prepared.index,lock);
			await rename(lock,prepared.realIndex);
			locked=false;
			return {hash};
		}
		catch(error){
			if(error instanceof Error && "code" in error && error.code === "EEXIST"){
				throw new OfficeLawCommitError("Git ist beschäftigt (index.lock). Bitte später erneut versuchen.");
			}
			throw error;
		}
		finally{
			if(locked){ await rm(lock); }
			await rm(prepared.temporary,{recursive:true});
		}
	}
}
