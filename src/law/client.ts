import type { OfficeLawDocument } from "./types";
import { OfficeLawStorage } from "./storage";
import type { OfficeLawSummary } from "./storage";
import { OfficeLawCitations } from "./citations";
import type { OfficeLawCitationReference } from "./citations";
import type { OfficeLawCitationSpan } from "./citations";
import { OfficeLawHistoryParser } from "./history";
import type { RepositoryCommitPreview } from "./history";
import type { OfficeLawPatchPreview } from "./patch-types";

export interface OfficeLawCreateInput{
	abbreviation:string;
	title:string;
	shortTitle:string|null;
	indexPath:string;
};

export interface OfficeLawXmlSource{
	xml:string;
	token:string;
};

export interface OfficeLawCitationContent{
	title:utf8_t;
	text:utf8_t;
	fullText:utf8_t;
	sources:{
		xml:utf8_t;
		scopes:OfficeLawCitationSpan[];
	}[];
};

export class OfficeLawClient{
	public destructor():void{}

	public static async request(
		url:string,
		options:RequestInit={},
		errorMessage="Änderungen konnten nicht gespeichert werden"
	):Promise<unknown>{
		const response=await fetch(url,options);
		const text=await response.text();
		let value:unknown;
		try{
			value=JSON.parse(text);
		}
		catch(error){
			if(!(error instanceof SyntaxError)){
				throw error;
			}
			throw new Error(
				`${errorMessage}: ungültige Serverantwort (${response.status}).`
			);
		}
		if(!response.ok){
			throw new Error("object" === typeof value && null !== value
				&& "error" in value && "string" === typeof value.error
				?value.error:`${errorMessage} (${response.status}).`);
		}
		return value;
	}

	protected static _record(
		value:unknown
	):value is Record<string,unknown>{
		return "object" === typeof value && null !== value
			&& !Array.isArray(value);
	}

	protected static _string(value:unknown):value is string{
		return "string" === typeof value;
	}

	protected static _parsePatchPreview(value:unknown):OfficeLawPatchPreview{
		if(!this._record(value) || !Array.isArray(value.files)
			|| !value.files.every(this._string)
			|| "string" !== typeof value.token){
			throw new Error("Ungültige Patch-Vorschau.");
		}
		return{files:value.files,token:value.token};
	}

	public static async createLaw(
		input:OfficeLawCreateInput,signal:AbortSignal
	):Promise<OfficeLawDocument>{
		const value=await this.request("/api/laws",{
			method:"POST",headers:{"Content-Type":"application/json"},
			body:JSON.stringify(input),signal
		},"Gesetz konnte nicht angelegt werden");
		return OfficeLawStorage.parseOfficeLawDocument(value);
	}

	public static async loadProvisionXml(
		slug:string,id:string,signal:AbortSignal
	):Promise<OfficeLawXmlSource>{
		const value=await this.request(
			`/api/laws/${encodeURIComponent(slug)}/norms/`
				+`${encodeURIComponent(id)}/xml`,
			{signal},"XML konnte nicht geladen werden"
		);
		if(!this._record(value) || "string" !== typeof value.xml
			|| "string" !== typeof value.token){
			throw new Error("Ungültige XML-Antwort.");
		}
		return{xml:value.xml,token:value.token};
	}

	public static async saveProvisionXml(
		slug:string,id:string,source:OfficeLawXmlSource,signal:AbortSignal
	):Promise<void>{
		const value=await this.request(
			`/api/laws/${encodeURIComponent(slug)}/norms/`
				+`${encodeURIComponent(id)}/xml`,
			{
				method:"PUT",headers:{"Content-Type":"application/json"},
				body:JSON.stringify(source),signal
			},"XML konnte nicht gespeichert werden"
		);
		if(!this._record(value) || true !== value.saved
			|| id !== value.documentNumber){
			throw new Error("Ungültige XML-Speicherantwort.");
		}
	}

