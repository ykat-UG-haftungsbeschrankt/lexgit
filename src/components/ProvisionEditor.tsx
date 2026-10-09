import { Component } from "react";
import { OfficeLawDiff } from "../law/diff";
import LegalText from "./legal/LegalText";
import SourceLegalText from "./legal/SourceLegalText";
import { OfficeLawXml } from "../law/xml";
import { XmlEditorDialog } from "./management/XmlEditorDialog";

export interface ProvisionEditorProps{
	slug:utf8_t;
	documentNumber:utf8_t;
	editMode:"source"|"visual";
	onXmlSaved:()=>void;
	original:string;
	saved:string;
	draft:string;
	editing:boolean;
	showDiff:boolean;
	saving:boolean;
	error:string|null;
	readOnly?:boolean;
	diffText?:string;
	hasOtherChanges?:boolean;
	sourceXml?:utf8_t;
	originalXml?:utf8_t|null;
	diffRemoved?:bool_t;
	onDraft:(text:string)=>void;
	onEdit:()=>void;
	onToggleDiff:()=>void;
	onHideDiff:()=>void;
	onSave:()=>void;
	onCancel:()=>void;
	onReset:()=>void;
	onEditXml:()=>void;
}

export default class ProvisionEditor extends Component<ProvisionEditorProps>{
	protected _source():utf8_t{
		const source=this.props.sourceXml;
		if(undefined === source){
			throw new Error("Law source XML is missing.");
		}
		const norm=OfficeLawXml.parse(source);
		if(this.props.draft === norm.paragraphs.join("\n\n")){
			return source;
		}
		return OfficeLawXml.write({
			...norm,paragraphs:0 === this.props.draft.length
				?[]:this.props.draft.split(/\n{2,}/)
		},source);
	}

	public render(){
		const p=this.props;
		const diffText=p.diffText ?? p.draft;
		const changed=diffText !== p.original || p.hasOtherChanges;
		return <>
			<div className="editor-toolbar">
				<span className="edit-status">
					{p.readOnly ? "Repository-Vergleich (schreibgeschützt)"
						:p.saving ? "Änderung wird gespeichert …"
						:changed ? "Datei geändert"
						:"Datei im Originalzustand"}
				</span>
				<div className="editor-actions">
					{changed && !p.editing && <button className="editor-button" type="button" disabled={p.saving} onClick={p.onToggleDiff}>{p.showDiff ? "Text anzeigen" : "Änderungen ansehen"}</button>}
					{!p.editing && !p.readOnly && <button className="editor-button" type="button" disabled={p.saving} onClick={p.onEdit}>Bearbeiten</button>}
					{!p.editing && !p.readOnly && (
						<button className="editor-button" type="button"
							disabled={p.saving} onClick={p.onEditXml}>
							XML bearbeiten
						</button>
					)}
				</div>
			</div>
			{p.error !== null && <p className="editor-error" role="alert">{p.error}</p>}
			<div className="paragraph-list">
				{p.editing
					?<XmlEditorDialog inline slug={p.slug}
						documentNumber={p.documentNumber}
						initialMode={p.editMode}
						onClose={p.onCancel} onSaved={p.onXmlSaved}/>
					:p.showDiff
					?undefined !== p.sourceXml
						?<SourceLegalText source={this._source()}
							container="text"
							diffOriginal={undefined === p.originalXml
								?p.sourceXml:p.originalXml}
							diffRemoved={p.diffRemoved ?? false}/>
						:<LegalText lines={OfficeLawDiff.createInlineLineDiff(
							p.original,diffText
						)}/>
					:undefined !== p.sourceXml
					?<SourceLegalText source={this._source()} container="text"/>
					:p.draft.length === 0
					?<p className="empty-document">Für diese Vorschrift liegt kein Text vor.</p>
					:<LegalText lines={p.draft.split("\n").map(text=>({
						kind:"unchanged",text,originalText:text,editedText:text
					}))}/>}
			</div>
		</>;
	}
}
