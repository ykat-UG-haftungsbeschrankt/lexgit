import type {
	OfficeLawDocument,
	OfficeLawMetadata,
	OfficeLawNorm,
	OfficeLawNormFrontMatter,
	OfficeLawStatusNote,
	OfficeLawCitation
} from "./types";
import { OfficeLawLayout } from "./layout";
import { OfficeLawXml } from "./xml";

export interface OfficeLawManifest{
	slug:string;
	documentNumber:string;
	buildDate:string|null;
	indexPath:string;
	normDocumentNumbers:string[];
	normPaths?:Record<string,string>;
	metadata:OfficeLawMetadata;
	introductoryNotes:string[];
};

export interface OfficeLawSummary{
	slug:string;
	documentNumber:string;
	abbreviation:string;
	title:string;
	shortTitle:string|null;
	indexPath:string;
};

export class OfficeLawStorage{
	public destructor():void{}

	private static isRecord(value:unknown):value is Record<string,unknown>{
		return typeof value === "object"
			&& value !== null
			&& !Array.isArray(value);
	}

	private static nullableString(value:unknown):value is string|null{
		return value === null || typeof value === "string";
	}

	private static parseCitation(value:unknown):OfficeLawCitation{
		if(
			!OfficeLawStorage.isRecord(value)
			|| !OfficeLawStorage.nullableString(value.type)
			|| !OfficeLawStorage.nullableString(value.periodical)
			|| !OfficeLawStorage.nullableString(value.reference)
		){
			throw new Error("Invalid law citation metadata.");
		}

		return{
			type:value.type,
			periodical:value.periodical,
			reference:value.reference
		};
	}

	private static parseStatusNote(value:unknown):OfficeLawStatusNote{
		if(
			!OfficeLawStorage.isRecord(value)
			|| !OfficeLawStorage.nullableString(value.type)
			|| !OfficeLawStorage.nullableString(value.text)
		){
			throw new Error("Invalid law status metadata.");
		}

		return{
			type:value.type,
			text:value.text
		};
	}

	private static parseMetadata(value:unknown):OfficeLawMetadata{
		if(
			!OfficeLawStorage.isRecord(value)
			|| !OfficeLawStorage.nullableString(value.abbreviation)
			|| !OfficeLawStorage.nullableString(value.officialAbbreviation)
			|| !OfficeLawStorage.nullableString(value.shortTitle)
			|| !OfficeLawStorage.nullableString(value.title)
			|| !OfficeLawStorage.nullableString(value.enactmentDate)
			|| !Array.isArray(value.citations)
			|| !Array.isArray(value.statusNotes)
		){
			throw new Error("Invalid law metadata.");
		}

		return{
			abbreviation:value.abbreviation,
			officialAbbreviation:value.officialAbbreviation,
			shortTitle:value.shortTitle,
			title:value.title,
			enactmentDate:value.enactmentDate,
			citations:value.citations.map(OfficeLawStorage.parseCitation),
			statusNotes:value.statusNotes.map(OfficeLawStorage.parseStatusNote)
		};
	}

	private static parseHierarchy(value:unknown):OfficeLawNormFrontMatter["hierarchy"]{
		if(value === null){
			return null;
		}

		if(
			!OfficeLawStorage.isRecord(value)
			|| !OfficeLawStorage.nullableString(value.number)
			|| !OfficeLawStorage.nullableString(value.label)
			|| !OfficeLawStorage.nullableString(value.title)
		){
			throw new Error("Invalid provision hierarchy metadata.");
		}

		return{
			number:value.number,
			label:value.label,
			title:value.title
		};
	}

	public static parseOfficeLawNorm(value:unknown):OfficeLawNorm{
		if(
			!OfficeLawStorage.isRecord(value)
			|| typeof value.documentNumber !== "string"
			|| (value.kind !== "norm" && value.kind !== "section")
			|| !OfficeLawStorage.nullableString(value.identifier)
			|| !OfficeLawStorage.nullableString(value.title)
			|| !Array.isArray(value.paragraphs)
			|| !value.paragraphs.every((item)=>typeof item === "string")
			|| !Array.isArray(value.footnotes)
			|| !value.footnotes.every((item)=>typeof item === "string")
			|| (undefined !== value.sourceXml
				&& "string" !== typeof value.sourceXml)
		){
			throw new Error("Invalid provision data.");
		}

		return{
			documentNumber:value.documentNumber,
			kind:value.kind,
			identifier:value.identifier,
			title:value.title,
			hierarchy:OfficeLawStorage.parseHierarchy(value.hierarchy),
			paragraphs:value.paragraphs,
			footnotes:value.footnotes,
			...(undefined === value.sourceXml
				?{}:{sourceXml:value.sourceXml})
		};
	}

