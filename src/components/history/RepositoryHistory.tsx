import { Component } from "react";
import type { ReactNode } from "react";
import type { ChangeEvent } from "react";
import type { RepositoryComparisonMode } from "../../law/history";
import { OfficeLawHistoryParser } from "../../law/history";
import { OfficeLawClient } from "../../law/client";
import type { RepositoryHistory as History } from "../../law/history";
import RepositoryRevision from "./RepositoryRevision";
import CommitDialog from "./CommitDialog";

interface GitHistoryState{
	history:History|null;
	error:string|null;
	refresh:number;
	selectedCommit:string|null;
	loadingMore:boolean;
	showCommit:boolean;
	commitNotice:string|null;
}

interface Props{
	comparisonMode:RepositoryComparisonMode;
	onComparisonMode:(
		mode:RepositoryComparisonMode,initialHash:utf8_t|null
	)=>void;
	onSelectVersion:(hash:string|null)=>void;
	selectedVersion:string|null;
	disabled:boolean;
	onCommitted:()=>void;
}

export default class RepositoryHistory extends Component<Props,GitHistoryState>{
	public state:GitHistoryState={history:null,error:null,refresh:0,selectedCommit:null,loadingMore:false,showCommit:false,commitNotice:null};
	private controller:AbortController|null=null;
	private mounted=false;

	private get url():string{
		return "/api/git/history";
	}

	public componentDidMount():void{
		this.mounted=true;
		this.load();
	}

