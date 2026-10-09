import { Component } from "react";
import { OfficeLawClient } from "../../law/client";
import { OfficeLawHistoryParser } from "../../law/history";
import type { RepositoryRevision as Revision } from "../../law/history";

export default class RepositoryRevision extends Component<{url:string},{revision:Revision|null; error:string|null}>{
	public state:{revision:Revision|null; error:string|null}={revision:null,error:null};
	private controller:AbortController|null=null;

	public componentDidMount():void{ this.load(); }
	public componentDidUpdate(previous:{url:string}):void{
		if(previous.url !== this.props.url){ this.load(); }
	}
	public componentWillUnmount():void{ this.controller?.abort(); }
	private load():void{
		this.controller?.abort();
		const controller=new AbortController();
		this.controller=controller;
		this.setState({revision:null,error:null});
		OfficeLawClient.request(this.props.url,{signal:controller.signal},"Git-Diff konnte nicht geladen werden")
			.then(OfficeLawHistoryParser.parseRepositoryRevision).then(revision=>{
				if(!controller.signal.aborted){ this.setState({revision}); }
			},error=>{
				if(!controller.signal.aborted){
					this.setState({error:error instanceof Error ? error.message : "Git-Diff konnte nicht geladen werden."});
				}
			});
	}
	public render(){
		const {revision,error}=this.state;
		if(error !== null){ return <p className="editor-error" role="alert">{error}</p>; }
		if(revision === null){ return <p role="status">Commit wird geladen …</p>; }
		return <div className="git-revision">
			<p className="git-history-note">Vollständiger Commit-Diff. Merge-Commits werden mit ihrem ersten Eltern-Commit verglichen.</p>
			{revision.files.length>0 && <ul aria-label="Geänderte Dateien">
				{revision.files.map((file,index)=><li key={index}><code>{file}</code></li>)}
			</ul>}
			<pre className="git-patch">{revision.patch || "Keine Dateiänderungen in diesem Commit."}</pre>
		</div>;
	}
}
