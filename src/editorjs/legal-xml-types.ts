export interface XmlLegalLayout{
	tag:string;
	children:XmlLegalLayout[];
	field?:number;
	path?:number[];
};

export interface XmlLegalData{
	id:string;
	texts:string[];
	layout:XmlLegalLayout;
};
