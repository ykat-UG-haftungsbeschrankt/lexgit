import { PureComponent } from "react";
import CitationText from "../citations/CitationText";
import { OfficeLawDiff } from "../../law/diff";

interface Props{
	original:string|null;
	edited:string|null;
}

export default class DiffText extends PureComponent<Props>{
	public render(){
		const {original,edited}=this.props;
		if(original !== null && original === edited){
			return <CitationText text={original}/>;
		}
		if(original === null){
			return <strong className="legal-diff-added"><CitationText text={edited ?? ""}/></strong>;
		}
		if(edited === null){
			return <del className="legal-diff-removed"><CitationText text={original}/></del>;
		}
		return OfficeLawDiff.createTokenDiff(original,edited).map((part,index)=>
			part.kind === "unchanged"
				?<CitationText key={index} text={part.text}/>
				:part.kind === "removed"
				?<del className="legal-diff-removed" key={index}><CitationText text={part.text}/></del>
				:<strong className="legal-diff-added" key={index}><CitationText text={part.text}/></strong>
		);
	}
}
