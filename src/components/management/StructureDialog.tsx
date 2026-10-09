import { Component } from "react";
import type { FormEvent, ReactNode } from "react";
import type { OfficeLawDocument } from "../../law/types";
import { OfficeLawStorage } from "../../law/storage";
import { OfficeLawStructure } from "../../law/structure";
import type { OfficeLawEditableEntry, OfficeLawEditableMetadata } from "../../law/structure";
import { OfficeLawClient } from "../../law/client";
import { ManagementDialog } from "./ManagementDialog";

interface StructureDialogProps{
	law:OfficeLawDocument;
	onClose:()=>void;
	onSaved:(law:OfficeLawDocument,selectedId:string,indexPath:string)=>void;
}

interface StructureDialogState{
	entries:OfficeLawEditableEntry[]|null;
	expectedIds:string[];
	selectedId:string;
	busy:boolean;
	error:string|null;
	dirty:boolean;
	metadata:OfficeLawEditableMetadata;
}

export class StructureDialog extends Component<StructureDialogProps,StructureDialogState>{
	private mounted=false;
	private loadController:AbortController|null=null;
	private saveController:AbortController|null=null;

	public state:StructureDialogState={
		entries:null,
		expectedIds:[],
		selectedId:"",
		busy:false,
		error:null,
		dirty:false,
		metadata:{abbreviation:"",title:"",shortTitle:null,indexPath:""}
	};

	public componentDidMount():void{
		this.mounted=true;
		this.loadStructure();
	}

	public componentDidUpdate(previousProps:StructureDialogProps):void{
		if(previousProps.law.slug !== this.props.law.slug){
			this.loadStructure();
		}
	}

	public componentWillUnmount():void{
		this.mounted=false;
		this.loadController?.abort();
		this.loadController=null;
		this.saveController?.abort();
		this.saveController=null;
	}

	private loadStructure=async():Promise<void>=>{
		this.loadController?.abort();
		const controller=new AbortController();
		this.loadController=controller;
		this.setState({entries:null,error:null,dirty:false});
		try{
			const value=OfficeLawStructure.parseOfficeLawStructure(await OfficeLawClient.request(
				`/api/laws/${encodeURIComponent(this.props.law.slug)}/structure`,
				{signal:controller.signal}
			));
			if(this.mounted && this.loadController === controller && !controller.signal.aborted){
				this.setState({
					entries:value.entries,
					expectedIds:value.normDocumentNumbers,
					metadata:value.law,
					selectedId:value.entries[0]?.documentNumber ?? ""
				});
			}
		}
		catch(reason){
			if(this.mounted && this.loadController === controller && !controller.signal.aborted){
				this.setState({
					error:reason instanceof Error ? reason.message : "Inhalt konnte nicht geladen werden."
				});
			}
		}
		finally{
			if(this.loadController === controller){
				this.loadController=null;
			}
		}
	};

	private modify=(change:(entries:OfficeLawEditableEntry[])=>OfficeLawEditableEntry[]):void=>{
		const {entries}=this.state;
		if(entries === null){
			return;
		}
		try{
			this.setState({entries:change(entries),dirty:true,error:null});
		}
		catch(reason){
			this.setState({error:reason instanceof Error ? reason.message : "Ungültige Inhaltsstruktur."});
		}
	};

	private update=(fields:Partial<OfficeLawEditableEntry>):void=>{
		const {entries,selectedId}=this.state;
		if(entries === null){
			return;
		}
		this.modify(items=>items.map(entry=>entry.documentNumber === selectedId
			?{...entry,...fields}:entry));
	};

	private add=(kind:"section"|"norm"):void=>{
		const {entries,selectedId}=this.state;
		if(entries === null){
			return;
		}
		const selected=entries.find(entry=>entry.documentNumber === selectedId);
		const id=`NEW${crypto.randomUUID().replace(/-/g,"").toUpperCase()}`;
		const parentId=selected?.kind === "section"
			?selected.documentNumber:selected?.parentId ?? null;
		const sectionCount=entries.filter(entry=>entry.kind === "section" && entry.parentId === parentId).length;
		const nextNumber=entries.reduce((maximum,entry)=>{
			const number=entry.identifier?.match(/^§\s+(\d+)[a-z]?$/i)?.[1];
			return number === undefined ? maximum : Math.max(maximum,Number(number));
		},0)+1;
		const entry:OfficeLawEditableEntry={
			documentNumber:id,
			kind,
			identifier:kind === "norm" ? `§ ${nextNumber}` : null,
			title:null,
			hierarchy:kind === "section" ? {
				number:"010",label:`Abschnitt ${sectionCount+1}`,title:"Neuer Abschnitt"
			} : null,
			parentId,
			path:""
		};
		this.modify(items=>OfficeLawStructure.arrangeOfficeLawEntries([...items,entry]));
		this.setState({selectedId:id});
	};

