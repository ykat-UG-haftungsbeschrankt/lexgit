import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { OfficeLawLayout } from "./layout";
import { OfficeLawXml } from "./xml";
import type {
	OfficeLawCitation,
	OfficeLawDocument,
	OfficeLawMetadata,
	OfficeLawNorm,
	OfficeLawStatusNote
} from "./types";

type OfficeXmlDocument=ReturnType<DOMParser["parseFromString"]>;
type OfficeXmlElement=NonNullable<
	OfficeXmlDocument["documentElement"]
>;
type OfficeXmlNodeList=OfficeXmlElement["childNodes"];
type OfficeXmlNode=NonNullable<
	ReturnType<OfficeXmlNodeList["item"]>
>;

export interface OfficeLawDirectoryOptions{
	slug:string;
	directory:string;
	indexPath:string;
};

const BLOCK_TAGS:ReadonlySet<string>=new Set([
	"P",
	"DL",
	"PRE",
	"UL",
	"OL",
	"LI",
	"TABLE",
	"TR"
]);

export class OfficeLawParser{
	constructor(){}

	public parse(xml:string):OfficeLawDocument{
		const document=OfficeLawXml.parseDocument(OfficeLawXml.format(xml));

		const root=document.documentElement;

		if(root === null || "dokumente" !== root.nodeName){
			throw new Error("Expected a dokumente XML root element.");
		}

		const rootDocumentNumber=this._requiredAttribute(root,"doknr");
		const norms=this._children(root,"norm");
		const rootNorm=norms[0];

		if(rootNorm === undefined){
			throw new Error("The law metadata norm is missing.");
		}

		const metadata=this._parseMetadata(rootNorm);
		const resultNorms:OfficeLawNorm[]=[];

		for(let index=1;index<norms.length;index++){
			const norm=norms[index];

			if(norm !== undefined){
				resultNorms.push(this._parseNorm(norm));
			}
		}

		return{
			slug:"",
			documentNumber:rootDocumentNumber,
			buildDate:this._attribute(root,"builddate"),
			normDocumentNumbers:resultNorms.map(
				(norm)=>norm.documentNumber
			),
			metadata,
			introductoryNotes:this._contentParagraphs(
				rootNorm,
				"fussnoten"
			),
			norms:resultNorms
		};
	}

	public async writeDirectory(
		xml:string,
		options:OfficeLawDirectoryOptions
	):Promise<OfficeLawDocument>{
		const parsed=this.parse(xml);
		const original=OfficeLawXml.parseDocument(OfficeLawXml.format(xml));
		const sources=new Map<string,string>();
		for(const norm of OfficeLawXml.children(
			original.documentElement!,"norm"
		).slice(1)){
			sources.set(norm.getAttribute("doknr") ?? "",
				OfficeLawXml.serialize(norm));
		}
		return this.writeDocumentDirectory(parsed,options,sources);
	}

	public async writeDocumentDirectory(
		parsed:OfficeLawDocument,
		options:OfficeLawDirectoryOptions,
		sources:ReadonlyMap<string,string>=new Map()
	):Promise<OfficeLawDocument>{
		if(!/^[a-z0-9-]+$/.test(options.slug)){
			throw new Error("The law slug must use lowercase letters and dashes.");
		}

		if(!/^https:\/\//.test(options.indexPath)){
			throw new Error("The law index path must be an HTTPS URL.");
		}

		const document:OfficeLawDocument={
			...parsed,
			slug:options.slug
		};
		const lawDirectory=resolve(options.directory);
		const normsDirectory=resolve(lawDirectory,"norms");
		const normPaths=OfficeLawLayout.createOfficeLawNormPaths(document.norms);

		await mkdir(normsDirectory,{recursive:true});

		for(const norm of document.norms){
			const source=OfficeLawXml.format(
				sources.get(norm.documentNumber) ?? OfficeLawXml.write(norm)
			);
			const stored=OfficeLawXml.parse(source);
			if(stored.documentNumber !== norm.documentNumber){
				throw new Error("Imported provision identity mismatch.");
			}
			const filePath=resolve(
				normsDirectory,
				OfficeLawLayout.officeLawNormPath({normPaths},norm.documentNumber)
			);

			await mkdir(dirname(filePath),{recursive:true});
			await this._writeAtomically(filePath,`${source.trimEnd()}\n`);
		}

		const manifest={
			slug:document.slug,
			documentNumber:document.documentNumber,
			buildDate:document.buildDate,
			indexPath:options.indexPath,
			normDocumentNumbers:document.normDocumentNumbers,
			normPaths,
			metadata:document.metadata,
			introductoryNotes:document.introductoryNotes
		};

		await this._writeAtomically(
			resolve(lawDirectory,"law.json"),
			`${JSON.stringify(manifest,null,"\t")}\n`
		);

		return{...document,normPaths};
	}

	public async convertFile(
		xmlFilePath:string,
		options:OfficeLawDirectoryOptions
	):Promise<OfficeLawDocument>{
		const xml=await readFile(xmlFilePath,"utf8");

		return this.writeDirectory(xml,options);
	}

	public destructor():void{}

	protected _onXmlError(
		errors:string[],
		level:string,
		message:string
	):void{
		errors.push(`${level}: ${message}`);
	}