	public static async loadCommitPreview(
		signal:AbortSignal
	):Promise<RepositoryCommitPreview>{
		const value=await this.request(
			"/api/git/commit",{signal},"Vorschau konnte nicht geladen werden"
		);
		return OfficeLawHistoryParser.parseCommitPreview(value);
	}

	public static async commitChanges(
		message:string,token:string,signal:AbortSignal
	):Promise<{hash:string}>{
		const value=await this.request("/api/git/commit",{
			method:"POST",headers:{"Content-Type":"application/json"},
			body:JSON.stringify({message,token}),signal
		},"Commit konnte nicht erstellt werden");
		if(!this._record(value) || "string" !== typeof value.hash
			|| !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.hash)){
			throw new Error("Ungültige Commit-Antwort.");
		}
		return{hash:value.hash};
	}

	public static async loadPatchExport(
		signal:AbortSignal
	):Promise<RepositoryCommitPreview>{
		const value=await this.request(
			"/api/git/patch",{signal},"Patch konnte nicht exportiert werden"
		);
		return OfficeLawHistoryParser.parseCommitPreview(value);
	}

	public static async checkPatch(
		patch:string,signal:AbortSignal
	):Promise<OfficeLawPatchPreview>{
		const value=await this.request("/api/git/patch",{
			method:"POST",headers:{"Content-Type":"application/json"},
			body:JSON.stringify({patch,checkOnly:true}),signal
		},"Patch konnte nicht geprüft werden");
		return this._parsePatchPreview(value);
	}

	public static async applyPatch(
		patch:string,token:string,signal:AbortSignal
	):Promise<OfficeLawPatchPreview>{
		const value=await this.request("/api/git/patch",{
			method:"POST",headers:{"Content-Type":"application/json"},
			body:JSON.stringify({patch,checkOnly:false,token}),signal
		},"Patch konnte nicht importiert werden");
		return this._parsePatchPreview(value);
	}

	public static async loadLawSources(
		signal:AbortSignal
	):Promise<OfficeLawSummary[]>{
		const value=await this.request(
			"/api/laws",{signal},"Gesetze konnten nicht geladen werden"
		);
		if(!Array.isArray(value)){
			throw new Error("Die Gesetzesliste hat ein ungültiges Format.");
		}
		return value.map(OfficeLawStorage.parseOfficeLawSummary);
	}

	public static async loadLaw(
		source:OfficeLawSummary,
		signal:AbortSignal
	):Promise<OfficeLawDocument>{
		return OfficeLawStorage.parseOfficeLawDocument(await this.request(
			`/api/laws/${encodeURIComponent(source.slug)}`,
			{signal},`${source.title} konnte nicht geladen werden`
		));
	}

	public static async saveProvision(
		lawSlug:string,
		documentNumber:string,
		text:string
	):Promise<void>{
		const value=await this.request(
			`/api/laws/${encodeURIComponent(lawSlug)}/norms/`
				+encodeURIComponent(documentNumber),
			{
				method:"PUT",
				headers:{"Content-Type":"text/plain; charset=utf-8"},
				body:text
			},
			"Änderung konnte nicht gespeichert werden"
		);
		if(!this._record(value) || true !== value.saved
			|| documentNumber !== value.documentNumber){
			throw new Error("Ungültige Antwort beim Speichern der Vorschrift.");
		}
	}

	public static async removeLaw(
		source:OfficeLawSummary,signal:AbortSignal
	):Promise<void>{
		const value=await this.request(
			`/api/laws/${encodeURIComponent(source.slug)}`,
			{
				method:"DELETE",
				headers:{"Content-Type":"application/json"},
				body:JSON.stringify({documentNumber:source.documentNumber}),
				signal
			},
			"Gesetz konnte nicht entfernt werden"
		);
		if(!this._record(value) || true !== value.removed){
			throw new Error("Ungültige Antwort beim Entfernen des Gesetzes.");
		}
	}

	public static async importLaw(
		indexPath:string,
		xml:string,
		signal:AbortSignal
	):Promise<OfficeLawDocument>{
		const query=new URLSearchParams({indexPath});
		const value=await this.request(
			`/api/laws/import?${query.toString()}`,
			{
				method:"POST",
				headers:{"Content-Type":"application/xml; charset=utf-8"},
				body:xml,
				signal
			},
			"Gesetz konnte nicht importiert werden"
		);
		return OfficeLawStorage.parseOfficeLawDocument(value);
	}
};

