import type { OfficeLawNorm } from "./types";

export class OfficeLawLayout{
	public static validateOfficeLawNormPath(path:string):void{
		if(
			!/\.(?:xml|md)$/.test(path)
			|| path.split("/").some(
				(part)=>!part || part === "." || part === ".."
					|| /[\\:\u0000-\u001f]/.test(part)
			)
		){
			throw new Error(`Invalid provision path "${path}".`);
		}
	}

	private static fileName(identifier:string):string{
		const name=identifier.trim()
			.replace(/[%/\\<>:"|?*\u0000-\u001f]/g,
				(character)=>`%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2,"0")}`)
			.replace(/[. ]+$/, (suffix)=>Array.from(suffix)
				.map((character)=>character === "." ? "%2E" : "%20").join(""));

		if(!name){
			throw new Error("A provision or section identifier is empty.");
		}

		return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
			?`_${name}`
			:name;
	}

	public static createOfficeLawNormPaths(
		norms:readonly OfficeLawNorm[]
	):Record<string,string>{
		const paths=new Map<string,string>();
		const usedPaths=new Set<string>();
		const sections:{number:string; path:string}[]=[];

		for(const norm of norms){
			if(
				!/^[A-Z0-9]+$/.test(norm.documentNumber)
				|| paths.has(norm.documentNumber)
			){
				throw new Error(
					`Invalid or duplicate document number "${norm.documentNumber}".`
				);
			}

			let path:string;

			if(norm.kind === "section"){
				const number=norm.hierarchy?.number;

				// Gliederungskennzahlen append a three-digit component at each level.
				if(number == null || !/^(?:\d{3})+$/.test(number)){
					throw new Error(`Invalid section hierarchy number for ${norm.documentNumber}.`);
				}

				while(sections.length){
					const previous=sections[sections.length-1];

					if(
						previous !== undefined
						&& number.length>previous.number.length
						&& number.startsWith(previous.number)
					){
						break;
					}

					sections.pop();
				}

				const parent=sections[sections.length-1]?.path ?? "";
				const label=OfficeLawLayout.fileName(
					norm.hierarchy?.label ?? norm.identifier ?? number
				);
				let directory=parent ? `${parent}/${label}` : label;

				if(usedPaths.has(`${directory}/index.xml`.toLowerCase())){
					directory+=`--${norm.documentNumber}`;
				}

				path=`${directory}/index.xml`;
				sections.push({number,path:directory});
			}
			else{
				const parent=sections[sections.length-1]?.path ?? "";
				const label=OfficeLawLayout.fileName(
					norm.identifier ?? norm.documentNumber
				);
				path=parent
					?`${parent}/${label}.xml`
					:`${label}.xml`;

				if(usedPaths.has(path.toLowerCase())){
					path=parent
						?`${parent}/${label}--${norm.documentNumber}.xml`
						:`${label}--${norm.documentNumber}.xml`;
				}
			}

			OfficeLawLayout.validateOfficeLawNormPath(path);

			if(usedPaths.has(path.toLowerCase())){
				throw new Error(`Duplicate provision path "${path}".`);
			}

			usedPaths.add(path.toLowerCase());
			paths.set(norm.documentNumber,path);
		}

		return Object.fromEntries(paths);
	}

	public static officeLawNormPath(
		manifest:{normPaths?:Readonly<Record<string,string>>},
		documentNumber:string
	):string{
		if(!/^[A-Z0-9]+$/.test(documentNumber)){
			throw new Error("Invalid provision document number.");
		}

		const path=manifest.normPaths === undefined
			?`${documentNumber}.md`
			:manifest.normPaths[documentNumber];

		if(path === undefined){
			throw new Error(`Missing provision path for ${documentNumber}.`);
		}

		OfficeLawLayout.validateOfficeLawNormPath(path);
		return path;
	}
}