	public static parseOfficeLawSummary(
		value:unknown
	):OfficeLawSummary{
		if(
			!OfficeLawStorage.isRecord(value)
			|| typeof value.slug !== "string"
			|| typeof value.documentNumber !== "string"
			|| typeof value.abbreviation !== "string"
			|| typeof value.title !== "string"
			|| !(value.shortTitle === undefined || OfficeLawStorage.nullableString(value.shortTitle))
			|| typeof value.indexPath !== "string"
		){
			throw new Error("Invalid law summary.");
		}

		return{
			slug:value.slug,
			documentNumber:value.documentNumber,
			abbreviation:value.abbreviation,
			title:value.title,
			shortTitle:value.shortTitle ?? null,
			indexPath:value.indexPath
		};
	}

	public static parseOfficeLawDocument(
		value:unknown
	):OfficeLawDocument{
		if(
			!OfficeLawStorage.isRecord(value)
			|| typeof value.slug !== "string"
			|| typeof value.documentNumber !== "string"
			|| !OfficeLawStorage.nullableString(value.buildDate)
			|| !Array.isArray(value.normDocumentNumbers)
			|| !value.normDocumentNumbers.every(
				(item)=>typeof item === "string"
			)
			|| !Array.isArray(value.introductoryNotes)
			|| !value.introductoryNotes.every(
				(item)=>typeof item === "string"
			)
			|| !Array.isArray(value.norms)
		){
			throw new Error("Invalid law document.");
		}

		return{
			slug:value.slug,
			documentNumber:value.documentNumber,
			buildDate:value.buildDate,
			normDocumentNumbers:value.normDocumentNumbers,
			...OfficeLawStorage._documentPaths(
				value.normPaths,value.normDocumentNumbers
			),
			metadata:OfficeLawStorage.parseMetadata(value.metadata),
			introductoryNotes:value.introductoryNotes,
			norms:value.norms.map(OfficeLawStorage.parseOfficeLawNorm)
		};
	}

	protected static _documentPaths(
		value:unknown,ids:readonly utf8_t[]
	):{normPaths?:Record<utf8_t,utf8_t>}{
		if(undefined === value){
			return{};
		}
		if(!OfficeLawStorage.isRecord(value)){
			throw new Error("Invalid provision paths.");
		}
		const paths:Record<utf8_t,utf8_t>={};
		for(const id of ids){
			const path=value[id];
			if("string" !== typeof path){
				throw new Error(`Missing provision path for ${id}.`);
			}
			OfficeLawLayout.validateOfficeLawNormPath(path);
			paths[id]=path;
		}
		return{normPaths:paths};
	}

	public static parseOfficeLawManifest(
		source:string
	):OfficeLawManifest{
		const value:unknown=JSON.parse(source);

		if(
			!OfficeLawStorage.isRecord(value)
			|| typeof value.slug !== "string"
			|| typeof value.documentNumber !== "string"
			|| !OfficeLawStorage.nullableString(value.buildDate)
			|| typeof value.indexPath !== "string"
			|| !Array.isArray(value.normDocumentNumbers)
			|| !value.normDocumentNumbers.every(
				(item)=>typeof item === "string"
			)
			|| !Array.isArray(value.introductoryNotes)
			|| !value.introductoryNotes.every(
				(item)=>typeof item === "string"
			)
		){
			throw new Error("Invalid law manifest.");
		}

		let normPaths:Record<string,string>|undefined;

		if(value.normPaths !== undefined){
			if(!OfficeLawStorage.isRecord(value.normPaths)){
				throw new Error("Invalid provision paths in law manifest.");
			}

			const entries:[string,string][]=[];

			for(const [id,path] of Object.entries(value.normPaths)){
				if(typeof path !== "string"){
					throw new Error("Invalid provision paths in law manifest.");
				}

				entries.push([id,path]);
			}

			normPaths=Object.fromEntries(entries);
			const usedPaths=new Set<string>();

			for(const id of value.normDocumentNumbers){
				const path=OfficeLawLayout.officeLawNormPath({normPaths},id).toLowerCase();

				if(usedPaths.has(path)){
					throw new Error(`Duplicate provision path "${path}".`);
				}

				usedPaths.add(path);
			}
		}

		return{
			slug:value.slug,
			documentNumber:value.documentNumber,
			buildDate:value.buildDate,
			indexPath:value.indexPath,
			normDocumentNumbers:value.normDocumentNumbers,
			...(normPaths === undefined ? {} : {normPaths}),
			metadata:OfficeLawStorage.parseMetadata(value.metadata),
			introductoryNotes:value.introductoryNotes
		};
	}

