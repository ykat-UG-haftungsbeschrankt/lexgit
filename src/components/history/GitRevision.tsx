import { Component } from "react";
import type { ReactNode } from "react";
import { OfficeLawHistoryParser } from "../../law/history";
import { OfficeLawClient } from "../../law/client";
import type { OfficeLawRevision } from "../../law/history";
import type { OfficeLawNorm } from "../../law/types";
import SourceLegalText from "../legal/SourceLegalText";

class GitRevisionPresentation{
	public static heading(norm:OfficeLawNorm|null):string{
		if(norm === null){
			return "";
		}
		return norm.kind === "section"
			?[norm.hierarchy?.label,norm.hierarchy?.title].filter(Boolean).join(" ")
			:[norm.identifier,norm.title].filter(Boolean).join(" ");
	}
}

interface GitRevisionProperties{
	url:string;
	renderDiff:(previous:string,current:string)=>ReactNode;
}

interface GitRevisionState{
	revision:OfficeLawRevision|null;
	error:string|null;
}

export default class GitRevision extends Component<GitRevisionProperties,GitRevisionState>{
	public state:GitRevisionState={revision:null,error:null};
	private controller:AbortController|null=null;
	private mounted=false;

	public componentDidMount():void{
		this.mounted=true;
		this.load();
	}

	public componentDidUpdate(previousProps:GitRevisionProperties):void{
		if(previousProps.url !== this.props.url){
			this.load();
		}
	}

	public componentWillUnmount():void{
		this.mounted=false;
		this.controller?.abort();
		this.controller=null;
	}

	private load():void{
		this.controller?.abort();
		const controller=new AbortController();
		this.controller=controller;
		this.setState({revision:null,error:null});
		OfficeLawClient.request(this.props.url,{signal:controller.signal},"Git-Historie konnte nicht geladen werden")
			.then(OfficeLawHistoryParser.parseOfficeLawRevision).then(value=>{
				if(this.mounted && this.controller === controller && !controller.signal.aborted){
					this.setState({revision:value});
				}
			},reason=>{
				if(this.mounted && this.controller === controller && !controller.signal.aborted){
					this.setState({
						error:reason instanceof Error ? reason.message : "Git-Fassung konnte nicht geladen werden."
					});
				}
			});
	}

	public render():ReactNode{
		const {revision,error}=this.state;
		const {renderDiff}=this.props;
		if(error !== null){
			return <p className="editor-error" role="alert">{error}</p>;
		}
		if(revision === null){
			return <p role="status">Commit wird geladen …</p>;
		}
		const previousText=revision.previous?.paragraphs.join("\n\n") ?? "";
		const currentText=revision.current?.paragraphs.join("\n\n") ?? "";
		const previousHeading=GitRevisionPresentation.heading(revision.previous);
		const currentHeading=GitRevisionPresentation.heading(revision.current);
		const previousFootnotes=revision.previous?.footnotes.join("\n\n") ?? "";
		const currentFootnotes=revision.current?.footnotes.join("\n\n") ?? "";
		const previousXml=revision.previous?.sourceXml ?? null;
		const currentXml=revision.current?.sourceXml ?? null;
		const source=currentXml ?? previousXml;
		const xmlAvailable=null !== source
			&& (null === revision.previous || null !== previousXml)
			&& (null === revision.current || null !== currentXml);

		return(
			<div className="git-revision">
				<p className="git-history-note">
					Vergleich mit dem vorherigen Commit: <del>entfernt</del>, <strong>hinzugefügt</strong>.
				</p>
				<div className="paragraph-list">
					{previousHeading !== currentHeading && renderDiff(previousHeading,currentHeading)}
					{xmlAvailable
						&& null !== source
						?<SourceLegalText source={source} container="text"
							diffOriginal={previousXml}
							diffRemoved={null === revision.current}/>
						:previousText === currentText
						?<p className="git-history-note">Keine Änderungen am Vorschriftentext.</p>
						:renderDiff(previousText,currentText)}
					{(xmlAvailable
						&& (0<(revision.previous?.footnotes.length ?? 0)
							|| 0<(revision.current?.footnotes.length ?? 0))
						|| previousFootnotes !== currentFootnotes) && (
						<>
							<h3>Fußnoten</h3>
							{xmlAvailable && null !== source
								?<SourceLegalText source={source}
									container="fussnoten"
									diffOriginal={previousXml}
									diffRemoved={null === revision.current}/>
								:renderDiff(
									previousFootnotes,currentFootnotes
								)}
						</>
					)}
				</div>
				<details>
					<summary>Vollständiger Git-Diff (einschließlich Metadaten)</summary>
					<pre className="git-patch">{revision.patch || "Keine Textänderungen (z. B. Dateiumbenennung)."}</pre>
				</details>
			</div>
		);
	}
}