	protected _parseMetadata(norm:OfficeXmlElement):OfficeLawMetadata{
		const metadata=this._firstChild(norm,"metadaten");

		if(metadata === null){
			throw new Error("The law metadata norm has no metadaten element.");
		}

		const citations:OfficeLawCitation[]=[];

		for(const citation of this._children(metadata,"fundstelle")){
			citations.push({
				type:this._attribute(citation,"typ"),
				periodical:this._childText(citation,"periodikum"),
				reference:this._childText(citation,"zitstelle")
			});
		}

		const statusNotes:OfficeLawStatusNote[]=[];

		for(const status of this._children(metadata,"standangabe")){
			statusNotes.push({
				type:this._childText(status,"standtyp"),
				text:this._childText(status,"standkommentar")
			});
		}

		return{
			abbreviation:this._childText(metadata,"jurabk"),
			officialAbbreviation:this._childText(metadata,"amtabk"),
			shortTitle:this._childText(metadata,"kurzue"),
			title:this._childText(metadata,"langue"),
			enactmentDate:this._childText(
				metadata,
				"ausfertigung-datum"
			),
			citations,
			statusNotes
		};
	}

	protected _parseNorm(norm:OfficeXmlElement):OfficeLawNorm{
		return OfficeLawXml.parse(OfficeLawXml.serialize(norm));
	}

	protected _contentParagraphs(
		norm:OfficeXmlElement,
		containerName:string
	):string[]{
		const textData=this._firstChild(norm,"textdaten");

		if(textData === null){
			return[];
		}

		const container=this._firstChild(textData,containerName);

		if(container === null){
			return[];
		}

		const content=this._firstChild(container,"Content");

		if(content === null){
			return[];
		}

		const paragraphs:string[]=[];

		for(const paragraph of this._children(content,"P")){
			const value=this._elementText(paragraph);

			if(value.length>0){
				paragraphs.push(value);
			}
		}

		if(0 === paragraphs.length){
			const value=this._elementText(content);

			if(value.length>0){
				paragraphs.push(value);
			}
		}

		return paragraphs;
	}

	protected _elementText(node:OfficeXmlNode):string{
		let value="";

		for(let index=0;index<node.childNodes.length;index++){
			const child=node.childNodes.item(index);

			if(child === null){
				continue;
			}

			if(child.nodeType === 3 || child.nodeType === 4){
				value+=child.nodeValue ?? "";
				continue;
			}

			if(child.nodeType !== 1){
				continue;
			}

			const tagName=child.nodeName.toUpperCase();

			if("BR" === tagName){
				value+="\n";
				continue;
			}

			if("DT" === tagName){
				if(0<value.length && !value.endsWith("\n")){
					value+="\n";
				}

				value+=this._elementText(child);
				value+="\n";
				continue;
			}

			if("DD" === tagName){
				value+=this._elementText(child);
				value+=this._containsElement(child,"DL")
					?"\n\n"
					:"\n";
				continue;
			}

			const isBlock=BLOCK_TAGS.has(tagName);

			if(isBlock){
				value+="\n";
			}

			value+=this._elementText(child);

			if(isBlock){
				value+="\n";
			}
		}

		const lines=value
			.replace(/\r\n?/g,"\n")
			.split("\n");
		const normalizedLines:string[]=[];

		for(const line of lines){
			const normalized=line.replace(/[ \t]+/g," ").trim();

			if(0<normalized.length){
				normalizedLines.push(normalized);
			}
			else if(
				0<normalizedLines.length
				&& normalizedLines[normalizedLines.length-1] !== ""
			){
				normalizedLines.push("");
			}
		}

		while(
			0<normalizedLines.length
			&& normalizedLines[normalizedLines.length-1] === ""
		){
			normalizedLines.pop();
		}

		return normalizedLines.join("\n");
	}

	protected _children(
		parent:OfficeXmlNode,
		tagName:string
	):OfficeXmlElement[]{
		const result:OfficeXmlElement[]=[];

		for(let index=0;index<parent.childNodes.length;index++){
			const child=parent.childNodes.item(index);

			if(
				child !== null
				&& this._isElement(child)
				&& child.nodeName.toLowerCase() === tagName.toLowerCase()
			){
				result.push(child);
			}
		}

		return result;
	}

	protected _containsElement(
		node:OfficeXmlNode,
		tagName:string
	):boolean{
		for(let index=0;index<node.childNodes.length;index++){
			const child=node.childNodes.item(index);

			if(child === null || !this._isElement(child)){
				continue;
			}

			if(
				child.nodeName.toLowerCase() === tagName.toLowerCase()
				|| this._containsElement(child,tagName)
			){
				return true;
			}
		}

		return false;
	}

	protected _isElement(
		node:OfficeXmlNode
	):node is OfficeXmlElement{
		return node.nodeType === 1;
	}

	protected _firstChild(
		parent:OfficeXmlNode,
		tagName:string
	):OfficeXmlElement|null{
		const children=this._children(parent,tagName);
		const child=children[0];

		return child ?? null;
	}

	protected _childText(
		parent:OfficeXmlNode,
		tagName:string
	):string|null{
		const child=this._firstChild(parent,tagName);

		if(child === null){
			return null;
		}

		const value=this._elementText(child);

		return 0<value.length ? value : null;
	}

	protected _attribute(
		element:OfficeXmlElement,
		name:string
	):string|null{
		if(!element.hasAttribute(name)){
			return null;
		}

		const attribute=element.getAttribute(name);

		if(attribute === null){
			return null;
		}

		const value=attribute.trim();

		return 0<value.length ? value : null;
	}

	protected _requiredAttribute(
		element:OfficeXmlElement,
		name:string
	):string{
		const value=this._attribute(element,name);

		if(value === null){
			throw new Error(
				`The ${element.nodeName} element is missing ${name}.`
			);
		}

		if(name === "doknr" && !/^[A-Z0-9]+$/.test(value)){
			throw new Error(
				`Invalid document number "${value}".`
			);
		}

		return value;
	}

	protected async _writeAtomically(
		filePath:string,
		content:string
	):Promise<void>{
		const temporaryPath=`${filePath}.${process.pid}.tmp`;

		await writeFile(temporaryPath,content,"utf8");
		await rename(temporaryPath,filePath);
	}
};
