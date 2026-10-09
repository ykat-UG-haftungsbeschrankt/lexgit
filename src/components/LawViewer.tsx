import { Component } from "react";
import type { OfficeLawDocument, OfficeLawNorm } from "../law/types";
import type { OfficeLawSummary } from "../law/storage";
import GitHistory from "./history/GitHistory";
import { OfficeLawDiff } from "../law/diff";
import LegalText from "./legal/LegalText";
import SourceLegalText from "./legal/SourceLegalText";
import DiffText from "./legal/DiffText";
import ProvisionEditor from "./ProvisionEditor";
import type { ProvisionEditorProps } from "./ProvisionEditor";
import type { RepositoryComparisonMode } from "../law/history";

interface Props{
	comparisonMode:RepositoryComparisonMode;
	comparisonVersion:utf8_t|null;
	law:OfficeLawDocument;
	source:OfficeLawSummary;
	norm:OfficeLawNorm|undefined;
	previousNorm:OfficeLawNorm|undefined;
	editor:ProvisionEditorProps;
	selectedVersion:string|null;
	versionLoading:boolean;
	versionError:string|null;
	removed:boolean;
	lawAbsent:boolean;
	historyVersion:number;
	onSelectVersion:(hash:string|null)=>void;
}

export default class LawViewer extends Component<Props>{
	private heading(norm:OfficeLawNorm|undefined):string{
		if(norm === undefined){ return ""; }
		return norm.kind === "section"
			?`${norm.hierarchy?.label ?? ""} ${norm.hierarchy?.title ?? ""}`.trim()
			:norm.title === null ? norm.identifier ?? "" : `${norm.identifier ?? ""} ${norm.title}`;
	}
	public render(){
		const {law,norm,editor}=this.props;
		const historicalDiff=this.props.selectedVersion !== null && editor.showDiff;
		const mode=this.props.comparisonMode;
		const comparisonLabel="head" === mode
			?"Alle Änderungen seit dem ausgewählten Commit bis HEAD"
			:"selected" === mode
				?"Nur Änderungen des ausgewählten Commits"
				:"Nur Änderungen des letzten Commits (HEAD)";
		return <section className="content-area">
			<header className="topbar">
				<div className="breadcrumbs"><span>Gesetze</span><span className="breadcrumb-divider">/</span><strong>{law.metadata.abbreviation ?? "Gesetz"}</strong></div>
				<div className="topbar-right">
					<span className="updated-label"><span aria-hidden="true">●</span>{this.props.selectedVersion
						?`Vergleich ${this.props.comparisonVersion
							?.slice(0,8) ?? ""}`
						: "Amtliche Fassung"}</span>
					<button className="icon-button" type="button" aria-label="Darstellungseinstellungen">
						<svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3"/><path d="M10 2v2m0 12v2M2 10h2m12 0h2"/><path d="m4.34 4.34 1.42 1.42m8.48 8.48 1.42 1.42m0-11.32-1.42 1.42m-8.48 8.48-1.42 1.42"/></svg>
					</button>
				</div>
			</header>
			<div className="document-scroll">
				{this.props.versionLoading && <p role="status">
					Repository-Vergleich wird geladen …
				</p>}
				{this.props.versionError && <p role="alert" className="editor-error">{this.props.versionError}</p>}
				{this.props.lawAbsent && <p role="status">
					Dieses Gesetz ist in der Vergleichsfassung nicht vorhanden.
				</p>}
				{this.props.selectedVersion && <p className="snapshot-banner">
					{comparisonLabel}.
					{" "}Änderungen sind im Inhaltsverzeichnis markiert.
					{" "}Im Text: Ergänzungen fett, Entfernungen durchgestrichen.
					<button className="editor-button" type="button" onClick={()=>this.props.onSelectVersion(null)}>Zur aktuellen Arbeitsfassung</button>
				</p>}
				{norm === undefined
					?<div className="welcome-card"><span className="eyebrow">GESETZESÜBERSICHT</span><h1>{law.metadata.title}</h1><p>Wähle links eine Vorschrift aus oder suche nach einem Begriff im Gesetzestext.</p></div>
					:<article className="law-document">
						<div className="official-document">
							<div className="official-law-title">{law.metadata.title}{" ("}{law.metadata.shortTitle ?? law.metadata.abbreviation}{" - "}{law.metadata.abbreviation}{")"}</div>
							<h1>{historicalDiff
								?<DiffText original={this.props.previousNorm === undefined ? null : this.heading(this.props.previousNorm)}
									edited={this.props.removed ? null : this.heading(norm)}/>
								:this.heading(norm)}</h1>
							{this.props.removed && <p className="snapshot-banner">
								In diesem Vergleich entfernt.
								Angezeigt wird die vorherige Fassung.
							</p>}
							<ProvisionEditor {...editor}
								originalXml={null === this.props.selectedVersion
									?norm.sourceXml ?? null
									:this.props.previousNorm?.sourceXml ?? null}
								diffRemoved={this.props.removed}
								{...(undefined === norm.sourceXml
									?{}:{sourceXml:norm.sourceXml})}/>
							{this.props.selectedVersion !== null
								&& (norm.footnotes.length>0 || historicalDiff && (this.props.previousNorm?.footnotes.length ?? 0)>0)
								&& <div className="paragraph-list">
									<h2>Fußnoten</h2>
									{historicalDiff && undefined !== norm.sourceXml
										?<SourceLegalText source={norm.sourceXml}
											container="fussnoten"
											diffOriginal={this.props.previousNorm
												?.sourceXml ?? null}
											diffRemoved={this.props.removed}/>
										:historicalDiff
										?<LegalText lines={OfficeLawDiff.createInlineLineDiff(
											this.props.previousNorm?.footnotes.join("\n\n") ?? "",
											this.props.removed ? "" : norm.footnotes.join("\n\n")
										)}/>
										:undefined !== norm.sourceXml
										?<SourceLegalText source={norm.sourceXml}
											container="fussnoten"/>
										:<LegalText lines={norm.footnotes.map(text=>({
											kind:"unchanged",text,originalText:text,editedText:text
										}))}/>}
								</div>}
						</div>
						<GitHistory key={`${norm.documentNumber}-${this.props.historyVersion}`} lawSlug={law.slug} documentNumber={norm.documentNumber}
							renderDiff={(previous,current)=><LegalText lines={OfficeLawDiff.createInlineLineDiff(previous,current)}/>}/>
						<div className="document-footer">
							<div><span className="footer-mark">↗</span><span>Amtliche Fundstelle</span></div>
							<div className="document-footer-details"><span>{law.metadata.citations[0]?.periodical}{" "}{law.metadata.citations[0]?.reference}</span></div>
						</div>
					</article>}
			</div>
		</section>;
	}
}
