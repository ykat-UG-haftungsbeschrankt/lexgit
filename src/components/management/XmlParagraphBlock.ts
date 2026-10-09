import Paragraph from "@editorjs/paragraph";
import type { ParagraphConfig, ParagraphData } from "@editorjs/paragraph";
import type { BlockToolConstructorOptions } from "@editorjs/editorjs";

// Paragraph's published types require config; Editor.js makes it optional.
export class XmlParagraphBlock extends Paragraph{
	constructor(options:BlockToolConstructorOptions<
		ParagraphData,ParagraphConfig
	>){
		super({
			data:options.data,api:options.api,readOnly:options.readOnly,
			config:options.config ?? {}
		});
	}

	public destructor():void{}
};
