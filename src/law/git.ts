import { execFile } from "node:child_process";
import { relative } from "node:path";
import { readFile } from "node:fs/promises";
import { OfficeLawLayout } from "./layout";
import { OfficeLawRepositoryComparison } from "./repository-comparison";
import { OfficeLawSelectedCommitComparison }
	from "./selected-commit-comparison";
import { OfficeLawHeadCommitComparison } from "./head-commit-comparison";
import type { RepositoryComparisonMode } from "./history";
import { promisify } from "node:util";
import { OfficeLawStorage } from "./storage";
import type {
	OfficeLawCommit, OfficeLawHistory, OfficeLawRevision,
	RepositoryCommit, RepositoryHistory, RepositoryRevision, RepositoryLawSnapshot
} from "./history";

export class OfficeLawGit{
private static readonly _execute=promisify(execFile);
private static readonly _hash=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

public static async _git(
	directory:string,args:string[],index?:string
):Promise<string>{
	const {stdout}=await OfficeLawGit._execute("git",[
		"--no-pager","--literal-pathspecs",...args
	],{
		cwd:directory,encoding:"utf8",maxBuffer:8*1024*1024,
		timeout:15000,
		env:{
			...process.env,GIT_OPTIONAL_LOCKS:"0",GIT_TERMINAL_PROMPT:"0",
			...(undefined === index ? {} : {GIT_INDEX_FILE:index})
		}
	});

	return stdout;
}

private static _commandFailure(
	error:unknown
):error is Error & {code:number; stderr:string}{
	return error instanceof Error && "code" in error
		&& "number" === typeof error.code
		&& "stderr" in error && typeof error.stderr === "string";
}

public static async readOfficeLawHistory(
	directory:string,
	filePath:string
):Promise<OfficeLawHistory>{
	let root:string;

	try{
		root=(await OfficeLawGit._git(
			directory,["rev-parse","--show-toplevel"]
		)).trim();
	}
	catch(error){
		if(OfficeLawGit._commandFailure(error)
			&& error.stderr.includes("not a git repository")){
			return{status:"no-repository",commits:[]};
		}

		throw error;
	}

	try{
		await OfficeLawGit._git(root,["rev-parse","--verify","--quiet","HEAD"]);
	}
	catch(error){
		if(OfficeLawGit._commandFailure(error)
			&& 1 === error.code && !error.stderr.trim()){
			return{status:"no-commits",commits:[]};
		}

		throw error;
	}

	let path=relative(root,filePath).split("\\").join("/");

	if(path.startsWith("../") || path === ".."){
		throw new Error("Provision file is outside the Git repository.");
	}

	const marker=path.indexOf("/norms/");
	if(0 <= marker){
		const base=path.slice(0,marker);
		const manifest=OfficeLawStorage.parseOfficeLawManifest(
			await readFile(`${root}/${base}/law.json`,"utf8")
		);
		const id=manifest.normDocumentNumbers.find((number)=>{
			return `${base}/norms/`
				+OfficeLawLayout.officeLawNormPath(manifest,number) === path;
		});
		if(undefined !== id){
			return OfficeLawGit._identityHistory(root,base,id);
		}
	}

	const output=await OfficeLawGit._git(root,[
		"log","--follow","--first-parent","--diff-merges=first-parent","-M",
		"--no-ext-diff","--no-textconv",
		"--format=%H%x00%aI%x00%an%x00%s","--name-status","-z","--",path
	]);
	const tokens=output.split("\0");
	const commits:OfficeLawCommit[]=[];
	let index=0;

	while(index<tokens.length){
		const hash=tokens[index++]?.trim();

		if(!hash){
			continue;
		}

		const date=tokens[index++];
		const author=tokens[index++];
		const message=tokens[index++];

		if(!OfficeLawGit._hash.test(hash) || undefined === date
			|| undefined === author || undefined === message){
			throw new Error("Unable to parse Git commit history.");
		}

		let previousPath:string|null=path;
		let found=false;

		while(index<tokens.length){
			const status=tokens[index]?.trim();

			if(!status || OfficeLawGit._hash.test(status)){
				if(!status){
					index++;
				}
				break;
			}

			index++;
			const firstPath=tokens[index++];
			const secondPath=/^[RC]\d+$/.test(status) ? tokens[index++] : undefined;

			if(undefined === firstPath
				|| (/^[RC]\d+$/.test(status) && undefined === secondPath)){
				throw new Error("Unable to parse Git file changes.");
			}

			if((secondPath ?? firstPath) === path){
				found=true;
				previousPath=status === "A" || status.startsWith("C")
					?null
					:firstPath;
			}
		}

		if(!found){
			throw new Error(`Git history has no matching file for ${hash}.`);
		}

		commits.push({hash,date,author,message,path,previousPath});
		path=previousPath ?? path;
	}

	return{status:"ready",commits};
}

protected static async _normAtCommit(
	root:string,hash:string,base:string,id:string
):Promise<{path:string;blob:string}|null>{
	const files=(await OfficeLawGit._git(root,[
		"ls-tree","-r","--name-only","-z",hash,"--",`${base}/law.json`
	])).split("\0");
	if(!files.includes(`${base}/law.json`)){
		return null;
	}
	const manifest=OfficeLawStorage.parseOfficeLawManifest(
		await OfficeLawGit._git(root,["show",`${hash}:${base}/law.json`])
	);
	if(!manifest.normDocumentNumbers.includes(id)){
		return null;
	}
	const path=`${base}/norms/`
		+OfficeLawLayout.officeLawNormPath(manifest,id);
	const blob=(await OfficeLawGit._git(root,[
		"rev-parse",`${hash}:${path}`
	])).trim();
	return{path,blob};
}

protected static async _identityHistory(
	root:string,base:string,id:string
):Promise<OfficeLawHistory>{
	// Identity survives XML migrations even without Git rename similarity.
	const output=await OfficeLawGit._git(root,[
		"log","--first-parent","--format=%H%x00%aI%x00%an%x00%s",
		"HEAD","--",base
	]);
	const commits:OfficeLawCommit[]=[];
	for(const line of output.trimEnd().split("\n")){
		if(!line){
			continue;
		}
		const [hash,date,author,message]=line.split("\0");
		if(undefined === hash || undefined === date
			|| undefined === author || undefined === message){
			throw new Error("Unable to parse norm identity history.");
		}
		const parents=(await OfficeLawGit._git(root,[
			"rev-list","--parents","-n","1",hash
		])).trim().split(" ");
		const current=await OfficeLawGit._normAtCommit(root,hash,base,id);
		const previous=undefined === parents[1] ? null
			:await OfficeLawGit._normAtCommit(root,parents[1],base,id);
		if(current?.blob === previous?.blob
			&& current?.path === previous?.path){
			continue;
		}
		const path=current?.path ?? previous?.path;
		if(undefined !== path){
			commits.push({
				hash,date,author,message,path,
				previousPath:previous?.path ?? null
			});
		}
	}
	return{status:"ready",commits};
}

public static async readRepositoryHistory(
	directory:string,
	offset=0
):Promise<RepositoryHistory>{
	if(!Number.isSafeInteger(offset) || offset<0){
		throw new Error("Invalid Git history offset.");
	}
	let root:string;
	try{
		root=(await OfficeLawGit._git(directory,["rev-parse","--show-toplevel"])).trim();
	}
	catch(error){
		if(OfficeLawGit._commandFailure(error) && error.stderr.includes("not a git repository")){
			return{status:"no-repository",commits:[],hasMore:false};
		}
		throw error;
	}
	try{
		await OfficeLawGit._git(root,["rev-parse","--verify","--quiet","HEAD"]);
	}
	catch(error){
		if(OfficeLawGit._commandFailure(error) && error.code === 1 && !error.stderr.trim()){
			return{status:"no-commits",commits:[],hasMore:false};
		}
		throw error;
	}
	const output=await OfficeLawGit._git(root,[
		"log","--topo-order",`--skip=${offset}`,"--max-count=51",
		"--format=%H%x00%aI%x00%an%x00%s%x00","HEAD","--"
	]);
	const tokens=output.split("\0");
	const commits:RepositoryCommit[]=[];
	for(let index=0;index<tokens.length;){
		const hash=tokens[index++]?.trim();
		if(!hash){continue;}
		const date=tokens[index++];
		const author=tokens[index++];
		const message=tokens[index++];
		if(!OfficeLawGit._hash.test(hash) || date === undefined
			|| author === undefined || message === undefined){
			throw new Error("Unable to parse repository history.");
		}
		commits.push({hash,date,author,message});
	}
	return{status:"ready",commits:commits.slice(0,50),hasMore:commits.length>50};
}

public static async readRepositoryRevision(
	directory:string,
	hash:string
):Promise<RepositoryRevision|null>{
	const root=await OfficeLawGit._reachableRoot(directory,hash);
	if(root === null){ return null; }
	const args=[
		"show","--format=","--first-parent","--diff-merges=first-parent",
		"--no-ext-diff","--no-textconv","-M"
	];
	const files=(await OfficeLawGit._git(root,[...args,"--name-only","-z",hash,"--"]))
		.split("\0").filter(Boolean);
	const patch=await OfficeLawGit._git(root,[...args,hash,"--"]);
	return{files,patch};
}

private static async _reachableRoot(directory:string,hash:string):Promise<string|null>{
	if(!OfficeLawGit._hash.test(hash)){
		return null;
	}
	const root=(await OfficeLawGit._git(directory,["rev-parse","--show-toplevel"])).trim();
	try{
		await OfficeLawGit._git(root,["merge-base","--is-ancestor",hash,"HEAD"]);
	}
	catch(error){
		if(OfficeLawGit._commandFailure(error) && (error.code === 1 || error.code === 128)){
			return null;
		}
		throw error;
	}
	return root;
}

public static async readRepositoryLawSnapshot(
	directory:string,
	hash:string,
	slug:string
):Promise<RepositoryLawSnapshot|null>{
	if(!/^[a-z0-9-]+$/.test(slug)){
		throw new Error("Invalid law slug.");
	}
	const root=await OfficeLawGit._reachableRoot(directory,hash);
	if(root === null){ return null; }
	const prefix=relative(root,directory).split("\\").join("/");
	const base=[prefix,"laws",slug].filter(Boolean).join("/");
	return OfficeLawSelectedCommitComparison.compare(
		OfficeLawGit._git,root,base,hash
	);
}

public static async readRepositoryLawComparison(
	directory:utf8_t,hash:utf8_t,slug:utf8_t,
	mode:RepositoryComparisonMode="head"
):Promise<RepositoryLawSnapshot|null>{
	if(!/^[a-z0-9-]+$/.test(slug)){
		throw new Error("Invalid law slug.");
	}
	const root=await OfficeLawGit._reachableRoot(directory,hash);
	if(null === root){
		return null;
	}
	const prefix=relative(root,directory).split("\\").join("/");
	const base=[prefix,"laws",slug].filter(Boolean).join("/");
	if("selected" === mode){
		return OfficeLawSelectedCommitComparison.compare(
			OfficeLawGit._git,root,base,hash
		);
	}
	if("latest" === mode){
		return OfficeLawHeadCommitComparison.compare(
			OfficeLawGit._git,root,base
		);
	}
	const head=(await OfficeLawGit._git(root,[
		"rev-parse","HEAD"
	])).trim();
	const snapshot=await OfficeLawRepositoryComparison.compare(
		OfficeLawGit._git,root,base,hash,head
	);
	return{...snapshot,comparisonVersion:head};
}

public static async readOfficeLawRevision(
	directory:string,
	commit:OfficeLawCommit
):Promise<OfficeLawRevision>{
	if(!OfficeLawGit._hash.test(commit.hash)){
		throw new Error("Invalid Git commit hash.");
	}

	const root=(await OfficeLawGit._git(
		directory,["rev-parse","--show-toplevel"]
	)).trim();
	const changes=await OfficeLawGit._git(root,[
		"show","--format=","--name-status","--first-parent",
		"--diff-merges=first-parent",
		"--no-ext-diff","--no-textconv","-M",
		commit.hash,"--",commit.path
	]);
	const deleted=changes.split("\n").some(line=>line.startsWith("D\t"));
	const current=deleted ? null : OfficeLawStorage.parseOfficeLawNormSource(
		await OfficeLawGit._git(root,["show",`${commit.hash}:${commit.path}`])
	);
	const previous=null === commit.previousPath ? null
		:OfficeLawStorage.parseOfficeLawNormSource(
			await OfficeLawGit._git(root,[
				"show",`${commit.hash}^:${commit.previousPath}`
			])
		);
	const patch=await OfficeLawGit._git(root,[
		"show","--format=","--first-parent","--diff-merges=first-parent",
		"--no-ext-diff","--no-textconv","-M",commit.hash,"--",
		...new Set([
			commit.path,
			...(null === commit.previousPath ? [] : [commit.previousPath])
		])
	]);

	return{previous,current,patch};
}

public destructor():void{}
};
