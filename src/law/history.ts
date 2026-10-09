import type { OfficeLawDocument, OfficeLawNorm } from "./types";
import { OfficeLawStorage } from "./storage";

export interface OfficeLawCommit{
	hash:string;
	date:string;
	author:string;
	message:string;
	path:string;
	previousPath:string|null;
}

export interface OfficeLawHistory{
	status:"ready"|"no-repository"|"no-commits";
	commits:OfficeLawCommit[];
}

export interface OfficeLawRevision{
	previous:OfficeLawNorm|null;
	current:OfficeLawNorm|null;
	patch:string;
}

export type RepositoryCommit=Pick<OfficeLawCommit,"hash"|"date"|"author"|"message">;

export interface RepositoryHistory{
	status:OfficeLawHistory["status"];
	commits:RepositoryCommit[];
	hasMore:boolean;
}

export interface RepositoryRevision{
	files:string[];
	patch:string;
}

export interface RepositoryLawSnapshot{
	comparisonVersion?:utf8_t;
	document:OfficeLawDocument|null;
	previousNorms:OfficeLawNorm[];
	removedNorms:OfficeLawNorm[];
	changedIds:string[];
}

export type RepositoryComparisonMode="head"|"selected"|"latest";

export interface RepositoryCommitPreview extends RepositoryRevision{
	head:string|null;
	token:string;
}

export class OfficeLawHistoryParser{
	private static record(value:unknown):value is Record<string,unknown>{
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	public static parseOfficeLawHistory(value:unknown):OfficeLawHistory{
		if(!OfficeLawHistoryParser.record(value)
			|| (value.status !== "ready" && value.status !== "no-repository"
				&& value.status !== "no-commits")
			|| !Array.isArray(value.commits)){
			throw new Error("Ungültige Git-Historie.");
		}

		const commits=value.commits.map((commit:unknown):OfficeLawCommit=>{
			if(!OfficeLawHistoryParser.record(commit) || typeof commit.hash !== "string"
				|| !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.hash)
				|| typeof commit.date !== "string" || !Number.isFinite(Date.parse(commit.date))
				|| typeof commit.author !== "string" || typeof commit.message !== "string"
				|| typeof commit.path !== "string"
				|| !(commit.previousPath === null || typeof commit.previousPath === "string")){
				throw new Error("Ungültiger Git-Commit.");
			}

			return{
				hash:commit.hash,date:commit.date,author:commit.author,
				message:commit.message,path:commit.path,previousPath:commit.previousPath
			};
		});

		const status=value.status;

		if(status !== "ready" && status !== "no-repository" && status !== "no-commits"){
			throw new Error("Ungültiger Git-Status.");
		}

		return{status,commits};
	}

	public static parseOfficeLawRevision(value:unknown):OfficeLawRevision{
		if(!OfficeLawHistoryParser.record(value) || typeof value.patch !== "string"){
			throw new Error("Ungültige Git-Fassung.");
		}

		return{
			previous:value.previous === null ? null : OfficeLawStorage.parseOfficeLawNorm(value.previous),
			current:value.current === null ? null : OfficeLawStorage.parseOfficeLawNorm(value.current),
			patch:value.patch
		};
	}

	public static parseRepositoryHistory(value:unknown):RepositoryHistory{
		if(!OfficeLawHistoryParser.record(value) || !Array.isArray(value.commits)
			|| typeof value.hasMore !== "boolean"){
			throw new Error("Ungültiger Repository-Verlauf.");
		}
		const history=OfficeLawHistoryParser.parseOfficeLawHistory({
			...value,
			commits:value.commits.map(commit=>{
				if(!OfficeLawHistoryParser.record(commit)){
					throw new Error("Ungültiger Git-Commit.");
				}
				return {...commit,path:"",previousPath:null};
			})
		});
		return {
			status:history.status,hasMore:value.hasMore,
			commits:history.commits.map(({hash,date,author,message})=>({hash,date,author,message}))
		};
	}

	public static parseRepositoryRevision(value:unknown):RepositoryRevision{
		if(!OfficeLawHistoryParser.record(value) || typeof value.patch !== "string"
			|| !Array.isArray(value.files) || !value.files.every(file=>typeof file === "string")){
			throw new Error("Ungültiger Repository-Diff.");
		}
		return{files:value.files,patch:value.patch};
	}

	public static parseRepositoryLawSnapshot(value:unknown):RepositoryLawSnapshot{
		if(!OfficeLawHistoryParser.record(value) || !Array.isArray(value.removedNorms)
			|| !Array.isArray(value.previousNorms)
			|| !Array.isArray(value.changedIds) || !value.changedIds.every(id=>typeof id === "string")){
			throw new Error("Ungültige historische Gesetzesfassung.");
		}
		const comparisonVersion=value.comparisonVersion;
		if(undefined !== comparisonVersion
			&& ("string" !== typeof comparisonVersion
				|| !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(
					comparisonVersion
				))){
			throw new Error("Ungültige Vergleichsfassung.");
		}
		return{
			...(undefined === comparisonVersion ? {}:{comparisonVersion}),
			document:value.document === null ? null : OfficeLawStorage.parseOfficeLawDocument(value.document),
			previousNorms:value.previousNorms.map(OfficeLawStorage.parseOfficeLawNorm),
			removedNorms:value.removedNorms.map(OfficeLawStorage.parseOfficeLawNorm),
			changedIds:value.changedIds
		};
	}
	public static parseCommitPreview(value:unknown):RepositoryCommitPreview{
		if(!OfficeLawHistoryParser.record(value) || !(value.head === null || typeof value.head === "string")
			|| typeof value.token !== "string"){
			throw new Error("Ungültige Commit-Vorschau.");
		}
		return {...OfficeLawHistoryParser.parseRepositoryRevision(value),head:value.head,token:value.token};
	}
}
