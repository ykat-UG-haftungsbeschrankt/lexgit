import { createContext } from "react";
import type { OfficeLawDocument } from "../../law/types";
import type { OfficeLawSummary } from "../../law/storage";
import type { OfficeLawCitationResolver } from "../../law/client";

export interface CitationContextValue{
	law:OfficeLawDocument;
	sources:readonly OfficeLawSummary[];
	resolver:OfficeLawCitationResolver;
}

export const CitationContext=createContext<CitationContextValue|null>(null);