	private save=async(event:FormEvent<HTMLFormElement>):Promise<void>=>{
		event.preventDefault();
		const {entries,expectedIds,selectedId,metadata}=this.state;
		if(entries === null || this.state.busy){
			return;
		}
		this.saveController?.abort();
		const controller=new AbortController();
		this.saveController=controller;
		this.setState({busy:true,error:null});
		let updated:OfficeLawDocument;
		try{
			const arranged=OfficeLawStructure.arrangeOfficeLawEntries(entries);
			updated=OfficeLawStorage.parseOfficeLawDocument(await OfficeLawClient.request(
				`/api/laws/${encodeURIComponent(this.props.law.slug)}/structure`,{
					method:"PUT",
					headers:{"Content-Type":"application/json"},
					body:JSON.stringify({
						expectedNormDocumentNumbers:expectedIds,
						law:metadata,
						entries:arranged.map(({parentId,...entry})=>entry)
					}),
					signal:controller.signal
				}
			));
		}
		catch(reason){
			if(this.mounted && this.saveController === controller){
				this.saveController=null;
				this.setState({
					busy:false,
					error:reason instanceof Error ? reason.message : "Inhalt konnte nicht gespeichert werden."
				});
			}
			return;
		}

		if(!this.mounted || this.saveController !== controller){
			return;
		}
		this.saveController=null;
		this.setState({busy:false});
		this.props.onSaved(updated,selectedId,metadata.indexPath);
	};

