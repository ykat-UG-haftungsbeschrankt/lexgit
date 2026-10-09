import { Component } from "react";
import type { ReactNode } from "react";
import type { OfficeLawDocument } from "../../law/types";
import type { OfficeLawSummary } from "../../law/storage";
import { OfficeLawCitationResolver } from "../../law/client";
import { CitationContext } from "./CitationContext";
import type { CitationContextValue } from "./CitationContext";

interface CitationProviderProperties{
	law:OfficeLawDocument;
	sources:readonly OfficeLawSummary[];
	children:ReactNode;
	version?:string|null;
};

export class CitationProvider extends Component<CitationProviderProperties>{
	protected _value:CitationContextValue|null;
	protected _version:string|null;

	constructor(properties:CitationProviderProperties){
		super(properties);
		this._value=null;
		this._version=null;
	}

	public componentWillUnmount():void{
		this._value?.resolver.destructor();
		this._value=null;
	}

	public render():ReactNode{
		const {law,sources,children}=this.props;
		const version=this.props.version ?? null;
		if(null === this._value || this._value.law !== law
			|| this._value.sources !== sources || this._version !== version){
			this._value?.resolver.destructor();
			this._version=version;
			this._value={
				law,sources,
				resolver:new OfficeLawCitationResolver(law,sources,version)
			};
		}
		return(
			<CitationContext.Provider value={this._value}>
				{children}
			</CitationContext.Provider>
		);
	}
};
