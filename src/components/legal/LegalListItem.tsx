import { PureComponent } from "react";
import type { OfficeLawDiffLine } from "../../law/diff";
import DiffText from "./DiffText";

interface Props{
	line:OfficeLawDiffLine;
	body:OfficeLawDiffLine[];
	label:string;
	level:number;
	afterNested:boolean;
}

export default class LegalListItem extends PureComponent<Props>{
	public static readonly markerPattern=/^(\d+\.|[a-z]{1,2}\))$/i;

	public render(){
		const {line,body,label,level,afterNested}=this.props;
		const original=line.originalText;
		const edited=line.editedText;
		return <div className={`legal-list-item legal-list-level-${level} is-${line.kind}`
			+(afterNested ? " legal-list-after-nested" : "")}>
			<span className="legal-list-marker">
				<DiffText original={original === null ? null : original.match(LegalListItem.markerPattern)?.[0] ?? ""}
					edited={edited === null ? null : edited.match(LegalListItem.markerPattern)?.[0] ?? ""}/>
			</span>
			<span>
				<DiffText original={original === null ? null : original.slice(label.length)}
					edited={edited === null ? null : edited.slice(label.length)}/>
				{body.map((part,index)=><span key={index}>{" "}
					<DiffText original={part.originalText} edited={part.editedText}/>
				</span>)}
			</span>
		</div>;
	}
}