export class OfficeLawCitationResolver{
	protected readonly _cache:Map<string,OfficeLawDocument>;

	constructor(
		protected readonly _law:OfficeLawDocument,
		protected readonly _sources:readonly OfficeLawSummary[],
		protected readonly _version:string|null=null
	){
		this._cache=null === this._version
			?new Map([[this._law.slug,this._law]])
			:new Map();
	}

	public destructor():void{
		this._cache.clear();
	}

	public async resolve(
		reference:OfficeLawCitationReference,
		signal:AbortSignal
	):Promise<OfficeLawCitationContent>{
		const source=OfficeLawCitations.citationLawSource(
			reference,this._law,this._sources
		);
		if(undefined === source){
			throw new Error(null === reference.lawName
				?"Das aktuelle Gesetz ist nicht verfügbar."
				:`${reference.lawName} ist nicht in der Gesetzesbibliothek verfügbar.`);
		}
		let law=this._cache.get(source.slug);
		if(undefined === law){
			if(null === this._version){
				law=await OfficeLawClient.loadLaw(source,signal);
			}
			else{
				const snapshotValue=await OfficeLawClient.request(
					`/api/git/history/${this._version}/laws/`
						+encodeURIComponent(source.slug),
					{signal},"Historisches Zitat konnte nicht geladen werden"
				);
				const snapshot=
					OfficeLawHistoryParser.parseRepositoryLawSnapshot(
						snapshotValue
					);
				if(null === snapshot.document){
					throw new Error(
						`${source.abbreviation} ist in diesem Commit nicht vorhanden.`
					);
				}
				law=snapshot.document;
			}
			if(!signal.aborted){
				this._cache.set(source.slug,law);
			}
		}

		const identifiers=OfficeLawCitations._expandCitationValues(
			reference.provisionIdentifiers
				?? [{
					start:reference.identifier.replace(/^§\s*/u,""),
					end:null
				}],
			law.norms.map(norm=>
				(norm.identifier ?? "").replace(/^§\s*/u,"")
			)
		);
		const norms=identifiers.map(identifier=>{
			const citation=`§ ${identifier}`;
			const norm=law.norms.find(item=>item.identifier === citation);

			if(undefined === norm){
				throw new Error(
					`${citation} wurde in ${source.abbreviation} nicht gefunden.`
				);
			}

			return norm;
		});
		const excerpts=norms.map(norm=>
			OfficeLawCitations.officeLawCitationExcerpt(norm,reference)
		);
		const fullText=norms.map(norm=>norm.paragraphs.join("\n\n"))
			.join("\n\n");
		const title=norms.map(norm=>[
			source.abbreviation,norm.identifier,norm.title
		].filter(Boolean).join(" · ")).join("; ");

		return{
			title,
			text:excerpts.join("\n\n"),
			fullText,
			sources:norms.every(OfficeLawCitationResolver._hasSource)
				?norms.map(
					OfficeLawCitationResolver._xmlSource.bind(null,reference)
				):[]
		};
	}

	protected static _xmlSource(
		reference:OfficeLawCitationReference,
		norm:OfficeLawDocument["norms"][size_t]
	):OfficeLawCitationContent["sources"][size_t]{
		if(undefined === norm.sourceXml){
			throw new Error("Citation source XML is missing.");
		}
		return{
			xml:norm.sourceXml,
			scopes:OfficeLawCitations.officeLawCitationScopes(norm,reference)
		};
	}

	protected static _hasSource(norm:OfficeLawDocument["norms"][size_t])
	:bool_t{
		return undefined !== norm.sourceXml;
	}
};
