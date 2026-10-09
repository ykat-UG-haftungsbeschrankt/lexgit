import type { OfficeLawHierarchy, OfficeLawNorm } from "./types";
import { OfficeLawLayout } from "./layout";
import { OfficeLawStorage } from "./storage";

export interface OfficeLawStructureEntry{
	documentNumber:string;
	kind:"section"|"norm";
	identifier:string|null;
	title:string|null;
	hierarchy:OfficeLawHierarchy|null;
	path:string;
}

export interface OfficeLawEditableEntry extends OfficeLawStructureEntry{
	parentId:string|null;
}

export interface OfficeLawEditableMetadata{
	abbreviation:string;
	title:string;
	shortTitle:string|null;
	indexPath:string;
}

export class OfficeLawStructure{
	public static parseOfficeLawStructure(value:unknown):{
		entries:OfficeLawEditableEntry[];
		normDocumentNumbers:string[];
		law:OfficeLawEditableMetadata;
	}{
		if(typeof value !== "object" || value === null
			|| !("entries" in value) || !Array.isArray(value.entries)
			|| !("normDocumentNumbers" in value) || !Array.isArray(value.normDocumentNumbers)
			|| !value.normDocumentNumbers.every(id=>typeof id === "string")){
			throw new Error("Die Inhaltsstruktur hat ein ungültiges Format.");
		}

		if(!("law" in value) || typeof value.law !== "object" || value.law === null
			|| !("abbreviation" in value.law) || typeof value.law.abbreviation !== "string"
			|| !("title" in value.law) || typeof value.law.title !== "string"
			|| !("shortTitle" in value.law) || !(value.law.shortTitle === null || typeof value.law.shortTitle === "string")
			|| !("indexPath" in value.law) || typeof value.law.indexPath !== "string"){
			throw new Error("Ungültige Gesetzesangaben.");
		}
		const law={
			abbreviation:value.law.abbreviation,title:value.law.title,
			shortTitle:value.law.shortTitle,indexPath:value.law.indexPath
		};

		const sectionPaths=new Map<string,string>();
		const entries=value.entries.map((entry:unknown):OfficeLawEditableEntry=>{
			if(typeof entry !== "object" || entry === null
				|| !("path" in entry) || typeof entry.path !== "string"){
				throw new Error("Ungültiger Dateipfad in der Inhaltsstruktur.");
			}

			OfficeLawLayout.validateOfficeLawNormPath(entry.path);
			const norm=OfficeLawStorage.parseOfficeLawNorm({...entry,paragraphs:[],footnotes:[]});
			const directory=entry.path.slice(0,entry.path.lastIndexOf("/")+1).replace(/\/$/,"");
			const parentDirectory=norm.kind === "section"
				?directory.slice(0,Math.max(0,directory.lastIndexOf("/")))
				:directory;
			const parentId=sectionPaths.get(parentDirectory) ?? null;

			if(norm.kind === "section"){
				sectionPaths.set(directory,norm.documentNumber);
			}

			return{
				documentNumber:norm.documentNumber,kind:norm.kind,identifier:norm.identifier,
				title:norm.title,hierarchy:norm.hierarchy,path:entry.path,parentId
			};
		});

		return{entries,normDocumentNumbers:value.normDocumentNumbers,law};
	}

	public static entryDescendants(
		entries:readonly OfficeLawEditableEntry[],
		documentNumber:string
	):Set<string>{
		const ids=new Set([documentNumber]);
		let changed=true;

		while(changed){
			changed=false;
			for(const entry of entries){
				if(entry.parentId !== null && ids.has(entry.parentId) && !ids.has(entry.documentNumber)){
					ids.add(entry.documentNumber);
					changed=true;
				}
			}
		}

		return ids;
	}

	private static appendEntries(
		entries:readonly OfficeLawEditableEntry[],
		parentId:string|null,
		parentNumber:string,
		result:OfficeLawEditableEntry[],
		seen:Set<string>
	):void{
		let sectionNumber=0;
		for(const entry of entries.filter(entry=>entry.parentId === parentId)){
			if(seen.has(entry.documentNumber)){
				throw new Error("Die Inhaltsstruktur enthält eine zyklische Zuordnung.");
			}
			seen.add(entry.documentNumber);
			const hierarchy=entry.kind === "section" ? {
				number:parentNumber+String(++sectionNumber*10).padStart(3,"0"),
				label:entry.hierarchy?.label ?? "",
				title:entry.hierarchy?.title ?? null
			} : null;
			if(sectionNumber>99){
				throw new Error("Pro Ebene können höchstens 99 Abschnitte angelegt werden.");
			}
			const updated={...entry,hierarchy};
			result.push(updated);
			if(entry.kind === "section"){
				OfficeLawStructure.appendEntries(
					entries,entry.documentNumber,hierarchy?.number ?? "",result,seen
				);
			}
		}
	}

