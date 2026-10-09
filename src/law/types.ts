export interface OfficeLawCitation{
	type:string|null;
	periodical:string|null;
	reference:string|null;
};

export interface OfficeLawStatusNote{
	type:string|null;
	text:string|null;
};

export interface OfficeLawMetadata{
	abbreviation:string|null;
	officialAbbreviation:string|null;
	shortTitle:string|null;
	title:string|null;
	enactmentDate:string|null;
	citations:OfficeLawCitation[];
	statusNotes:OfficeLawStatusNote[];
};

export interface OfficeLawHierarchy{
	number:string|null;
	label:string|null;
	title:string|null;
};

export interface OfficeLawNorm{
	documentNumber:string;
	kind:"section"|"norm";
	identifier:string|null;
	title:string|null;
	hierarchy:OfficeLawHierarchy|null;
	paragraphs:string[];
	footnotes:string[];
	sourceXml?:utf8_t;
};

export interface OfficeLawDocument{
	normPaths?:Record<utf8_t,utf8_t>;
	slug:string;
	documentNumber:string;
	buildDate:string|null;
	normDocumentNumbers:string[];
	metadata:OfficeLawMetadata;
	introductoryNotes:string[];
	norms:OfficeLawNorm[];
};

export interface OfficeLawNormFrontMatter{
	documentNumber:string;
	kind:"section"|"norm";
	identifier:string|null;
	title:string|null;
	hierarchy:OfficeLawHierarchy|null;
	footnotes:string[];
};
