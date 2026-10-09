import type { BlockToolConstructorOptions } from "@editorjs/editorjs";

interface Data{
	id:string;
	label:string;
};

export class PreservedXmlBlock{
	protected readonly _data:Data;

	constructor(options:BlockToolConstructorOptions<Data>){
		this._data=options.data;
	}

	public static get isReadOnlySupported():boolean{
		return true;
	}

	public render():HTMLElement{
		const element=document.createElement("div");
		element.className="xml-protected";
		element.textContent=`Geschützter XML-Block: ${this._data.label}. `
			+"Zum Bearbeiten die Baum- oder Quelltextansicht verwenden.";
		return element;
	}

	public save():Data{
		return this._data;
	}

	public destructor():void{}
};