	public static arrangeOfficeLawEntries(
		entries:readonly OfficeLawEditableEntry[]
	):OfficeLawEditableEntry[]{
		const result:OfficeLawEditableEntry[]=[];
		const seen=new Set<string>();
		OfficeLawStructure.appendEntries(entries,null,"",result,seen);

		if(result.length !== entries.length){
			throw new Error("Ein übergeordneter Abschnitt fehlt oder enthält sich selbst.");
		}

		const directories=new Map<utf8_t,utf8_t>();
		const used=new Set<utf8_t>();
		const arranged:OfficeLawEditableEntry[]=[];
		for(const entry of result){
			const norm:OfficeLawNorm={
				...entry,paragraphs:[],footnotes:[]
			};
			const local=OfficeLawLayout.createOfficeLawNormPaths([norm]);
			let relative=local[entry.documentNumber]!;
			const parent=null === entry.parentId ? ""
				:directories.get(entry.parentId);
			if(undefined === parent){
				throw new Error("Der übergeordnete Abschnitt fehlt.");
			}
			let path=parent ? `${parent}/${relative}`:relative;
			if(used.has(path.toLowerCase())){
				if("section" === entry.kind){
					relative=relative.replace(
						"/index.xml",`--${entry.documentNumber}/index.xml`
					);
				}
				else{
					relative=relative.replace(
						/\.xml$/,`--${entry.documentNumber}.xml`
					);
				}
				path=parent ? `${parent}/${relative}`:relative;
			}
			if(used.has(path.toLowerCase())){
				throw new Error(`Doppelter Vorschriftenpfad: ${path}`);
			}
			OfficeLawLayout.validateOfficeLawNormPath(path);
			used.add(path.toLowerCase());
			if("section" === entry.kind){
				directories.set(entry.documentNumber,
					path.slice(0,path.lastIndexOf("/")));
			}
			arranged.push({...entry,path});
		}
		return arranged;
	}

	public static moveOfficeLawEntry(
		entries:readonly OfficeLawEditableEntry[],
		id:string,
		parentId:string|null
	):OfficeLawEditableEntry[]{
		if(parentId !== null && OfficeLawStructure.entryDescendants(entries,id).has(parentId)){
			throw new Error("Ein Abschnitt kann nicht in sich selbst verschoben werden.");
		}
		return OfficeLawStructure.arrangeOfficeLawEntries(entries.map(entry=>entry.documentNumber === id
			?{...entry,parentId}:entry));
	}

	public static reorderOfficeLawEntry(
		entries:readonly OfficeLawEditableEntry[],
		id:string,
		direction:-1|1
	):OfficeLawEditableEntry[]{
		const entry=entries.find(entry=>entry.documentNumber === id);
		if(entry === undefined){
			throw new Error("Der ausgewählte Eintrag fehlt.");
		}
		const siblings=entries.filter(item=>item.parentId === entry.parentId);
		const neighbor=siblings[siblings.indexOf(entry)+direction];
		if(neighbor === undefined){
			return [...entries];
		}
		const currentIds=OfficeLawStructure.entryDescendants(entries,id);
		const neighborIds=OfficeLawStructure.entryDescendants(entries,neighbor.documentNumber);
		const first=direction === -1 ? neighborIds : currentIds;
		const second=direction === -1 ? currentIds : neighborIds;
		const start=entries.findIndex(item=>first.has(item.documentNumber));
		const remaining=entries.filter(item=>!first.has(item.documentNumber) && !second.has(item.documentNumber));
		remaining.splice(start,0,
			...entries.filter(item=>second.has(item.documentNumber)),
			...entries.filter(item=>first.has(item.documentNumber))
		);
		return OfficeLawStructure.arrangeOfficeLawEntries(remaining);
	}
}
