import { PureComponent } from "react";
import type { ReactNode } from "react";
import type { OfficeLawDiffLine } from "../../law/diff";
import LegalParagraph from "./LegalParagraph";

export default class LegalText extends PureComponent<{lines:OfficeLawDiffLine[]}>{
	public render(){
		const paragraphs:OfficeLawDiffLine[][]=[];
		let current:OfficeLawDiffLine[]=[];
		for(const line of this.props.lines){
			if(line.text.length === 0){
				if(current.length>0){
					paragraphs.push(current);
					current=[];
				}
			}
			else{ current.push(line); }
		}
		if(current.length>0){ paragraphs.push(current); }
		const content:ReactNode[]=paragraphs.map((lines,index)=>
			<div className="legal-paragraph" key={`paragraph-${index}`}><LegalParagraph lines={lines}/></div>
		);
		return content;
	}
}
