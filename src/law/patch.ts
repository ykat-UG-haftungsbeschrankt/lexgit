import { createHash } from "node:crypto";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OfficeLawCommitService } from "./commit";
import { OfficeLawGit } from "./git";
import { OfficeLawLayout } from "./layout";
import { OfficeLawStorage } from "./storage";

import type { OfficeLawPatchPreview } from "./patch-types";
export type { OfficeLawPatchPreview } from "./patch-types";

export class OfficeLawPatchError extends Error{
	constructor(message:string,public readonly status=400){
		super(message);
	}

	public destructor():void{}
};

export class OfficeLawPatchService{
	public destructor():void{}

	protected static _validPath(path:string):void{
		const parts=path.split("/");
		if("laws" !== parts[0] || !/^[a-z0-9-]+$/.test(parts[1] ?? "")
			|| parts.some((part)=>{
				return !part || "." === part || ".." === part
					|| /[\\:\u0000-\u001f\u007f]/.test(part);
			})
			|| !(3 === parts.length && "law.json" === parts[2]
				|| "norms" === parts[2]
					&& /\.(?:xml|md)$/.test(path))){
			throw new OfficeLawPatchError(
				`Nur Gesetzesdateien sind erlaubt: ${path}`
			);
		}
	}

	protected static async _checkPath(
		root:string,path:string
	):Promise<void>{
		let current=root;
		const parts=path.split("/");
		for(let i=0;i<parts.length;i++){
			current=join(current,parts[i] ?? "");
			let info;
			try{
				info=await lstat(current);
			}
			catch(error){
				if(error instanceof Error && "code" in error
					&& "ENOENT" === error.code){
					break;
				}
				throw error;
			}
			if(info.isSymbolicLink()
				|| (i<parts.length-1 ? !info.isDirectory() : !info.isFile())){
				throw new OfficeLawPatchError(
					`Unsicherer Dateipfad: ${path}`
				);
			}
		}
	}

	protected static async _validateLaw(
		root:string,index:string,slug:string
	):Promise<void>{
		const prefix=`laws/${slug}/`;
		const output=await OfficeLawGit._git(root,[
			"ls-files","--stage","-z","--",`laws/${slug}`
		],index);
		const files=new Set<string>();
		for(const entry of output.split("\0")){
			if(!entry){
				continue;
			}
			const tab=entry.indexOf("\t");
			const path=entry.slice(tab+1);
			if(tab<0 || !entry.startsWith("100644 ")
				|| !entry.slice(0,tab).endsWith(" 0")){
				throw new OfficeLawPatchError(
					"Der Patch enthält keine reguläre Textdatei."
				);
			}
			this._validPath(path);
			files.add(path);
		}
		if(0 === files.size){
			return;
		}
		const manifestPath=`${prefix}law.json`;
		if(!files.has(manifestPath)){
			throw new OfficeLawPatchError(
				`Gesetz ${slug}: law.json fehlt nach dem Import.`
			);
		}
		const manifest=OfficeLawStorage.parseOfficeLawManifest(
			await OfficeLawGit._git(root,["show",`:${manifestPath}`],index)
		);
		if(slug !== manifest.slug){
			throw new OfficeLawPatchError("Der Gesetzesordner passt nicht.");
		}
		const markdown=new Map<string,string>();
		files.delete(manifestPath);
		for(const number of manifest.normDocumentNumbers){
			const path=`${prefix}norms/`
				+OfficeLawLayout.officeLawNormPath(manifest,number);
			if(!files.delete(path)){
				throw new OfficeLawPatchError(`Vorschrift fehlt: ${path}`);
			}
			markdown.set(number,await OfficeLawGit._git(
				root,["show",`:${path}`],index
			));
		}
		if(0 !== files.size){
			throw new OfficeLawPatchError(
				"Der Patch hinterlässt nicht zugeordnete Vorschriften."
			);
		}
		OfficeLawStorage.createOfficeLawDocument(manifest,markdown);
	}

