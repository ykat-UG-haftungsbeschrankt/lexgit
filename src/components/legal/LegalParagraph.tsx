import { PureComponent } from "react";
import type { ReactNode } from "react";
import type { OfficeLawDiffLine } from "../../law/diff";
import DiffText from "./DiffText";
import LegalListItem from "./LegalListItem";

export default class LegalParagraph extends PureComponent<{lines:OfficeLawDiffLine[]}>{
	public render(){
		const {lines}=this.props;
		const content:ReactNode[]=[];
		let previousLevel:number|null=null;
		for(let index=0;index<lines.length;index++){
			const line=lines[index];
			if(line === undefined){ continue; }
			if(line.text.length === 0){
				if(lines[index-1] !== undefined && lines[index+1] !== undefined && content.length>0){
					content.push(<div className="legal-list-gap" key={`gap-${index}`} aria-hidden="true"/>);
				}
				continue;
			}
			const marker=line.text.match(LegalListItem.markerPattern);
			if(marker === null){
				content.push(<div className={`legal-prose is-${line.kind}`} key={`text-${index}`}>
					<DiffText original={line.originalText} edited={line.editedText}/>
				</div>);
				previousLevel=null;
				continue;
			}
			const body:OfficeLawDiffLine[]=[];
			for(let bodyIndex=index+1;bodyIndex<lines.length;bodyIndex++){
				const part=lines[bodyIndex];
				if(part === undefined || part.text.length === 0 || LegalListItem.markerPattern.test(part.text)){
					break;
				}
				body.push(part);
				index=bodyIndex;
			}
			const label=marker[0];
			const level=/^\d/.test(label) ? 0 : label.length-1;
			content.push(<LegalListItem key={`item-${index}`} line={line} body={body}
				label={label} level={level} afterNested={level === 0 && previousLevel !== null && previousLevel>0}/>);
			previousLevel=level;
		}
		return content;
	}
}
