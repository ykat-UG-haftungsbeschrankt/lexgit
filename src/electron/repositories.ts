import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export class DesktopRepositories{
	private static execute=promisify(execFile);
	public static validateUrl(value:unknown):string{
		if(typeof value !== "string" || !value.trim() || value.length>2048 || /[\u0000-\u0020]/.test(value.trim())){
			throw new Error("Bitte eine gültige HTTPS- oder SSH-Repository-URL eingeben.");
		}
		const url=value.trim();
		if(/^git@[a-zA-Z0-9.-]+:[\w./-]+$/.test(url)){ return url; }
		const parsed=new URL(url);
		if(!["https:","ssh:"].includes(parsed.protocol) || !parsed.hostname
			|| parsed.password || parsed.protocol === "https:" && parsed.username){
			throw new Error("Nur HTTPS- oder SSH-Repository-URLs ohne eingebettete Zugangsdaten sind erlaubt.");
		}
		return url;
	}
	public static async root(directory:string):Promise<string>{
		const {stdout}=await this.execute("git",["rev-parse","--show-toplevel"],{
			cwd:directory,encoding:"utf8",timeout:15000,env:{...process.env,GIT_TERMINAL_PROMPT:"0"}
		});
		return realpath(stdout.trim());
	}
	public static async initializeLaws(root:string):Promise<void>{
		await mkdir(join(root,"laws"),{recursive:true});
	}
	public static async clone(url:string,parent:string):Promise<string>{
		const source=this.validateUrl(url);
		const directory=await mkdtemp(join(parent,"office-law-"));
		try{
			await this.execute("git",["-c","protocol.file.allow=never","clone","--",source,directory],{
				encoding:"utf8",timeout:180000,maxBuffer:8*1024*1024,
				env:{...process.env,GIT_TERMINAL_PROMPT:"0",GIT_SSH_COMMAND:"ssh -oBatchMode=yes"}
			});
			return await this.root(directory);
		}
		catch(error){
			await rm(directory,{recursive:true});
			throw error;
		}
	}
}