	public static async importPatch(
		directory:string,input:unknown
	):Promise<OfficeLawPatchPreview>{
		if("object" !== typeof input || null === input
			|| !("patch" in input) || "string" !== typeof input.patch
			|| !input.patch.trim() || input.patch.includes("\0")
			|| Buffer.byteLength(input.patch,"utf8")>8*1024*1024
			|| !("checkOnly" in input)
			|| "boolean" !== typeof input.checkOnly
			|| (!input.checkOnly
				&& (!("token" in input) || "string" !== typeof input.token))){
			throw new OfficeLawPatchError(
				"Patch-Datei und gültige Vorschau sind erforderlich."
			);
		}
		if(/^(?:rename|copy) (?:from|to) /m.test(input.patch)){
			throw new OfficeLawPatchError(
				"Umbenennungen bitte als Löschen und Hinzufügen exportieren."
			);
		}
		const root=(await OfficeLawGit._git(directory,[
			"rev-parse","--show-toplevel"
		])).trim();
		if(resolve(directory) !== resolve(root)){
			throw new OfficeLawPatchError(
				"Die Gesetzesbibliothek muss im Repository-Stamm liegen."
			);
		}
		const baseline=await OfficeLawCommitService.preview(root,true);
		const token=createHash("sha256");
		token.update(baseline.token);
		token.update(input.patch);
		const fingerprint=token.digest("hex");
		if(!input.checkOnly && "token" in input
			&& fingerprint !== input.token){
			throw new OfficeLawPatchError(
				"Bibliothek geändert. Bitte den Patch erneut prüfen.",409
			);
		}
		const gitDirectory=(await OfficeLawGit._git(root,[
			"rev-parse","--path-format=absolute","--git-dir"
		])).trim();
		const temporary=await mkdtemp(join(gitDirectory,"j4-patch-"));
		const patchFile=join(temporary,"changes.patch");
		const index=join(temporary,"index");
		try{
			await writeFile(patchFile,input.patch);
			const stats=await OfficeLawGit._git(root,[
				"apply","--numstat","-z",patchFile
			]);
			const files:string[]=[];
			for(const entry of stats.split("\0")){
				if(!entry){
					continue;
				}
				const match=/^\d+\t\d+\t(.+)$/.exec(entry);
				if(undefined === match?.[1]){
					throw new OfficeLawPatchError(
						"Nur Text-Patches ohne Umbenennungen sind erlaubt."
					);
				}
				const path=match[1];
				this._validPath(path);
				await this._checkPath(root,path);
				files.push(path);
			}
			if(0 === files.length){
				throw new OfficeLawPatchError("Die Patch-Datei ist leer.");
			}
			await OfficeLawGit._git(root,null === baseline.head
				?["read-tree","--empty"]:["read-tree",baseline.head],index);
			const tracked=await OfficeLawGit._git(root,[
				"ls-files","--","laws"
			],index);
			let hasLaws=true;
			try{
				await lstat(join(root,"laws"));
			}
			catch(error){
				if(error instanceof Error && "code" in error
					&& "ENOENT" === error.code){
					hasLaws=false;
				}
				else{
					throw error;
				}
			}
			if(hasLaws || tracked.length>0){
				await OfficeLawGit._git(root,[
					"add","--all","--","laws"
				],index);
			}
			await OfficeLawGit._git(root,[
				"apply","--cached",patchFile
			],index);
			const slugs=new Set(files.map((path)=>{
				return path.split("/")[1] ?? "";
			}));
			try{
				for(const slug of slugs){
					await this._validateLaw(root,index,slug);
				}
			}
			catch(error){
				if(error instanceof OfficeLawPatchError){
					throw error;
				}
				throw new OfficeLawPatchError(
					error instanceof Error
						?error.message:"Ungültige Gesetzesdateien."
				);
			}
			await OfficeLawGit._git(root,["apply","--check",patchFile]);
			if(!input.checkOnly){
				await OfficeLawGit._git(root,["apply",patchFile]);
			}
			return{files,token:fingerprint};
		}
		catch(error){
			if(error instanceof Error && "stderr" in error
				&& "string" === typeof error.stderr){
				throw new OfficeLawPatchError(
					`Patch konnte nicht angewendet werden: ${error.stderr}`,
					409
				);
			}
			throw error;
		}
		finally{
			await rm(temporary,{recursive:true});
		}
	}
};
