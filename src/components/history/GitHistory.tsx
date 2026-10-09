import { Component } from "react";
import type { ReactNode } from "react";
import { OfficeLawHistoryParser } from "../../law/history";
import { OfficeLawClient } from "../../law/client";
import type { OfficeLawHistory } from "../../law/history";
import GitRevision from "./GitRevision";

interface Props{
	lawSlug:string;
	documentNumber:string;
	renderDiff:(previous:string,current:string)=>ReactNode;
}

interface State{
	history:OfficeLawHistory|null;
	error:string|null;
	refresh:number;
	selectedCommit:string|null;
}

export default class GitHistory extends Component<Props,State>{
	public state:State={history:null,error:null,refresh:0,selectedCommit:null};
	private controller:AbortController|null=null;
	private get url():string{
		return `/api/laws/${encodeURIComponent(this.props.lawSlug)}`
			+`/norms/${encodeURIComponent(this.props.documentNumber)}/history`;
	}
	public componentDidMount():void{ this.load(); }
	public componentDidUpdate(previous:Props,state:State):void{
		if(previous.lawSlug !== this.props.lawSlug
			|| previous.documentNumber !== this.props.documentNumber
			|| state.refresh !== this.state.refresh){
			this.load();
		}
	}
	public componentWillUnmount():void{ this.controller?.abort(); }
	private load():void{
		this.controller?.abort();
		const controller=new AbortController();
		this.controller=controller;
		this.setState({history:null,error:null,selectedCommit:null});
		OfficeLawClient.request(this.url,{signal:controller.signal},"Git-Historie konnte nicht geladen werden")
			.then(OfficeLawHistoryParser.parseOfficeLawHistory).then(history=>{
				if(!controller.signal.aborted){ this.setState({history}); }
			},error=>{
				if(!controller.signal.aborted){
					this.setState({error:error instanceof Error ? error.message : "Git-Historie konnte nicht geladen werden."});
				}
			});
	}
	public render(){
		const {history,error,refresh,selectedCommit}=this.state;
		return <section className="git-history" aria-label="Git-Verlauf dieser Datei">
			<div className="git-history-heading">
				<h2>Git-Verlauf dieser Datei</h2>
				<button className="editor-button" type="button"
					onClick={()=>this.setState(state=>({refresh:state.refresh+1}))}>Aktualisieren</button>
			</div>
			<p className="git-history-note">
				Nur Commit-Änderungen der aktuellen Git-Hauptlinie, neueste zuerst.
				Speichern in der App erstellt keinen Commit.
			</p>
			{error !== null
				?<p className="editor-error" role="alert">{error}</p>
				:history === null
				?<p role="status">Git-Verlauf wird geladen …</p>
				:history.status === "no-repository"
				?<p>Für diesen Ordner ist noch kein Git-Repository eingerichtet.</p>
				:history.status === "no-commits"
				?<p>Dieses Git-Repository enthält noch keine Commits.</p>
				:history.commits.length === 0
				?<p>Für diese Datei gibt es noch keine Commits.</p>
				:<ol className="git-timeline">
					{history.commits.map(commit=><li key={commit.hash}>
						<button className="git-commit" type="button"
							aria-expanded={selectedCommit === commit.hash}
							onClick={()=>this.setState(state=>({
								selectedCommit:state.selectedCommit === commit.hash ? null : commit.hash
							}))}>
							<strong>{commit.message || "(Ohne Commit-Nachricht)"}</strong>
							<span><time dateTime={commit.date}>{new Date(commit.date).toLocaleString("de-DE")}</time>
								{" · "}{commit.author}{" · "}<code title={commit.hash}>{commit.hash.slice(0,8)}</code>
							</span>
							<span className="git-commit-path">{commit.path}</span>
						</button>
						{selectedCommit === commit.hash && <GitRevision key={`${refresh}-${commit.hash}`}
							url={`${this.url}/${commit.hash}`} renderDiff={this.props.renderDiff}/>}
					</li>)}
				</ol>}
		</section>;
	}
}
