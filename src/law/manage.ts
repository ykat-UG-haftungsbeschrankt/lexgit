import {
	link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm,
	rmdir, unlink, writeFile
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { OfficeLawStorage } from "./storage";
import type { OfficeLawManifest } from "./storage";
import { OfficeLawLayout } from "./layout";
import { OfficeLawParser } from "./parser";
import type { OfficeLawDocument, OfficeLawNorm } from "./types";

export class OfficeLawManagementError extends Error{
	public readonly status:number;

	constructor(status:number,message:string){
		super(message);
		this.status=status;
	}

	public destructor():void{}
};

interface Entry{
	norm:OfficeLawNorm;
	path:string;
};

interface OfficeLawEditableMetadata{
	abbreviation:string;
	title:string;
	shortTitle:string|null;
	indexPath:string;
};

export class OfficeLawManagement{
private static _writeQueue:Promise<void>=Promise.resolve();

public static async withOfficeLawWriteLock<T>(
	action:()=>Promise<T>
):Promise<T>{
	const previous=OfficeLawManagement._writeQueue;
	let release:()=>void=()=>{};
	OfficeLawManagement._writeQueue=new Promise<void>((done)=>{release=done;});
	await previous;
	try{
		return await action();
	}
	finally{
		release();
	}
}

private static _invalid(message:string):never{
	throw new OfficeLawManagementError(400,message);
}

private static _conflict(message:string):never{
	throw new OfficeLawManagementError(409,message);
}

private static _record(value:unknown):value is Record<string,unknown>{
	return "object" === typeof value && null !== value
		&& !Array.isArray(value);
}

private static _exactKeys(value:Record<string,unknown>,keys:string[]):void{
	if(Object.keys(value).some((key)=>!keys.includes(key))){
		OfficeLawManagement._invalid("Unknown input field.");
	}
}

private static _nonempty(value:unknown,name:string):string{
	if("string" !== typeof value || !value.trim()
		|| /[\u0000-\u001f\u007f]/.test(value)){
		OfficeLawManagement._invalid(
			`${name} must be a nonempty string without control characters.`
		);
	}
	return value;
}

protected static _title(value:unknown,name:utf8_t):utf8_t{
	// Imported titles can contain XML line breaks and indentation.
	if("string" !== typeof value || !value.trim()
		|| /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)){
		OfficeLawManagement._invalid(
			`${name} must be nonempty and contain no invalid control characters.`
		);
	}
	return value;
}

protected static _nullableTitle(value:unknown,name:utf8_t):utf8_t|null{
	return null === value ? null : OfficeLawManagement._title(value,name);
}

private static _validSlug(value:unknown):string{
	if("string" !== typeof value || !/^[a-z0-9-]+$/.test(value)){
		OfficeLawManagement._invalid(
			"The law slug must use lowercase letters, digits and dashes."
		);
	}
	return value;
}

private static _validIndexPath(value:unknown):string{
	const indexPath=OfficeLawManagement._nonempty(value,"Index URL");
	try{
		const url=new URL(indexPath);
		if("https:" !== url.protocol || !url.hostname
			|| url.username || url.password){
			OfficeLawManagement._invalid(
				"The law index path must be an HTTPS URL."
			);
		}
	}
	catch(error){
		if(error instanceof OfficeLawManagementError){
			throw error;
		}
		OfficeLawManagement._invalid("The law index path must be an HTTPS URL.");
	}
	return indexPath;
}

private static _safePath(value:unknown):string{
	const path=OfficeLawManagement._nonempty(value,"Path");
	try{
		OfficeLawLayout.validateOfficeLawNormPath(path);
		if(!path.endsWith(".xml")){
			throw new Error("New provision paths must end in .xml.");
		}
	}
	catch(error){
		OfficeLawManagement._invalid(
			error instanceof Error ? error.message : "Invalid path."
		);
	}
	if(path.split("/").some((part)=>part.startsWith(".")
		|| /[<>|?*\u007f]/.test(part) || /[. ]$/.test(part))){
		OfficeLawManagement._invalid(`Unsafe provision path "${path}".`);
	}
	return path;
}

private static async _stat(path:string){
	try{
		return await lstat(path);
	}
	catch(error){
		if(OfficeLawManagement._record(error) && "ENOENT" === error.code){
			return null;
		}
		throw error;
	}
}

private static async _checkDirectory(path:string):Promise<void>{
	const info=await OfficeLawManagement._stat(path);
	if(null === info || !info.isDirectory() || info.isSymbolicLink()){
		OfficeLawManagement._conflict(
			"A law directory is missing or is not a real directory."
		);
	}
}

private static async _checkPath(
	root:string,path:string,created:string[]=[]
):Promise<void>{
	await OfficeLawManagement._checkDirectory(root);
	let directory=root;
	const parts=path.split("/");
	for(const part of parts.slice(0,-1)){
		const siblings=await readdir(directory);
		if(siblings.some((name)=>name.toLowerCase() === part.toLowerCase()
			&& name !== part)){
			OfficeLawManagement._conflict(
				`Case-insensitive directory collision at "${path}".`
			);
		}
		directory=resolve(directory,part);
		let info=await OfficeLawManagement._stat(directory);
		if(null === info){
			await mkdir(directory);
			created.push(directory);
			info=await lstat(directory);
		}
		if(!info.isDirectory() || info.isSymbolicLink()){
			OfficeLawManagement._conflict(`Unsafe directory in path "${path}".`);
		}
	}
	const file=parts.at(-1) ?? "";
	const siblings=await readdir(directory);
	if(siblings.some((name)=>name.toLowerCase() === file.toLowerCase()
		&& name !== file)){
		OfficeLawManagement._conflict(
			`Case-insensitive file collision at "${path}".`
		);
	}
	const info=await OfficeLawManagement._stat(resolve(root,path));
	if(null !== info && (!info.isFile() || info.isSymbolicLink())){
		OfficeLawManagement._conflict(`Path "${path}" is not a regular file.`);
	}
}

public static async createOfficeLaw(
	lawsRoot:string,input:unknown
):Promise<OfficeLawDocument>{
	if(!OfficeLawManagement._record(input)){
		OfficeLawManagement._invalid("Expected a law object.");
	}
	OfficeLawManagement._exactKeys(input,[
		"abbreviation","title","shortTitle","indexPath"
	]);
	const abbreviation=OfficeLawManagement._nonempty(
		input.abbreviation,"Abbreviation"
	);
	const slug=OfficeLawManagement._abbreviationSlug(abbreviation);
	const title=OfficeLawManagement._title(input.title,"Title");
	const shortTitle=OfficeLawManagement._nullableTitle(
		input.shortTitle,"Short title"
	);
	const indexPath=OfficeLawManagement._validIndexPath(input.indexPath);

	await mkdir(lawsRoot,{recursive:true});
	await OfficeLawManagement._checkDirectory(lawsRoot);
	const directory=resolve(lawsRoot,slug);
	if(null !== await OfficeLawManagement._stat(directory)){
		OfficeLawManagement._conflict("A law with this slug already exists.");
	}
	const manifest:OfficeLawManifest={
		slug,documentNumber:randomUUID().replace(/-/g,"").toUpperCase(),
		buildDate:null,indexPath,normDocumentNumbers:[],normPaths:{},
		metadata:{
			abbreviation,officialAbbreviation:null,title,shortTitle,
			enactmentDate:null,citations:[],statusNotes:[]
		},
		introductoryNotes:[]
	};
	OfficeLawStorage.parseOfficeLawManifest(JSON.stringify(manifest));
	let owned=false;
	let ownedNorms=false;
	let ownedManifest=false;
	try{
		try{
			await mkdir(directory);
			owned=true;
		}
		catch(error){
			if(OfficeLawManagement._record(error) && "EEXIST" === error.code){
				OfficeLawManagement._conflict(
					"A law with this slug already exists."
				);
			}
			throw error;
		}
		await mkdir(resolve(directory,"norms"));
		ownedNorms=true;
		await writeFile(resolve(directory,"law.json"),
			`${JSON.stringify(manifest,null,"\t")}\n`,{flag:"wx"});
		ownedManifest=true;
	}
	catch(error){
		if(owned){
			// Remove only the exact files/directories created by this operation.
			if(ownedManifest){
				await unlink(resolve(directory,"law.json"));
			}
			if(ownedNorms){
				await rmdir(resolve(directory,"norms"));
			}
			await rmdir(directory);
		}
		throw error;
	}
	return OfficeLawStorage.createOfficeLawDocument(manifest,new Map());
}

public static async removeOfficeLaw(
	lawsRoot:string,slug: string,input:unknown
):Promise<void>{
	const validSlug=OfficeLawManagement._validSlug(slug);
	if(!OfficeLawManagement._record(input)){
		OfficeLawManagement._invalid("Expected a law removal object.");
	}
	OfficeLawManagement._exactKeys(input,["documentNumber"]);
	const documentNumber=OfficeLawManagement._nonempty(
		input.documentNumber,"Document number"
	);
	await OfficeLawManagement._checkDirectory(lawsRoot);
	const directory=resolve(lawsRoot,validSlug);
	if(null === await OfficeLawManagement._stat(directory)){
		throw new OfficeLawManagementError(404,"Law not found.");
	}
	await OfficeLawManagement._checkDirectory(directory);
	const manifest=OfficeLawStorage.parseOfficeLawManifest(
		await readFile(resolve(directory,"law.json"),"utf8")
	);
	if(validSlug !== manifest.slug
		|| documentNumber !== manifest.documentNumber){
		OfficeLawManagement._conflict(
			"The selected law has changed. Reload before removing it."
		);
	}
	await rm(directory,{recursive:true});
}

protected static _abbreviationSlug(abbreviation:utf8_t):utf8_t{
	let normalized=abbreviation.trim();
	normalized=normalized.toLowerCase();
	normalized=normalized.replace(/ä/g,"ae");
	normalized=normalized.replace(/ö/g,"oe");
	normalized=normalized.replace(/ü/g,"ue");
	normalized=normalized.replace(/ß/g,"ss");
	normalized=normalized.replace(/[^a-z0-9]+/g,"-");
	normalized=normalized.replace(/^-+|-+$/g,"");
	return OfficeLawManagement._validSlug(normalized);
}

public static async importOfficeLaw(
	lawsRoot:string,input:unknown
):Promise<OfficeLawDocument>{
	if(!OfficeLawManagement._record(input)){
		OfficeLawManagement._invalid("Expected a law import object.");
	}
	OfficeLawManagement._exactKeys(input,["indexPath","xml"]);
	const indexPath=OfficeLawManagement._validIndexPath(input.indexPath);

	if("string" !== typeof input.xml || !input.xml.trim()){
		OfficeLawManagement._invalid(
			"The law XML file must not be empty."
		);
	}
	const parser=new OfficeLawParser();
	let slug:utf8_t;
	try{
		const abbreviation=parser.parse(input.xml).metadata.abbreviation;
		if(null === abbreviation || !abbreviation.trim()){
			OfficeLawManagement._invalid(
				"Die XML-Datei enthält keine Gesetzesabkürzung (jurabk)."
			);
		}
		slug=OfficeLawManagement._abbreviationSlug(abbreviation);
	}
	catch(error){
		if(error instanceof OfficeLawManagementError){
			throw error;
		}
		OfficeLawManagement._invalid(error instanceof Error
			?error.message:"Die XML-Datei konnte nicht gelesen werden.");
	}
	finally{
		parser.destructor();
	}

	await mkdir(lawsRoot,{recursive:true});
	await OfficeLawManagement._checkDirectory(lawsRoot);
	const directory=resolve(lawsRoot,slug);
	if(null !== await OfficeLawManagement._stat(directory)){
		OfficeLawManagement._conflict("A law with this slug already exists.");
	}

	const writer=new OfficeLawParser();
	try{
		return await writer.writeDirectory(
			input.xml,{slug,directory,indexPath}
		);
	}
	catch(error){
		// The import either wrote nothing or only part of a new law
		// directory; remove it so a retry does not see stale files.
		await rm(directory,{recursive:true,force:true});
		if(error instanceof OfficeLawManagementError){
			throw error;
		}
		OfficeLawManagement._invalid(
			error instanceof Error
				?error.message:"The law XML file could not be imported."
		);
	}
	finally{
		writer.destructor();
	}
}

private static _parseLawMetadata(input:unknown):OfficeLawEditableMetadata{
	if(!OfficeLawManagement._record(input)){
		OfficeLawManagement._invalid("Expected law metadata.");
	}
	OfficeLawManagement._exactKeys(input,[
		"abbreviation","title","shortTitle","indexPath"
	]);
	const abbreviation=OfficeLawManagement._nonempty(
		input.abbreviation,"Abbreviation"
	);
	const title=OfficeLawManagement._title(input.title,"Title");
	const shortTitle=OfficeLawManagement._nullableTitle(
		input.shortTitle,"Short title"
	);
	const indexPath=OfficeLawManagement._nonempty(input.indexPath,"Index URL");
	try{
		const url=new URL(indexPath);
		if("https:" !== url.protocol || !url.hostname
			|| url.username || url.password){
			OfficeLawManagement._invalid(
				"The law index path must be an HTTPS URL."
			);
		}
	}
	catch(error){
		if(error instanceof OfficeLawManagementError){
			throw error;
		}
		OfficeLawManagement._invalid("The law index path must be an HTTPS URL.");
	}
	return{abbreviation,title,shortTitle,indexPath};
}

private static _parseEntries(input:unknown):{
	entries:Entry[];
	expected:string[]|undefined;
	law:OfficeLawEditableMetadata|undefined;
}{
	if(!OfficeLawManagement._record(input) || !Array.isArray(input.entries)){
		OfficeLawManagement._invalid("Expected an entries array.");
	}
	OfficeLawManagement._exactKeys(input,[
		"entries","expectedNormDocumentNumbers","law"
	]);
	const law=undefined === input.law ? undefined
		:OfficeLawManagement._parseLawMetadata(input.law);
	const expected=input.expectedNormDocumentNumbers;
	if(undefined !== expected && (!Array.isArray(expected)
		|| !expected.every((id)=>"string" === typeof id
			&& /^[A-Z0-9]+$/.test(id))
		|| new Set(expected).size !== expected.length)){
		OfficeLawManagement._invalid(
			"Invalid expected provision document numbers."
		);
	}
	const ids=new Set<string>();
	const paths=new Set<string>();
	const numbers=new Set<string>();
	const sections:{number:string;directory:string}[]=[];
	const entries:Entry[]=[];
	for(const value of input.entries){
		if(!OfficeLawManagement._record(value)){
			OfficeLawManagement._invalid("Invalid structure entry.");
		}
		OfficeLawManagement._exactKeys(value,[
			"documentNumber","kind","identifier","title","hierarchy","path"
		]);
		let norm:OfficeLawNorm;
		try{
			norm=OfficeLawStorage.parseOfficeLawNorm({
				...value,paragraphs:[],footnotes:[]
			});
		}
		catch(error){
			OfficeLawManagement._invalid(
				error instanceof Error ? error.message : "Invalid entry."
			);
		}
		if(!/^[A-Z0-9]+$/.test(norm.documentNumber)
			|| ids.has(norm.documentNumber)){
			OfficeLawManagement._invalid(
				"Invalid or duplicate provision document number."
			);
		}
		ids.add(norm.documentNumber);
		norm.title=OfficeLawManagement._nullableTitle(
			norm.title,`Title of ${norm.documentNumber}`
		);
		const path=OfficeLawManagement._safePath(value.path);
		const lowerPath=path.toLowerCase();
		if(paths.has(lowerPath)){
			OfficeLawManagement._invalid(`Duplicate provision path "${path}".`);
		}
		paths.add(lowerPath);
		if("section" === norm.kind){
			const hierarchy=norm.hierarchy;
			if(null === hierarchy || null !== norm.identifier
				|| null !== norm.title || null === hierarchy.number
				|| !/^(?:\d{3})+$/.test(hierarchy.number)){
				OfficeLawManagement._invalid(
					"Sections require hierarchy and null identifier/title."
				);
			}
			if(!OfficeLawManagement._record(value.hierarchy)){
				OfficeLawManagement._invalid("Invalid section hierarchy.");
			}
			OfficeLawManagement._exactKeys(
				value.hierarchy,["number","label","title"]
			);
			hierarchy.label=OfficeLawManagement._nonempty(
				hierarchy.label,"Section label"
			);
			hierarchy.title=OfficeLawManagement._nullableTitle(
				hierarchy.title,`Section title of ${norm.documentNumber}`
			);
			if(numbers.has(hierarchy.number)){
				OfficeLawManagement._invalid("Duplicate section hierarchy number.");
			}
			numbers.add(hierarchy.number);
			while(sections.length){
				const previous=sections.at(-1);
				if(undefined !== previous
					&& hierarchy.number.startsWith(previous.number)
					&& hierarchy.number.length>previous.number.length){
					break;
				}
				sections.pop();
			}
			const parent=sections.at(-1);
			const directory=dirname(path);
			if("index.xml" !== basename(path)
				|| hierarchy.number.length !== (parent?.number.length ?? 0)+3
				|| dirname(directory) !== (parent?.directory ?? ".")){
				OfficeLawManagement._invalid(
					"Section path/order must match its hierarchy parent."
				);
			}
			sections.push({number:hierarchy.number,directory});
		}
		else{
			norm.identifier=OfficeLawManagement._nonempty(
				norm.identifier,"Provision identifier"
			);
			const directory=dirname(path);
			while(0<sections.length
				&& directory !== sections.at(-1)?.directory){
				sections.pop();
			}
			if(null !== norm.hierarchy || "index.xml" === basename(path)
				|| directory !== (sections.at(-1)?.directory ?? ".")){
				OfficeLawManagement._invalid(
					"Provision path/order must match its section."
				);
			}
		}
		entries.push({norm,path});
	}
	return{entries,expected:expected as string[]|undefined,law};
}

private static _updatedSource(
	source:string|undefined,norm:OfficeLawNorm
):string{
	const existing=undefined === source ? norm
		:OfficeLawStorage.parseOfficeLawNormSource(source);
	return OfficeLawStorage.writeOfficeLawNorm({
		...norm,paragraphs:existing.paragraphs,footnotes:existing.footnotes
	},source);
}

public static async updateOfficeLawStructure(
	directory:string,slug:string,input:unknown
):Promise<OfficeLawDocument>{
	OfficeLawManagement._validSlug(slug);
	const {entries,expected,law}=OfficeLawManagement._parseEntries(input);
	await OfficeLawManagement._checkDirectory(directory);
	const manifestPath=resolve(directory,"law.json");
	const manifestInfo=await OfficeLawManagement._stat(manifestPath);
	if(null === manifestInfo || !manifestInfo.isFile()
		|| manifestInfo.isSymbolicLink()){
		OfficeLawManagement._conflict("The law manifest must be a regular file.");
	}
	const source=await readFile(manifestPath,"utf8");
	const manifest=OfficeLawStorage.parseOfficeLawManifest(source);
	if(manifest.slug !== slug){
		OfficeLawManagement._conflict("Law identity mismatch.");
	}
	if(undefined !== expected && JSON.stringify(expected)
		!== JSON.stringify(manifest.normDocumentNumbers)){
		OfficeLawManagement._conflict(
			"The law structure changed. Reload before saving."
		);
	}
	const normsRoot=resolve(directory,"norms");
	await OfficeLawManagement._checkDirectory(normsRoot);
	const existing=new Map<string,{path:string;markdown:string}>();
	const registered=new Set<string>();
	for(const id of manifest.normDocumentNumbers){
		const path=OfficeLawLayout.officeLawNormPath(manifest,id);
		const info=await OfficeLawManagement._stat(resolve(normsRoot,path));
		if(null === info || !info.isFile() || info.isSymbolicLink()){
			OfficeLawManagement._conflict(
				"An existing provision is not a regular file."
			);
		}
		await OfficeLawManagement._checkPath(normsRoot,path);
		const markdown=await readFile(resolve(normsRoot,path),"utf8");
		const norm=OfficeLawStorage.parseOfficeLawNormSource(markdown);
		if(id !== norm.documentNumber
			|| existing.has(id) || registered.has(path.toLowerCase())){
			OfficeLawManagement._conflict(
				"Existing provision identity or path mismatch."
			);
		}
		existing.set(id,{path,markdown});
		registered.add(path.toLowerCase());
	}
	const ids=new Set(entries.map((entry)=>entry.norm.documentNumber));
	if([...existing.keys()].some((id)=>!ids.has(id))){
		OfficeLawManagement._invalid("Existing provisions cannot be deleted.");
	}
	const markdownFiles=new Map<string,string>();
	const changed:Entry[]=[];
	for(const entry of entries){
		const old=existing.get(entry.norm.documentNumber);
		if(undefined !== old && OfficeLawStorage.parseOfficeLawNormSource(
			old.markdown
		).kind !== entry.norm.kind){
			OfficeLawManagement._invalid(
				"Existing entry kinds cannot be converted."
			);
		}
		const markdown=OfficeLawManagement._updatedSource(
			old?.markdown,entry.norm
		);
		markdownFiles.set(entry.norm.documentNumber,markdown);
		if(undefined === old || old.path !== entry.path
			|| old.markdown !== markdown){
			changed.push(entry);
		}
	}
	const updated:OfficeLawManifest={
		...manifest,normDocumentNumbers:entries.map(
			(entry)=>entry.norm.documentNumber
		),
		...(undefined === law ? {} : {
			indexPath:law.indexPath,
			metadata:{
				...manifest.metadata,
				abbreviation:law.abbreviation,
				title:law.title,
				shortTitle:law.shortTitle
			}
		}),
		normPaths:Object.fromEntries(entries.map(
			(entry)=>[entry.norm.documentNumber,entry.path]
		))
	};
	const updatedSource=`${JSON.stringify(updated,null,"\t")}\n`;
	OfficeLawStorage.parseOfficeLawManifest(updatedSource);
	const document=OfficeLawStorage.createOfficeLawDocument(
		updated,markdownFiles
	);
	if(0 === changed.length
		&& JSON.stringify(updated) === JSON.stringify(manifest)){
		return document;
	}
	const stage=await mkdtemp(resolve(directory,".structure-"));
	const createdDirectories:string[]=[];
	const backups:{original:string;backup:string}[]=[];
	const installed:{path:string;markdown:string}[]=[];
	let committed=false;
	let recovered=true;
	try{
		for(const entry of changed){
			await OfficeLawManagement._checkPath(
				normsRoot,entry.path,createdDirectories
			);
			if(null !== await OfficeLawManagement._stat(
				resolve(normsRoot,entry.path)
			)
				&& !registered.has(entry.path.toLowerCase())){
				OfficeLawManagement._conflict(
					`Unregistered file at "${entry.path}" cannot be overwritten.`
				);
			}
			await writeFile(resolve(stage,entry.norm.documentNumber),
				markdownFiles.get(entry.norm.documentNumber) ?? "",{flag:"wx"});
		}
		await writeFile(resolve(stage,"law.json"),updatedSource,{flag:"wx"});
		if(source !== await readFile(manifestPath,"utf8")){
			OfficeLawManagement._conflict(
				"The law manifest changed while saving."
			);
		}
		for(const entry of changed){
			const old=existing.get(entry.norm.documentNumber);
			if(undefined === old){
				continue;
			}
			const original=resolve(normsRoot,old.path);
			if(old.markdown !== await readFile(original,"utf8")){
				OfficeLawManagement._conflict(
					"A provision changed while saving. Reload before saving."
				);
			}
			const backup=resolve(stage,`${entry.norm.documentNumber}.backup`);
			await rename(original,backup);
			backups.push({original,backup});
		}
		for(const entry of changed){
			const path=resolve(normsRoot,entry.path);
			await link(resolve(stage,entry.norm.documentNumber),path);
			installed.push({
				path,markdown:markdownFiles.get(entry.norm.documentNumber) ?? ""
			});
		}
		if(source !== await readFile(manifestPath,"utf8")){
			OfficeLawManagement._conflict(
				"The law manifest changed while saving."
			);
		}
		await rename(resolve(stage,"law.json"),manifestPath);
		committed=true;
		return document;
	}
	catch(error){
		try{
			for(const file of installed.reverse()){
				if(file.markdown !== await readFile(file.path,"utf8")){
					throw new Error("An installed file was edited during rollback.");
				}
				await unlink(file.path);
			}
			for(const backup of backups.reverse()){
				await link(backup.backup,backup.original);
			}
		}
		catch(rollbackError){
			recovered=false;
			throw new Error(
				`Save failed; recovery files preserved at ${stage}. `
				+(rollbackError instanceof Error ? rollbackError.message : "")
			);
		}
		throw error;
	}
	finally{
		if(committed || recovered){
			await rm(stage,{recursive:true,force:true});
		}
		for(const path of createdDirectories.reverse()){
			try{
				await rmdir(path);
			}
			catch(error){
				if(!OfficeLawManagement._record(error)
					|| !["ENOTEMPTY","ENOENT"].includes(
						String(error.code)
					)){
					throw error;
				}
			}
		}
	}
}

public destructor():void{}
};