	public componentDidUpdate(_previousProps:Props,previousState:GitHistoryState):void{
		if(previousState.refresh !== this.state.refresh){
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
		this.setState({history:null,error:null,selectedCommit:null,loadingMore:false});
		OfficeLawClient.request(this.url,{signal:controller.signal},"Git-Historie konnte nicht geladen werden")
			.then(OfficeLawHistoryParser.parseRepositoryHistory).then(value=>{
				if(this.mounted && this.controller === controller && !controller.signal.aborted){
					this.setState({history:value});
				}
			},reason=>{
				if(this.mounted && this.controller === controller && !controller.signal.aborted){
					this.setState({
						error:reason instanceof Error ? reason.message : "Git-Historie konnte nicht geladen werden."
					});
				}
			});
	}

	private loadMore=():void=>{
		const history=this.state.history;
		if(history === null || !history.hasMore || this.state.loadingMore){ return; }
		const controller=this.controller;
		if(controller === null){ return; }
		this.setState({loadingMore:true,error:null});
		OfficeLawClient.request(`${this.url}?offset=${history.commits.length}`,{
			signal:controller.signal
		},"Git-Historie konnte nicht geladen werden")
			.then(OfficeLawHistoryParser.parseRepositoryHistory).then(value=>{
				if(this.mounted && this.controller === controller && !controller.signal.aborted){
					this.setState({history:{
						...value,commits:[...history.commits,...value.commits.filter(
							commit=>!history.commits.some(existing=>existing.hash === commit.hash)
						)]
					},loadingMore:false});
				}
			},reason=>{
				if(this.mounted && this.controller === controller && !controller.signal.aborted){
					this.setState({loadingMore:false,error:reason instanceof Error ? reason.message : "Git-Historie konnte nicht geladen werden."});
				}
			});
	};

	private refresh=():void=>{
		this.setState(state=>({refresh:state.refresh+1}));
	};

	private selectCommit=(hash:string):void=>{
		this.setState(state=>({selectedCommit:state.selectedCommit === hash ? null : hash}));
		this.props.onSelectVersion(this.props.selectedVersion === hash ? null : hash);
	};

	protected _changeMode(event:ChangeEvent<HTMLSelectElement>):void{
		const mode=event.target.value;
		if("head" !== mode && "selected" !== mode && "latest" !== mode){
			throw new Error("Invalid repository comparison mode.");
		}
		const initialHash="latest" === mode
			?this.state.history?.commits[0]?.hash ?? null:null;
		this.props.onComparisonMode(mode,initialHash);
	}

	public render():ReactNode{
		const {history,error,refresh,selectedCommit,loadingMore}=this.state;
		const url=this.url;
		return(
			<section className="git-history" aria-label="Git-Verlauf des Repositorys">
				<div className="git-history-heading">
					<h2>Git-Verlauf des Repositorys</h2>
					<button className="editor-button" type="button" onClick={this.refresh}>
						Aktualisieren
					</button>
				</div>
				<p className="git-history-note">
					Alle von HEAD erreichbaren Commits, einschließlich anderer Dateien und zusammengeführter Zweige.
					Wähle den Vergleich und einen Commit.
					Speichern in der App erstellt keinen Commit.
				</p>
				<label className="repository-comparison-mode">
					Vergleich
					<select aria-label="Repository-Vergleich"
						value={this.props.comparisonMode}
						disabled={this.props.disabled
							|| !history || 0 === history.commits.length}
						onChange={this._changeMode.bind(this)}>
						<option value="head">
							Seit ausgewähltem Commit bis HEAD
						</option>
						<option value="selected">
							Nur ausgewählter Commit zum Eltern-Commit
						</option>
						<option value="latest">
							Nur HEAD zum Eltern-Commit
						</option>
					</select>
				</label>
				<button className="editor-button is-primary" type="button"
					disabled={this.props.disabled || this.props.selectedVersion !== null || !history || history.status === "no-repository"}
					onClick={()=>this.setState({showCommit:true,commitNotice:null})}>Commit erstellen</button>
				{this.state.commitNotice && <p role="status">{this.state.commitNotice}</p>}
				{this.state.showCommit && <CommitDialog onClose={()=>this.setState({showCommit:false})}
					onCommitted={()=>{
						this.setState(state=>({showCommit:false,commitNotice:"Commit erstellt. Kein Push durchgeführt.",refresh:state.refresh+1}));
						this.props.onCommitted();
					}}/>}
				{this.props.selectedVersion !== null && <button className="editor-button" type="button"
					disabled={this.props.disabled} onClick={()=>this.props.onSelectVersion(null)}>Aktuelle Arbeitsfassung anzeigen</button>}
				{error !== null
					?<p className="editor-error" role="alert">{error}</p>
					:history === null
					?<p role="status">Git-Verlauf wird geladen …</p>
					:history.status === "no-repository"
					?<p>Für diesen Ordner ist noch kein Git-Repository eingerichtet.</p>
					:history.status === "no-commits"
					?<p>Dieses Git-Repository enthält noch keine Commits.</p>
					:history.commits.length === 0
					?<p>Dieses Repository enthält noch keine Commits.</p>
					:<ol className="git-timeline">
						{history.commits.map(commit=>(
							<li key={commit.hash}>
								<button className="git-commit" type="button"
									disabled={this.props.disabled}
									aria-pressed={this.props.selectedVersion === commit.hash}
									aria-expanded={selectedCommit === commit.hash}
									onClick={()=>this.selectCommit(commit.hash)}>
									<strong>{commit.message || "(Ohne Commit-Nachricht)"}</strong>
									<span>
										<time dateTime={commit.date}>
											{new Date(commit.date).toLocaleString("de-DE")}
										</time>
										{" · "}{commit.author}{" · "}
										<code title={commit.hash}>{commit.hash.slice(0,8)}</code>
									</span>
								</button>
								{selectedCommit === commit.hash && (
									<RepositoryRevision key={`${refresh}-${commit.hash}`}
										url={`${url}/${commit.hash}`}/>
								)}
							</li>
						))}
					</ol>
				}
				{history?.hasMore && <button className="editor-button" type="button"
					disabled={loadingMore} onClick={this.loadMore}>
					{loadingMore ? "Wird geladen …" : "Weitere Commits laden"}
				</button>}
			</section>
		);
	}
}