	protected static _parseLegacyNorm(
		source:string
	):OfficeLawNorm{
		const frontMatter=source.match(
			/^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)?/
		);

		if(frontMatter === null){
			throw new Error("Provision Markdown has no JSON front matter.");
		}

		const value:unknown=JSON.parse(frontMatter[1] ?? "");

		if(
			!OfficeLawStorage.isRecord(value)
			|| typeof value.documentNumber !== "string"
			|| (value.kind !== "norm" && value.kind !== "section")
			|| !OfficeLawStorage.nullableString(value.identifier)
			|| !OfficeLawStorage.nullableString(value.title)
			|| !Array.isArray(value.footnotes)
			|| !value.footnotes.every((item)=>typeof item === "string")
		){
			throw new Error("Invalid provision Markdown front matter.");
		}

		const metadata:OfficeLawNormFrontMatter={
			documentNumber:value.documentNumber,
			kind:value.kind,
			identifier:value.identifier,
			title:value.title,
			hierarchy:OfficeLawStorage.parseHierarchy(value.hierarchy),
			footnotes:value.footnotes
		};
		const body=source.slice(frontMatter[0].length)
			.replace(/\r\n?/g,"\n")
			.replace(/\n$/,"");

		return{
			...metadata,
			paragraphs:0===body.length
				?[]
				:body.split(/\n{2,}/)
		};
	}

	public static parseOfficeLawNormSource(source:string):OfficeLawNorm{
		return source.trimStart().startsWith("<")
			?OfficeLawXml.parse(source)
			:OfficeLawStorage._parseLegacyNorm(source);
	};

	public static writeOfficeLawNorm(
		norm:OfficeLawNorm,source?:string
	):string{
		return OfficeLawXml.write(norm,
			source?.trimStart().startsWith("<") ? source : undefined);
	}

	public static validateOfficeLawNormXml(
		source:string,documentNumber:string
	):OfficeLawNorm{
		const norm=OfficeLawXml.parse(source);
		if(documentNumber !== norm.documentNumber){
			throw new Error("Die Dokumentnummer darf nicht geändert werden.");
		}
		if("section" === norm.kind
			&& !/^(?:\d{3})+$/.test(norm.hierarchy?.number ?? "")){
			throw new Error("Ungültige Gliederungskennzahl.");
		}
		return norm;
	}

	public static editOfficeLawNormText(
		source:string,text:string
	):string{
		const norm=OfficeLawStorage.parseOfficeLawNormSource(source);
		const body=text.replace(/\r\n?/g,"\n").replace(/\n+$/,"");
		if(body === norm.paragraphs.join("\n\n")){
			return source.trimStart().startsWith("<")
				?OfficeLawXml.format(source):source;
		}
		if(source.trimStart().startsWith("<")){
			return OfficeLawXml.write({
				...norm,paragraphs:body ? body.split(/\n{2,}/) : []
			},source);
		}
		const front=source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
		if(null === front){
			throw new Error("Invalid legacy provision front matter.");
		}
		return `${front[0]}\n${body}\n`;
	}

	public static createOfficeLawDocument(
		manifest:OfficeLawManifest,
		normMarkdownFiles:ReadonlyMap<string,string>
	):OfficeLawDocument{
		const norms:OfficeLawNorm[]=[];

		for(const documentNumber of manifest.normDocumentNumbers){
			const markdown=normMarkdownFiles.get(documentNumber);

			if(markdown === undefined){
				throw new Error(
					`Missing provision file ${documentNumber}.`
				);
			}

			const norm=OfficeLawStorage.parseOfficeLawNormSource(markdown);

			if(norm.documentNumber !== documentNumber){
				throw new Error(
					`Provision filename does not match ${documentNumber}.`
				);
			}

			norms.push(norm);
		}

		return{
			slug:manifest.slug,
			documentNumber:manifest.documentNumber,
			buildDate:manifest.buildDate,
			normDocumentNumbers:manifest.normDocumentNumbers,
			...(undefined === manifest.normPaths
				?{}:{normPaths:manifest.normPaths}),
			metadata:manifest.metadata,
			introductoryNotes:manifest.introductoryNotes,
			norms
		};
	}
}