	public render():ReactNode{
		const {entries,selectedId,busy,error,dirty,metadata}=this.state;
		const selected=entries?.find(entry=>entry.documentNumber === selectedId);
		const forbidden=entries === null || selected === undefined
			?new Set<string>():OfficeLawStructure.entryDescendants(entries,selectedId);
		const siblings=entries?.filter(entry=>entry.parentId === selected?.parentId) ?? [];
		const siblingIndex=siblings.findIndex(entry=>entry.documentNumber === selectedId);
		let previewPath=selected?.path ?? "";
		let previewError:string|null=null;
		if(entries !== null && selected !== undefined){
			try{
				previewPath=OfficeLawStructure.arrangeOfficeLawEntries(entries)
					.find(entry=>entry.documentNumber === selectedId)?.path ?? "";
			}
			catch(reason){
				previewError=reason instanceof Error ? reason.message : "Ungültige Inhaltsstruktur.";
			}
		}

		return(
			<ManagementDialog title="Inhaltsverzeichnis verwalten" onClose={this.props.onClose} busy={busy}>
				<p>Abschnitte und Vorschriften hinzufügen, umbenennen oder verschieben. Bestehender Text bleibt erhalten.</p>
				{error !== null && <p className="editor-error" role="alert">{error}</p>}
				{entries === null
					?<p role="status">{error === null ? "Inhalt wird geladen …" : "Dialog schließen und erneut versuchen."}</p>
					:<form onSubmit={this.save}>
						<fieldset disabled={busy} className="management-fields">
							<details className="management-law-settings">
								<summary>Gesetzesangaben bearbeiten</summary>
								<label>Abkürzung
									<input required value={metadata.abbreviation} onChange={event=>{
										this.setState(current=>({
											metadata:{...current.metadata,abbreviation:event.target.value},dirty:true
										}));
									}}/>
								</label>
								<label>Gesetzestitel
									<input required value={metadata.title} onChange={event=>{
										this.setState(current=>({
											metadata:{...current.metadata,title:event.target.value},dirty:true
										}));
									}}/>
								</label>
								<label>Kurztitel (optional)
									<input value={metadata.shortTitle ?? ""} onChange={event=>{
										this.setState(current=>({
											metadata:{...current.metadata,shortTitle:event.target.value || null},dirty:true
										}));
									}}/>
								</label>
								<label>Amtlicher Link (HTTPS, ohne /index.html)
									<input required type="url" pattern="https://.*" value={metadata.indexPath} onChange={event=>{
										this.setState(current=>({
											metadata:{...current.metadata,indexPath:event.target.value},dirty:true
										}));
									}}/>
								</label>
							</details>
							<div className="management-actions">
								<button type="button" className="editor-button" onClick={()=>this.add("section")}>Abschnitt hinzufügen</button>
								<button type="button" className="editor-button" onClick={()=>this.add("norm")}>Vorschrift hinzufügen</button>
							</div>
							<div className="management-layout">
								<nav className="management-list" aria-label="Einträge verwalten">
									{entries.map(entry=>(
										<button type="button" key={entry.documentNumber}
											className={entry.documentNumber === selectedId ? "is-selected" : ""}
											onClick={()=>this.setState({selectedId:entry.documentNumber})}>
											<strong>{entry.kind === "section" ? entry.hierarchy?.label : entry.identifier}</strong>
											<span>{entry.kind === "section" ? entry.hierarchy?.title : entry.title}</span>
											<small>{entry.path}</small>
										</button>
									))}
									{entries.length === 0 && <p>Noch keine Einträge. Einen Abschnitt oder eine Vorschrift hinzufügen.</p>}
								</nav>
								{selected !== undefined && (
									<div className="management-entry">
										<p className="management-note">Dokument-ID: {selected.documentNumber}</p>
										<label>{selected.kind === "section" ? "Abschnittsbezeichnung" : "Vorschriftenkennung"}
											<input required value={selected.kind === "section"
												?selected.hierarchy?.label ?? "":selected.identifier ?? ""}
												onChange={event=>selected.kind === "section"
													?this.update({hierarchy:{number:selected.hierarchy?.number ?? "010",
														title:selected.hierarchy?.title ?? null,label:event.target.value}})
													:this.update({identifier:event.target.value})}/>
										</label>
										<label>Titel
											<input value={selected.kind === "section"
												?selected.hierarchy?.title ?? "":selected.title ?? ""}
												onChange={event=>selected.kind === "section"
													?this.update({hierarchy:{number:selected.hierarchy?.number ?? "010",
														label:selected.hierarchy?.label ?? "",title:event.target.value || null}})
													:this.update({title:event.target.value || null})}/>
										</label>
										<label>Übergeordneter Abschnitt
											<select value={selected.parentId ?? ""} onChange={event=>this.modify(items=>
												OfficeLawStructure.moveOfficeLawEntry(items,selectedId,event.target.value || null))}>
												<option value="">Gesetz (oberste Ebene)</option>
												{entries.filter(entry=>entry.kind === "section" && !forbidden.has(entry.documentNumber))
													.map(entry=><option key={entry.documentNumber} value={entry.documentNumber}>
														{entry.path.replace(
															/\/index\.(?:xml|md)$/,""
														)} — {entry.hierarchy?.title}
													</option>)}
											</select>
										</label>
										<div className="management-actions">
											<button className="editor-button" type="button" disabled={siblingIndex<=0}
												onClick={()=>this.modify(items=>
													OfficeLawStructure.reorderOfficeLawEntry(items,selectedId,-1))}>Nach oben</button>
											<button className="editor-button" type="button"
												disabled={siblingIndex<0 || siblingIndex>=siblings.length-1}
												onClick={()=>this.modify(items=>
													OfficeLawStructure.reorderOfficeLawEntry(items,selectedId,1))}>Nach unten</button>
										</div>
										<p className="management-note">Dateipfad nach dem Speichern: <code>{previewPath}</code></p>
										{previewError !== null && <p className="editor-error" role="alert">{previewError}</p>}
										<p className="management-note">Beim Verschieben eines Abschnitts werden alle untergeordneten Einträge mitgenommen.</p>
										<p className="management-note">Die Pfeile ändern die Reihenfolge innerhalb des übergeordneten Abschnitts.</p>
									</div>
								)}
							</div>
						</fieldset>
						<p className="management-note">
							Änderungen werden erst beim Speichern übernommen. Keine Löschung und kein automatischer Git-Commit.
							{" "}Eine separate Vorschrift „Inhaltsübersicht“ bleibt unverändert und kann im Texteditor bearbeitet werden.
						</p>
						<button className="editor-button is-primary" type="submit"
							disabled={busy || !dirty || previewError !== null}>
							{busy ? "Wird gespeichert …" : "Inhaltsverzeichnis speichern"}
						</button>
					</form>}
			</ManagementDialog>
		);
	}
}
