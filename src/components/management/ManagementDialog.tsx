import { Component } from "react";
import type { ReactNode, SyntheticEvent } from "react";

interface ManagementDialogProps{
	title:string;
	onClose:()=>void;
	busy:boolean;
	children:ReactNode;
}

export class ManagementDialog extends Component<ManagementDialogProps>{
	private dialog:HTMLDialogElement|null=null;

	public componentDidMount():void{
		if(this.dialog !== null && !this.dialog.open){
			this.dialog.showModal();
		}
	}

	public componentWillUnmount():void{
		if(this.dialog?.open){
			this.dialog.close();
		}
	}

	private setDialog=(dialog:HTMLDialogElement|null):void=>{
		this.dialog=dialog;
	};

	private handleCancel=(event:SyntheticEvent<HTMLDialogElement>):void=>{
		event.preventDefault();
		if(!this.props.busy){
			this.props.onClose();
		}
	};

	public render():ReactNode{
		const {title,onClose,busy,children}=this.props;
		return(
			<dialog ref={this.setDialog} className="management-dialog" aria-label={title}
				onCancel={this.handleCancel}>
				<div className="management-heading">
					<h2>{title}</h2>
					<button type="button" className="editor-button" disabled={busy} onClick={onClose}>
						Abbrechen
					</button>
				</div>
				{children}
			</dialog>
		);
	}
}
