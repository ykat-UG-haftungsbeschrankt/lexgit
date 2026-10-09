import { Component } from "react";
import type { ContextType, ReactNode } from "react";
import { OfficeLawCitations } from "../../law/citations";
import type { OfficeLawCitationReference } from "../../law/citations";
import { CitationContext } from "./CitationContext";
import CitationPreview from "./CitationPreview";

interface CitationTextProperties{
	text:string;
}

export default class CitationText extends Component<CitationTextProperties>{
	public static contextType=CitationContext;
	declare context:ContextType<typeof CitationContext>;
	private cachedText:string|null=null;
	private cachedContext:ContextType<typeof CitationContext>|undefined=undefined;
	private references:OfficeLawCitationReference[]=[];

	public render():ReactNode{
		const {text}=this.props;
		const context=this.context;
		if(this.cachedText !== text || this.cachedContext !== context){
			this.references=OfficeLawCitations.findOfficeLawCitations(text,context?.sources ?? []);
			this.cachedText=text;
			this.cachedContext=context;
		}
		if(context === null || this.references.length === 0){
			return text;
		}

		const parts:ReactNode[]=[];
		let position=0;
		for(const reference of this.references){
			parts.push(text.slice(position,reference.start));
			parts.push(<CitationPreview key={reference.start} reference={reference} context={context}/>);
			position=reference.end;
		}
		parts.push(text.slice(position));
		return parts;
	}
}
