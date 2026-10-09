import { OfficeLawLayout } from "./layout";
import { OfficeLawStorage } from "./storage";
import type { OfficeLawDocument, OfficeLawNorm } from "./types";
import type { RepositoryLawSnapshot } from "./history";

export type GitCommand=(
	directory:utf8_t,args:utf8_t[]
)=>Promise<utf8_t>;

export class OfficeLawRepositoryComparison{
	public destructor():void{}

	public static async compare(
		git:GitCommand,root:utf8_t,base:utf8_t,
		previousRevision:utf8_t|undefined,currentRevision:utf8_t
	):Promise<RepositoryLawSnapshot>{
		const current=await OfficeLawRepositoryComparison._readLaw(
			git,root,currentRevision,base
		);
		const previous=undefined === previousRevision ? null
			:await OfficeLawRepositoryComparison._readLaw(
				git,root,previousRevision,base
			);
		const changedIds=new Set<utf8_t>();
		const removedNorms:OfficeLawNorm[]=[];
		const previousNorms=new Map<utf8_t,OfficeLawNorm>();
		const currentNorms=new Map<utf8_t,OfficeLawNorm>();
		for(const norm of previous?.norms ?? []){
			previousNorms.set(norm.documentNumber,norm);
		}
		for(const norm of current?.norms ?? []){
			currentNorms.set(norm.documentNumber,norm);
			const old=previousNorms.get(norm.documentNumber);
			if(JSON.stringify(norm) !== JSON.stringify(old)){
				changedIds.add(norm.documentNumber);
			}
		}
		for(const norm of previous?.norms ?? []){
			if(!currentNorms.has(norm.documentNumber)){
				changedIds.add(norm.documentNumber);
				removedNorms.push(norm);
			}
		}
		const commonCurrent:utf8_t[]=[];
		const commonPrevious:utf8_t[]=[];
		for(const id of current?.normDocumentNumbers ?? []){
			if(previousNorms.has(id)){
				commonCurrent.push(id);
			}
		}
		for(const id of previous?.normDocumentNumbers ?? []){
			if(currentNorms.has(id)){
				commonPrevious.push(id);
			}
		}
		for(let index=0;index<commonCurrent.length;index++){
			const id=commonCurrent[index]!;
			if(commonPrevious[index] !== id){
				changedIds.add(id);
			}
		}
		// Include file moves and metadata-only changes.
		const args=undefined === previousRevision
			?["show","--format=","--first-parent",currentRevision]
			:["diff",previousRevision,currentRevision];
		const output=await git(root,[
			...args,"--name-only","-z","--no-ext-diff","--no-textconv",
			"--",base
		]);
		const files=new Set(output.split("\0"));
		const revisions=[
			[currentRevision,current],[previousRevision,previous]
		] as const;
		for(const [revision,document] of revisions){
			if(undefined === revision || null === document){
				continue;
			}
			const manifest=OfficeLawStorage.parseOfficeLawManifest(
				await git(root,["show",`${revision}:${base}/law.json`])
			);
			for(const id of document.normDocumentNumbers){
				const path=OfficeLawLayout.officeLawNormPath(manifest,id);
				if(files.has(`${base}/norms/${path}`)){
					changedIds.add(id);
				}
			}
		}
		return{
			document:current,previousNorms:previous?.norms ?? [],
			removedNorms,changedIds:[...changedIds]
		};
	}

	protected static async _readLaw(
		git:GitCommand,root:utf8_t,hash:utf8_t,base:utf8_t
	):Promise<OfficeLawDocument|null>{
		const output=await git(root,[
			"ls-tree","-r","--name-only","-z",hash,"--",base
		]);
		const files=output.split("\0");
		if(!files.includes(`${base}/law.json`)){
			return null;
		}
		const manifest=OfficeLawStorage.parseOfficeLawManifest(
			await git(root,["show",`${hash}:${base}/law.json`])
		);
		const sources=new Map<utf8_t,utf8_t>();
		for(const id of manifest.normDocumentNumbers){
			const path=OfficeLawLayout.officeLawNormPath(manifest,id);
			sources.set(id,await git(root,[
				"show",`${hash}:${base}/norms/${path}`
			]));
		}
		return OfficeLawStorage.createOfficeLawDocument(manifest,sources);
	}
};
