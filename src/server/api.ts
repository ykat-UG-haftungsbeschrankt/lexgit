import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { OfficeLawStorage } from "../law/storage";
import { OfficeLawXml } from "../law/xml";
import { OfficeLawLayout } from "../law/layout";
import { OfficeLawGit } from "../law/git";
import { OfficeLawCommitService, OfficeLawCommitError } from "../law/commit";
import { OfficeLawPatchService, OfficeLawPatchError } from "../law/patch";
import {
	OfficeLawManagement, OfficeLawManagementError
} from "../law/manage";

type NextFunction=()=>void;

export function createOfficeLawApi(projectRoot:string,options:{origin?:string;token?:string}={}){

interface OfficeLawDirectory{
	slug:string;
	directory:string;
};

class OfficeLawApi{
private static readonly _projectRoot=resolve(projectRoot);
private static readonly _lawsRoot=resolve(OfficeLawApi._projectRoot,"laws");
private static readonly _maxEditBytes=512*1024;
private static readonly _maxImportBytes=32*1024*1024;

protected static _onMissingLaws(error:unknown):Dirent[]{
	if(error instanceof Error && "code" in error && "ENOENT" === error.code){
		return[];
	}
	throw error;
}

private static async _lawDirectories():Promise<OfficeLawDirectory[]>{
	const entries=await readdir(
		OfficeLawApi._lawsRoot,{withFileTypes:true}
	).catch(OfficeLawApi._onMissingLaws);
	const directories:OfficeLawDirectory[]=[];

	for(const entry of entries){
		if(!entry.isDirectory() || !/^[a-z0-9-]+$/.test(entry.name)){
			continue;
		}

		directories.push({
			slug:entry.name,
			directory:resolve(OfficeLawApi._lawsRoot,entry.name)
		});
	}

	return directories;
}

private static async _readManifest(directory:string){
	const source=await readFile(
		resolve(directory,"law.json"),
		"utf8"
	);

	return OfficeLawStorage.parseOfficeLawManifest(source);
}

private static async _readLaw(directory:string){
	const manifest=await OfficeLawApi._readManifest(directory);
	const markdownFiles=new Map<string,string>();

	for(const documentNumber of manifest.normDocumentNumbers){
		if(!/^[A-Z0-9]+$/.test(documentNumber)){
			throw new Error("Invalid provision document number.");
		}

		const file=resolve(
			directory,
			"norms",
			OfficeLawLayout.officeLawNormPath(manifest,documentNumber)
		);
		const markdown=await readFile(file,"utf8");
		const norm=OfficeLawStorage.parseOfficeLawNormSource(markdown);

		if(norm.documentNumber !== documentNumber){
			throw new Error(
				`Provision filename does not match ${documentNumber}.`
			);
		}

		markdownFiles.set(documentNumber,markdown);
	}

	return{
		manifest,
		document:OfficeLawStorage.createOfficeLawDocument(manifest,markdownFiles)
	};
}

private static _sendJson(
	response:ServerResponse,
	status:number,
	value:unknown
):void{
	response.statusCode=status;
	response.setHeader("Content-Type","application/json; charset=utf-8");
	response.setHeader("Cache-Control","no-store");
	response.end(JSON.stringify(value));
}

private static _isLocalHost(hostHeader:string|undefined):boolean{
	if(hostHeader === undefined){
		return false;
	}

	const hostname=new URL(`http://${hostHeader}`).hostname;

	return hostname === "localhost"
		|| hostname === "127.0.0.1"
		|| hostname === "[::1]"
		|| hostname === "::1";
}

private static async _readRequestBody(
	request:IncomingMessage,
	maxBytes:number=OfficeLawApi._maxEditBytes,
	exceededMessage="Edited provision exceeds the size limit."
):Promise<string>{
	const chunks:Buffer[]=[];
	let byteCount=0;

	for await (const chunk of request){
		const data=Buffer.isBuffer(chunk)
			?chunk
			:Buffer.from(chunk);
		byteCount+=data.length;

		if(maxBytes<byteCount){
			throw new Error(exceededMessage);
		}

		chunks.push(data);
	}

	return Buffer.concat(chunks).toString("utf8");
}

private static async _handleLawApi(
	request:IncomingMessage,
	response:ServerResponse,
	next:NextFunction
):Promise<void>{
	const requestUrl=new URL(
		request.url ?? "/",
		"http://localhost"
	);

	if(!requestUrl.pathname.startsWith("/api/laws")
		&& !requestUrl.pathname.startsWith("/api/git")){
		next();
		return;
	}

	try{
		if(options.origin !== undefined && request.headers.host !== new URL(options.origin).host){
			OfficeLawApi._sendJson(response,403,{error:"Invalid desktop host."});
			return;
		}
		if(options.token !== undefined && request.headers.cookie?.split(";").map(part=>part.trim())
			.includes(`office-law-session=${options.token}`) !== true){
			OfficeLawApi._sendJson(response,403,{error:"Desktop session required."});
			return;
		}
		if(undefined !== options.origin
			&& ("PUT" === request.method || "POST" === request.method
				|| "DELETE" === request.method)){
			if(request.headers.origin !== options.origin){
				OfficeLawApi._sendJson(response,403,{error:"Same-origin access required."});
				return;
			}
		}
		if(!OfficeLawApi._isLocalHost(request.headers.host)){
			OfficeLawApi._sendJson(response,403,{error:"Local access only."});
			return;
		}

		const origin=request.headers.origin;
		const segments=requestUrl.pathname.split("/").filter(Boolean);

		if("/api/git/patch" === requestUrl.pathname){
			if("GET" === request.method){
				OfficeLawApi._sendJson(response,200,
					await OfficeLawCommitService.preview(
						OfficeLawApi._projectRoot,true
					));
				return;
			}
			if("POST" === request.method){
				if(origin !== `http://${request.headers.host}`){
					OfficeLawApi._sendJson(response,403,{
						error:"Same-origin access required."
					});
					return;
				}
				if("application/json" !== request.headers["content-type"]
					?.split(";")[0]?.trim()){
					OfficeLawApi._sendJson(response,415,{
						error:"Patch import must use application/json."
					});
					return;
				}
				let input:unknown;
				try{
					input=JSON.parse(await OfficeLawApi._readRequestBody(
						request,OfficeLawApi._maxImportBytes,
						"Patch exceeds the size limit."
					));
				}
				catch(error){
					OfficeLawApi._sendJson(response,400,{
						error:error instanceof Error
							?error.message:"Invalid JSON request."
					});
					return;
				}
				OfficeLawApi._sendJson(response,200,
					await OfficeLawPatchService.importPatch(
						OfficeLawApi._projectRoot,input
					));
				return;
			}
		}

		if(requestUrl.pathname === "/api/git/commit" && (request.method === "GET" || request.method === "POST")){
			if(request.method === "GET"){
				OfficeLawApi._sendJson(response,200,await OfficeLawCommitService.preview(OfficeLawApi._projectRoot));
				return;
			}
			if(origin === undefined || origin !== `http://${request.headers.host}`){
				OfficeLawApi._sendJson(response,403,{error:"Same-origin access required."});
				return;
			}
			if(request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json"){
				OfficeLawApi._sendJson(response,415,{error:"Commit must use application/json."});
				return;
			}
			let input:unknown;
			try{ input=JSON.parse(await OfficeLawApi._readRequestBody(request)); }
			catch(error){
				OfficeLawApi._sendJson(response,400,{error:error instanceof Error ? error.message : "Invalid JSON."});
				return;
			}
			try{
				OfficeLawApi._sendJson(response,201,await OfficeLawCommitService.commit(OfficeLawApi._projectRoot,input));
			}
			catch(error){
				if(error instanceof OfficeLawCommitError){
					OfficeLawApi._sendJson(response,error.status,{error:error.message});
					return;
				}
				throw error;
			}
			return;
		}

		if(request.method === "GET" && segments.length === 6
			&& segments[0] === "api" && segments[1] === "git" && segments[2] === "history"
			&& segments[4] === "laws" && /^[a-z0-9-]+$/.test(segments[5] ?? "")){
			const comparison=requestUrl.searchParams.get("compare");
			if(null !== comparison && "head" !== comparison
				&& "selected" !== comparison && "latest" !== comparison){
				OfficeLawApi._sendJson(response,400,{
					error:"Invalid comparison version."
				});
				return;
			}
			const snapshot=null !== comparison
				?await OfficeLawGit.readRepositoryLawComparison(
					OfficeLawApi._projectRoot,
					segments[3] ?? "",segments[5] ?? "",comparison
				)
				:await OfficeLawGit.readRepositoryLawSnapshot(
					OfficeLawApi._projectRoot,
					segments[3] ?? "",segments[5] ?? ""
				);
			OfficeLawApi._sendJson(response,snapshot === null ? 404 : 200,
				snapshot ?? {error:"Commit not found in repository history."});
			return;
		}

		if(request.method === "GET" && segments[0] === "api"
			&& segments[1] === "git" && segments[2] === "history"
			&& (segments.length === 3 || segments.length === 4)){
			if(segments.length === 3){
				const offset=requestUrl.searchParams.get("offset") ?? "0";
				if(!/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset))){
					OfficeLawApi._sendJson(response,400,{error:"Invalid Git history offset."});
					return;
				}
				OfficeLawApi._sendJson(response,200,await OfficeLawGit.readRepositoryHistory(
					OfficeLawApi._projectRoot,Number(offset)
				));
				return;
			}
			const history=await OfficeLawGit.readRepositoryHistory(OfficeLawApi._projectRoot);
			const revision=history.status === "ready"
				?await OfficeLawGit.readRepositoryRevision(OfficeLawApi._projectRoot,segments[3] ?? "")
				:null;
			OfficeLawApi._sendJson(response,revision === null ? 404 : 200,
				revision ?? {error:"Commit not found in repository history."});
			return;
		}

		if(("GET" === request.method || "PUT" === request.method)
			&& 6 === segments.length
			&& "api" === segments[0] && "laws" === segments[1]
			&& /^[a-z0-9-]+$/.test(segments[2] ?? "")
			&& "norms" === segments[3]
			&& /^[A-Z0-9]+$/.test(segments[4] ?? "")
			&& "xml" === segments[5]){
			const directory=resolve(
				OfficeLawApi._lawsRoot,segments[2] ?? ""
			);
			const lawDirectory=(await OfficeLawApi._lawDirectories()).find(
				(entry)=>{ return entry.directory === directory; }
			);
			if(undefined === lawDirectory){
				OfficeLawApi._sendJson(response,404,{error:"Law not found."});
				return;
			}
			const manifest=await OfficeLawApi._readManifest(directory);
			const id=segments[4] ?? "";
			if(!manifest.normDocumentNumbers.includes(id)){
				OfficeLawApi._sendJson(response,404,{
					error:"Provision not found."
				});
				return;
			}
			const path=OfficeLawLayout.officeLawNormPath(manifest,id);
			if(!path.endsWith(".xml")){
				OfficeLawApi._sendJson(response,409,{
					error:"Diese Vorschrift ist noch nicht als XML gespeichert."
				});
				return;
			}
			const file=resolve(directory,"norms",path);
			const xml=await readFile(file,"utf8");
			const hash=createHash("sha256");
			hash.update(xml);
			const token=hash.digest("hex");
			if("GET" === request.method){
				OfficeLawApi._sendJson(response,200,{xml,token});
				return;
			}
			if(origin !== `http://${request.headers.host}`){
				OfficeLawApi._sendJson(response,403,{
					error:"Same-origin access required."
				});
				return;
			}
			if("application/json" !== request.headers["content-type"]
				?.split(";")[0]?.trim()){
				OfficeLawApi._sendJson(response,415,{
					error:"XML editing must use application/json."
				});
				return;
			}
			let input:unknown;
			try{
				input=JSON.parse(await OfficeLawApi._readRequestBody(request));
			}
			catch(error){
				OfficeLawApi._sendJson(response,400,{
					error:error instanceof Error ? error.message
						:"Invalid JSON request."
				});
				return;
			}
			if("object" !== typeof input || null === input
				|| !("xml" in input) || "string" !== typeof input.xml
				|| !("token" in input) || "string" !== typeof input.token){
				OfficeLawApi._sendJson(response,400,{
					error:"XML und eine gültige Dateiversion sind erforderlich."
				});
				return;
			}
			if(token !== input.token){
				OfficeLawApi._sendJson(response,409,{
					error:"Datei geändert. Bitte den XML-Editor neu öffnen."
				});
				return;
			}
			let formatted:string;
			try{
				const previous=OfficeLawStorage.parseOfficeLawNormSource(xml);
				formatted=OfficeLawXml.format(input.xml);
				const updated=OfficeLawStorage.validateOfficeLawNormXml(
					formatted,id
				);
				if(previous.kind !== updated.kind
					|| previous.hierarchy?.number !== updated.hierarchy?.number){
					throw new Error(
						"Gliederungsänderungen bitte im Inhaltsverzeichnis vornehmen."
					);
				}
			}
			catch(error){
				OfficeLawApi._sendJson(response,400,{
					error:error instanceof Error ? error.message
						:"Ungültiges Vorschriften-XML."
				});
				return;
			}
			const temporary=`${file}.${process.pid}.tmp`;
			await writeFile(temporary,formatted,"utf8");
			await rename(temporary,file);
			OfficeLawApi._sendJson(response,200,{saved:true,documentNumber:id});
			return;
		}

		if(
			request.method === "GET"
			&& (segments.length === 6 || segments.length === 7)
			&& segments[0] === "api" && segments[1] === "laws"
			&& /^[a-z0-9-]+$/.test(segments[2] ?? "")
			&& segments[3] === "norms"
			&& /^[A-Z0-9]+$/.test(segments[4] ?? "")
			&& segments[5] === "history"
		){
			const lawDirectory=(await OfficeLawApi._lawDirectories()).find(
				(entry)=>entry.slug === segments[2]
			);

			if(lawDirectory === undefined){
				OfficeLawApi._sendJson(response,404,{error:"Law not found."});
				return;
			}

			const manifest=await OfficeLawApi._readManifest(lawDirectory.directory);
			const documentNumber=segments[4] ?? "";

			if(!manifest.normDocumentNumbers.includes(documentNumber)){
				OfficeLawApi._sendJson(response,404,{error:"Provision not found."});
				return;
			}

			const history=await OfficeLawGit.readOfficeLawHistory(
				OfficeLawApi._projectRoot,
				resolve(
					lawDirectory.directory,"norms",
					OfficeLawLayout.officeLawNormPath(manifest,documentNumber)
				)
			);

			if(segments.length === 6){
				OfficeLawApi._sendJson(response,200,history);
				return;
			}

			const commit=history.commits.find((entry)=>entry.hash === segments[6]);

			if(commit === undefined){
				OfficeLawApi._sendJson(response,404,{
					error:"Commit not found in this file's history."
				});
				return;
			}

			OfficeLawApi._sendJson(
				response,200,await OfficeLawGit.readOfficeLawRevision(
					OfficeLawApi._projectRoot,commit
				)
			);
			return;
		}

		if(
			("PUT" === request.method || "POST" === request.method
				|| "DELETE" === request.method)
			&& origin !== undefined
			&& new URL(origin).host !== request.headers.host
		){
			OfficeLawApi._sendJson(
				response,403,{error:"Cross-origin writes are denied."}
			);
			return;
		}

		if("DELETE" === request.method && 3 === segments.length
			&& "api" === segments[0] && "laws" === segments[1]
			&& /^[a-z0-9-]+$/.test(segments[2] ?? "")){
			if(undefined === origin
				|| origin !== `http://${request.headers.host}`){
				OfficeLawApi._sendJson(response,403,{
					error:"Same-origin access required."
				});
				return;
			}
			if("application/json" !== request.headers["content-type"]
				?.split(";")[0]?.trim()){
				OfficeLawApi._sendJson(response,415,{
					error:"Law removal must use application/json."
				});
				return;
			}
			let input:unknown;
			try{
				input=JSON.parse(await OfficeLawApi._readRequestBody(request));
			}
			catch(error){
				OfficeLawApi._sendJson(response,400,{
					error:error instanceof Error
						?error.message:"Invalid JSON request."
				});
				return;
			}
			await OfficeLawManagement.removeOfficeLaw(
				OfficeLawApi._lawsRoot,segments[2] ?? "",input
			);
			OfficeLawApi._sendJson(response,200,{removed:true});
			return;
		}

		if(request.method === "POST" && 3 === segments.length
			&& segments[0] === "api" && segments[1] === "laws"
			&& segments[2] === "import"){
			const contentType=request.headers["content-type"]
				?.split(";")[0]?.trim();

			if("application/xml" !== contentType && "text/xml" !== contentType){
				OfficeLawApi._sendJson(response,415,{
					error:"Law import must use application/xml."
				});
				return;
			}

			const xml=await OfficeLawApi._readRequestBody(
				request,
				OfficeLawApi._maxImportBytes,
				"Imported law XML exceeds the size limit."
			);

			OfficeLawApi._sendJson(
				response,201,await OfficeLawManagement.importOfficeLaw(
					OfficeLawApi._lawsRoot,
					{
						indexPath:requestUrl.searchParams.get("indexPath") ?? "",
						xml
					}
				)
			);
			return;
		}

		const createRoute=request.method === "POST"
			&& 2 === segments.length
			&& segments[0] === "api" && segments[1] === "laws";
		const structureRoute=request.method === "PUT"
			&& 4 === segments.length
			&& segments[0] === "api" && segments[1] === "laws"
			&& /^[a-z0-9-]+$/.test(segments[2] ?? "")
			&& segments[3] === "structure";

		if("GET" === request.method && 4 === segments.length
			&& "api" === segments[0] && "laws" === segments[1]
			&& /^[a-z0-9-]+$/.test(segments[2] ?? "")
			&& "structure" === segments[3]){
			const lawDirectory=(await OfficeLawApi._lawDirectories()).find(
				(entry)=>entry.slug === segments[2]
			);
			if(undefined === lawDirectory){
				OfficeLawApi._sendJson(response,404,{error:"Law not found."});
				return;
			}
			const {manifest,document}=await OfficeLawApi._readLaw(
				lawDirectory.directory
			);
			OfficeLawApi._sendJson(response,200,{
				entries:document.norms.map((norm)=>{
					return{
						documentNumber:norm.documentNumber,
						kind:norm.kind,
						identifier:norm.identifier,
						title:norm.title,
						hierarchy:norm.hierarchy,
						path:OfficeLawLayout.officeLawNormPath(
							manifest,norm.documentNumber
						)
					};
				}),
				normPaths:manifest.normPaths,
				normDocumentNumbers:manifest.normDocumentNumbers,
				law:{
					abbreviation:manifest.metadata.abbreviation,
					title:manifest.metadata.title,
					shortTitle:manifest.metadata.shortTitle,
					indexPath:manifest.indexPath
				}
			});
			return;
		}

		if(createRoute || structureRoute){
			const contentType=request.headers["content-type"];

			if("application/json" !== contentType?.split(";")[0]?.trim()){
				OfficeLawApi._sendJson(response,415,{
					error:"Law management must use application/json."
				});
				return;
			}

			let input:unknown;
			try{
				input=JSON.parse(await OfficeLawApi._readRequestBody(request));
			}
			catch(error){
				OfficeLawApi._sendJson(response,400,{
					error:error instanceof Error
						?error.message:"Invalid JSON request."
				});
				return;
			}

			if(createRoute){
				OfficeLawApi._sendJson(
					response,201,await OfficeLawManagement.createOfficeLaw(
						OfficeLawApi._lawsRoot,input
					)
				);
				return;
			}

			const slug=segments[2] ?? "";
			const lawDirectory=(await OfficeLawApi._lawDirectories()).find(
				(entry)=>entry.slug === slug
			);

			if(undefined === lawDirectory){
				OfficeLawApi._sendJson(response,404,{error:"Law not found."});
				return;
			}

			OfficeLawApi._sendJson(
				response,200,await OfficeLawManagement.updateOfficeLawStructure(
					lawDirectory.directory,slug,input
				)
			);
			return;
		}

		if(
			request.method === "GET"
			&& 2 === segments.length
			&& segments[0] === "api"
			&& segments[1] === "laws"
		){
			const summaries=[];

			for(const lawDirectory of await OfficeLawApi._lawDirectories()){
				const manifest=await OfficeLawApi._readManifest(
					lawDirectory.directory
				);

				summaries.push({
					slug:manifest.slug,
					documentNumber:manifest.documentNumber,
					abbreviation:manifest.metadata.abbreviation
						?? manifest.documentNumber,
					title:manifest.metadata.title
						?? manifest.metadata.abbreviation
						?? manifest.documentNumber,
					shortTitle:manifest.metadata.shortTitle,
					indexPath:manifest.indexPath
				});
			}

			OfficeLawApi._sendJson(response,200,summaries);
			return;
		}

		if(
			request.method === "GET"
			&& 3 === segments.length
			&& segments[0] === "api"
			&& segments[1] === "laws"
			&& /^[a-z0-9-]+$/.test(segments[2] ?? "")
		){
			const lawDirectory=(await OfficeLawApi._lawDirectories()).find(
				(entry)=>entry.slug === segments[2]
			);

			if(lawDirectory === undefined){
				OfficeLawApi._sendJson(response,404,{error:"Law not found."});
				return;
			}

			const {document}=await OfficeLawApi._readLaw(lawDirectory.directory);
			OfficeLawApi._sendJson(response,200,document);
			return;
		}

		if(
			request.method === "PUT"
			&& 5 === segments.length
			&& segments[0] === "api"
			&& segments[1] === "laws"
			&& segments[3] === "norms"
			&& /^[a-z0-9-]+$/.test(segments[2] ?? "")
			&& /^[A-Z0-9]+$/.test(segments[4] ?? "")
		){
			const contentType=request.headers["content-type"];

			if(contentType?.split(";")[0]?.trim() !== "text/plain"){
				OfficeLawApi._sendJson(
					response,
					415,
					{error:"Edits must use the text/plain content type."}
				);
				return;
			}

			const lawDirectory=(await OfficeLawApi._lawDirectories()).find(
				(entry)=>entry.slug === segments[2]
			);

			if(lawDirectory === undefined){
				OfficeLawApi._sendJson(response,404,{error:"Law not found."});
				return;
			}

			const manifest=await OfficeLawApi._readManifest(lawDirectory.directory);
			const documentNumber=segments[4] ?? "";

			if(!manifest.normDocumentNumbers.includes(documentNumber)){
				OfficeLawApi._sendJson(response,404,{error:"Provision not found."});
				return;
			}

			const provisionPath=resolve(
				lawDirectory.directory,
				"norms",
				OfficeLawLayout.officeLawNormPath(manifest,documentNumber)
			);
			const existingMarkdown=await readFile(provisionPath,"utf8");
			const existingNorm=OfficeLawStorage.parseOfficeLawNormSource(
				existingMarkdown
			);

			if(existingNorm.documentNumber !== documentNumber){
				OfficeLawApi._sendJson(
					response,409,{error:"Provision identity mismatch."}
				);
				return;
			}

			const editedText=(await OfficeLawApi._readRequestBody(request))
				.replace(/\r\n?/g,"\n")
				.replace(/\n+$/,"");
			const updatedMarkdown=
				OfficeLawStorage.editOfficeLawNormText(
					existingMarkdown,editedText
				);
			const temporaryPath=`${provisionPath}.${process.pid}.tmp`;

			await writeFile(temporaryPath,updatedMarkdown,"utf8");
			await rename(temporaryPath,provisionPath);

			OfficeLawApi._sendJson(response,200,{saved:true,documentNumber});
			return;
		}

		OfficeLawApi._sendJson(response,404,{error:"Unknown law API route."});
	}
	catch(error){
		const message=error instanceof Error
			?error.message
			:"Unable to access law files.";
		OfficeLawApi._sendJson(response,
			error instanceof OfficeLawManagementError
				|| error instanceof OfficeLawPatchError
				|| error instanceof OfficeLawCommitError ? error.status : 500,
			{error:message}
		);
	}
}

public static middleware(
	request:IncomingMessage,
	response:ServerResponse,
	next:NextFunction
):void{
	const operation="PUT" === request.method || "POST" === request.method
		|| "DELETE" === request.method
		?OfficeLawManagement.withOfficeLawWriteLock(()=>{
			return OfficeLawApi._handleLawApi(request,response,next);
		})
		:OfficeLawApi._handleLawApi(request,response,next);
	operation.catch((error:unknown)=>{
		if(!response.headersSent){
			OfficeLawApi._sendJson(response,500,{
				error:error instanceof Error ? error.message : "Law API failure."
			});
		}
		else{
			response.destroy(error instanceof Error ? error : undefined);
		}
	});
}

public destructor():void{}
};
return OfficeLawApi;
}
