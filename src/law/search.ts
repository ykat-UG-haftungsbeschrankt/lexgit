import type { OfficeLawNorm } from "./types";

export class OfficeLawSearch{
	static matchesQuery(norm:OfficeLawNorm,query:string):boolean{
		const searchable=[
			norm.identifier ?? "",
			norm.title ?? "",
			...norm.paragraphs
		].join(" ").toLocaleLowerCase("de");

		return searchable.includes(query);
	}
}
