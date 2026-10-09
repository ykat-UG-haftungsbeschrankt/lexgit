import type { OfficeLawDocument, OfficeLawNorm } from "./types";
import type { OfficeLawSummary } from "./storage";

export interface OfficeLawCitationValue{
	start:string;
	end:string|null;
};

export type OfficeLawCitationQualifierType=
	|"paragraph"|"sentence"|"number"|"letter";

export interface OfficeLawCitationQualifier{
	type:OfficeLawCitationQualifierType;
	values:OfficeLawCitationValue[];
};

export interface OfficeLawCitationReference{
	text:string;
	start:number;
	end:number;
	identifier:string;
	provisionIdentifiers?:OfficeLawCitationValue[];
	paragraph:string|null;
	number:string|null;
	qualifiers?:OfficeLawCitationQualifier[];
	lawName:string|null;
	unsupported:boolean;
	parseError?:string;
};

export interface OfficeLawCitationSpan{
	start:number;
	end:number;
};

interface OfficeLawCitationAnchor extends OfficeLawCitationSpan{
	value:string;
};

const citationValuePattern=new RegExp([
	"^\\s*(?:bis\\s+|[-–]\\s*|,\\s*(?:und\\s+)?|\\b(?:und|oder)\\b\\s*)",
	"(\\d+[a-z]?|[a-z]{1,3})(?=$|[\\s,])"
].join(""),"iu");
const citationQualifierPattern=new RegExp([
	"^(?:\\s*,\\s*|\\s+)",
	"(Absatz(?:es)?|Absätze|Abs\\.?|Satz(?:es)?|Sätze|S\\.?|",
	"Nummern?|Nr\\.?|Buchstaben?|Buchst\\.?|Bst\\.?)",
	"(?=$|\\s)"
].join(""),"iu");
const namedLawPattern=new RegExp([
	"^\\s+(?:des|der)\\s+",
	"((?:[A-ZÄÖÜ][\\p{L}-]*\\s+)*",
	"[A-ZÄÖÜ][\\p{L}-]*",
	"(?:gesetz(?:es|s)?|verordnung|ordnung|buch(?:es|s)?))\\b"
].join(""),"u");
const sentenceAbbreviationPattern=new RegExp([
	"(?:\\b(?:z|u|d|b|h|i|v|o|Abs|Nr|Art|S|Buchst|vgl|",
	"gem|ca|etc|bzw|ggf|insb|sog|inkl|exkl)\\.)$",
	"|\\b(?:z|u)\\.\\s*(?:B|a)\\.$",
	"|\\b(?:i\\.\\s*V\\.\\s*m|i\\.\\s*S\\.\\s*d)\\.$"
].join(""),"iu");

export class OfficeLawCitations{
	protected static normalizeLawName(name:string):string{
		return name.toLocaleLowerCase("de").replace(/[().,\s-]/g,"")
			.replace(/(gesetz|buch)(?:es|s)$/,"$1");
	}

	protected static parseValueList(
		text:string,
		first:string,
		position:number
	):{values:OfficeLawCitationValue[]; end:number; error?:string}{
		const values:OfficeLawCitationValue[]=[{start:first,end:null}];
		let cursor=position;

		while(cursor<text.length){
			const next=text.slice(cursor).match(citationValuePattern);

			if(null === next){
				const incompleteRange=text.slice(cursor).match(/^\s+bis\b/iu);

				if(null !== incompleteRange){
					return{
						values,end:cursor+incompleteRange[0].length,
						error:"Nach 'bis' fehlt das Ende des Bereichs."
					};
				}

				break;
			}

			const value=next[1];
			const previous=values.at(-1);

			if(undefined === value || undefined === previous){
				throw new Error("Ungültiger zusammengesetzter Gesetzesverweis.");
			}

			if(/bis|[-–]/iu.test(next[0] ?? "")){
				previous.end=value.toLocaleLowerCase("de");
			}
			else{
				values.push({start:value.toLocaleLowerCase("de"),end:null});
			}

			cursor+=(next[0] ?? "").length;
		}

		return{values,end:cursor};
	}

	public static _expandCitationValues(
		values:readonly OfficeLawCitationValue[],
		availableValues?:readonly string[]
	):string[]{
		const expanded:string[]=[];

		for(const item of values){
			const first=item.start.toLocaleLowerCase("de");

			if(null === item.end){
				expanded.push(first);
				continue;
			}

			const last=item.end.toLocaleLowerCase("de");

			if(undefined !== availableValues){
				const available=[...new Set(availableValues.map(value=>
					value.toLocaleLowerCase("de")
				))].sort(OfficeLawCitations._compareCitationValues);

				if(!available.includes(first) || !available.includes(last)){
					throw new Error(
						`Der Bereich ${first} bis ${last} wurde nicht vollständig gefunden.`
					);
				}

				expanded.push(...available.filter(value=>
					OfficeLawCitations._compareCitationValues(value,first)>=0
					&& OfficeLawCitations._compareCitationValues(value,last)<=0
				));
				continue;
			}

			const firstNumber=first.match(/^(\d+)([a-z]?)$/u);
			const lastNumber=last.match(/^(\d+)([a-z]?)$/u);

			if(null !== firstNumber && null !== lastNumber){
				const firstBase=Number(firstNumber[1]);
				const lastBase=Number(lastNumber[1]);
				const firstSuffix=firstNumber[2] ?? "";
				const lastSuffix=lastNumber[2] ?? "";

				if(firstSuffix !== lastSuffix){
					if(firstBase !== lastBase || firstSuffix.length !== 1
						|| lastSuffix.length !== 1){
						throw new Error(`Der Bereich ${first} bis ${last} ist ungültig.`);
					}

					const from=firstSuffix.codePointAt(0) ?? 0;
					const to=lastSuffix.codePointAt(0) ?? 0;

					if(from>to || to-from>199){
						throw new Error(`Der Bereich ${first} bis ${last} ist ungültig.`);
					}

					for(let code=from;code<=to;code++){
						expanded.push(`${firstBase}${String.fromCodePoint(code)}`);
					}
					continue;
				}

				if(lastBase<firstBase || lastBase-firstBase>199){
					throw new Error(`Der Bereich ${first} bis ${last} ist ungültig.`);
				}

				for(let number=firstBase;number<=lastBase;number++){
					expanded.push(`${number}${firstSuffix}`);
				}
				continue;
			}

			if(/^[a-z]$/u.test(first) && /^[a-z]$/u.test(last)){
				const from=first.codePointAt(0) ?? 0;
				const to=last.codePointAt(0) ?? 0;

				if(from>to || to-from>199){
					throw new Error(`Der Bereich ${first} bis ${last} ist ungültig.`);
				}

				for(let code=from;code<=to;code++){
					expanded.push(String.fromCodePoint(code));
				}
				continue;
			}

			throw new Error(`Der Bereich ${first} bis ${last} ist ungültig.`);
		}

		return [...new Set(expanded)];
	}

	protected static _compareCitationValues(
		first:string,
		second:string
	):number{
		const firstNumber=first.match(/^(\d+)([a-z]*)$/u);
		const secondNumber=second.match(/^(\d+)([a-z]*)$/u);

		if(null !== firstNumber && null !== secondNumber){
			const firstBase=Number(firstNumber[1]);
			const secondBase=Number(secondNumber[1]);

			if(firstBase !== secondBase){
				return firstBase-secondBase;
			}

			return (firstNumber[2] ?? "").localeCompare(
				secondNumber[2] ?? ""
			);
		}

		return first.localeCompare(second,"de");
	}

	protected static qualifierAt(
		text:string,
		position:number
	):{
		type:OfficeLawCitationQualifierType;
		label:string;
		end:number;
	}|null{
		const match=text.slice(position).match(citationQualifierPattern);
		const label=match?.[1]?.toLocaleLowerCase("de");

		if(null === match || undefined === label){
			return null;
		}

		let type:OfficeLawCitationQualifierType;

		if(/^abs/u.test(label)){
			type="paragraph";
		}
		else if(/^s/u.test(label)){
			type="sentence";
		}
		else if(/^nr|^nummer/u.test(label)){
			type="number";
		}
		else{
			type="letter";
		}

		return{type,label,end:position+match[0].length};
	}

	protected static valueAt(
		text:string,
		position:number,
		type:OfficeLawCitationQualifierType
	):{value:string; end:number}|null{
		const pattern="letter" === type
			?/^\s*([a-z]{1,3})(?=$|[\s,])/iu
			:/^\s*(\d+[a-z]?)(?=$|[\s,])/iu;
		const match=text.slice(position).match(pattern);
		const value=match?.[1];

		if(null === match || undefined === value){
			return null;
		}

		return{
			value:value.toLocaleLowerCase("de"),
			end:position+match[0].length
		};
	}

	protected static parseQualifiers(
		text:string,
		position:number
	):{
		qualifiers:OfficeLawCitationQualifier[];
		end:number;
		error?:string;
	}{
		const qualifiers:OfficeLawCitationQualifier[]=[];
		let cursor=position;

		while(cursor<text.length){
			const qualifier=OfficeLawCitations.qualifierAt(text,cursor);

			if(null === qualifier){
				break;
			}

			const first=OfficeLawCitations.valueAt(text,qualifier.end,qualifier.type);

			if(null === first){
				return{
					qualifiers,end:qualifier.end,
					error:`Nach ${qualifier.label} fehlt der zitierte Wert.`
				};
			}

			const parsed=OfficeLawCitations.parseValueList(
				text,first.value,first.end
			);
			qualifiers.push({type:qualifier.type,values:parsed.values});
			cursor=parsed.end;

			if(undefined !== parsed.error){
				return{qualifiers,end:cursor,error:parsed.error};
			}
		}

		return{qualifiers,end:cursor};
	}

	protected static namedLaw(
		tail:string,
		aliases:readonly string[]
	):{lawName:string|null; length:number}{
		const namedLaw=tail.match(namedLawPattern);

		if(null !== namedLaw){
			return{lawName:namedLaw[1] ?? null,length:namedLaw[0].length};
		}

		const prefix=tail.match(/^\s+(?:(?:des|der)\s+)?/u)?.[0] ?? "";
		const remaining=tail.slice(prefix.length);
		const alias=aliases.find(candidate=>remaining.startsWith(candidate)
			&& !/[\p{L}\d]/u.test(remaining.charAt(candidate.length)));

		if(undefined !== alias){
			return{lawName:alias,length:prefix.length+alias.length};
		}

		const unknownName=tail.match(
			/^\s+(?:des|der)\s+((?:[A-ZÄÖÜ][\p{L}-]*\s+)*[A-ZÄÖÜ][\p{L}-]*)/u
		);
		const unknownAbbreviation=tail.match(
			/^\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]*[A-Z][A-Za-z]*)\b/u
		);
		const unknown=unknownName ?? unknownAbbreviation;

		if(null !== unknown){
			return{lawName:unknown[1] ?? null,length:unknown[0].length};
		}

		return{lawName:null,length:0};
	}

	public static citationLawSource(
		reference:OfficeLawCitationReference,
		current:OfficeLawDocument,
		sources:readonly OfficeLawSummary[]
	):OfficeLawSummary|undefined{
		if(null === reference.lawName){
			return sources.find(source=>source.slug === current.slug);
		}

		const name=OfficeLawCitations.normalizeLawName(reference.lawName);
		return sources.find(source=>[
			source.abbreviation,source.title,source.shortTitle,
			...(source.slug === current.slug
				?[current.metadata.officialAbbreviation,current.metadata.shortTitle]
				:[])
		].some(alias=>null !== alias && undefined !== alias
			&& OfficeLawCitations.normalizeLawName(alias) === name));
	}

	public static findOfficeLawCitations(
		text:string,
		sources:readonly OfficeLawSummary[]
	):OfficeLawCitationReference[]{
		const pattern=/(?<!§)§{1,2}\s*(\d+[a-z]?)/giu;
		const references:OfficeLawCitationReference[]=[];
		const aliases=sources.flatMap(source=>[
			source.abbreviation,source.shortTitle,source.title
		]).filter((alias):alias is string=>
			null !== alias && alias.length>0
		)
			.sort((a,b)=>b.length-a.length);

		for(const match of text.matchAll(pattern)){
			const start=match.index;
			const first=match[1];

			if(undefined === start || undefined === first){
				continue;
			}

			let end=start+match[0].length;
			const provisions=OfficeLawCitations.parseValueList(text,first,end);
			end=provisions.end;

			const parsedQualifiers=OfficeLawCitations.parseQualifiers(text,end);
			end=parsedQualifiers.end;

			const named=OfficeLawCitations.namedLaw(text.slice(end),aliases);
			end+=named.length;

			const provisionIdentifiers=provisions.values;
			const parseError=provisions.error ?? parsedQualifiers.error;
			const paragraph=parsedQualifiers.qualifiers.find(
				qualifier=>"paragraph" === qualifier.type
			)?.values[0]?.start ?? null;
			const number=parsedQualifiers.qualifiers.find(
				qualifier=>"number" === qualifier.type
			)?.values[0]?.start ?? null;

			references.push({
				text:text.slice(start,end),start,end,
				identifier:`§ ${provisionIdentifiers[0]?.start ?? first}`,
				provisionIdentifiers,paragraph,number,
				qualifiers:parsedQualifiers.qualifiers,
				lawName:named.lawName,unsupported:false,
				...(undefined === parseError ? {} : {parseError})
			});
		}

		return references;
	}

	protected static paragraphSpans(text:string):OfficeLawCitationAnchor[]{
		const starts=Array.from(text.matchAll(/^\((\d+[a-z]?)\)[ \t]*/gmu));
		return starts.map((match,index)=>{
			const next=starts[index+1];
			return{
				value:(match[1] ?? "").toLocaleLowerCase("de"),
				start:match.index ?? 0,
				end:next?.index ?? text.length
			};
		});
	}

	protected static numberSpans(
		text:string,
		scope:OfficeLawCitationSpan
	):OfficeLawCitationAnchor[]{
		const content=text.slice(scope.start,scope.end);
		const starts=Array.from(content.matchAll(/^(\d+[a-z]?)\.[ \t]*$/gmu));
		return starts.map((match,index)=>{
			const next=starts[index+1];
			return{
				value:(match[1] ?? "").toLocaleLowerCase("de"),
				start:scope.start+(match.index ?? 0),
				end:scope.start+(next?.index ?? content.length)
			};
		});
	}

	protected static letterSpans(
		text:string,
		scope:OfficeLawCitationSpan
	):OfficeLawCitationAnchor[]{
		const content=text.slice(scope.start,scope.end);
		const starts=Array.from(content.matchAll(/^([a-z]{1,3})\)[ \t]*$/gmu));
		const numbers=OfficeLawCitations.numberSpans(
			content,{start:0,end:content.length}
		);
		return starts.map((match,index)=>{
			const value=match[1]?.toLocaleLowerCase("de") ?? "";
			const next=starts.slice(index+1).find(candidate=>{
				const nextValue=candidate[1] ?? "";
				return nextValue.length<=value.length;
			});
			const nextNumber=numbers.find(candidate=>
				candidate.start>(match.index ?? 0)
			);
			const nextLetterIndex=next?.index;
			const nextNumberIndex=nextNumber?.start;
			const nextIndex=undefined === nextLetterIndex
				?nextNumberIndex
				:undefined === nextNumberIndex
				?nextLetterIndex
				:Math.min(nextLetterIndex,nextNumberIndex);

			return{
				value,
				start:scope.start+(match.index ?? 0),
				end:scope.start+(nextIndex ?? content.length)
			};
		});
	}

	protected static selectAnchors(
		text:string,
		scopes:readonly OfficeLawCitationSpan[],
		values:readonly OfficeLawCitationValue[],
		type:OfficeLawCitationQualifierType
	):OfficeLawCitationSpan[]{
		const selected:OfficeLawCitationSpan[]=[];

		for(const scope of scopes){
			const anchors="number" === type
				?OfficeLawCitations.numberSpans(text,scope)
				:OfficeLawCitations.letterSpans(text,scope);
			const available=anchors.map(anchor=>anchor.value);
			const expanded=[...new Set(values.flatMap(value=>{
				const candidates="letter" === type && null !== value.end
					?available.filter(candidate=>
						candidate.length === value.start.length
					)
					:available;
				return OfficeLawCitations._expandCitationValues(
					[value],candidates
				);
			}))];
			const matches=new Map<string,OfficeLawCitationAnchor[]>();

			for(const anchor of anchors){
				const list=matches.get(anchor.value) ?? [];
				list.push(anchor);
				matches.set(anchor.value,list);
			}

			for(const value of expanded){
				const found=matches.get(value) ?? [];

				if(found.length === 0){
					const label="number" === type?"Nummer":"Buchstabe";
					throw new Error(`${label} ${value} wurde nicht gefunden.`);
				}

				if(found.length>1){
					const label="number" === type?"Nummer":"Buchstabe";
					throw new Error(
						`${label} ${value} wurde nicht eindeutig gefunden. `
						+"Bitte den Absatz angeben."
					);
				}

				const anchor=found[0];

				if(undefined !== anchor){
					selected.push({start:anchor.start,end:anchor.end});
				}
			}
		}

		return selected;
	}

	protected static sentenceSpans(text:string):OfficeLawCitationSpan[]{
		const spans:OfficeLawCitationSpan[]=[];
		let start=0;

		for(let index=0;index<text.length;index++){
			const character=text.charAt(index);

			if("." !== character && "!" !== character && "?" !== character){
				continue;
			}

			if("." === character
				&& OfficeLawCitations.isAbbreviationPeriod(text,index)){
				continue;
			}

			let end=index+1;
			while(/[)\]"'»”’]/u.test(text.charAt(end))){
				end++;
			}

			if(!/\s/u.test(text.charAt(end))){
				continue;
			}

			let next=end;
			while(/\s/u.test(text.charAt(next))){
				next++;
			}

			if(!/[A-ZÄÖÜ0-9§(]/u.test(text.charAt(next))){
				continue;
			}

			spans.push({start,end});
			start=next;
			index=end-1;
		}

		if(start<text.length){
			spans.push({start,end:text.length});
		}

		return spans;
	}

	protected static isAbbreviationPeriod(text:string,index:number):boolean{
		const lineStart=text.lastIndexOf("\n",index)+1;
		const line=text.slice(lineStart,index+1);

		if(/^\d+[a-z]?\.$/iu.test(line)){
			return true;
		}

		const context=text.slice(Math.max(0,index-24),index+1);
		return sentenceAbbreviationPattern.test(context);
	}

	protected static selectSentences(
		text:string,
		scopes:readonly OfficeLawCitationSpan[],
		values:readonly string[]
	):OfficeLawCitationSpan[]{
		const selected:OfficeLawCitationSpan[]=[];

		for(const scope of scopes){
			const content=text.slice(scope.start,scope.end);
			const sentences=OfficeLawCitations.sentenceSpans(content);

			for(const value of values){
				const index=Number(value)-1;
				const sentence=sentences[index];

				if(!Number.isInteger(index) || index<0
					|| undefined === sentence){
					throw new Error(`Satz ${value} wurde nicht gefunden.`);
				}

				selected.push({
					start:scope.start+sentence.start,
					end:scope.start+sentence.end
				});
			}
		}

		return selected;
	}

	public static officeLawCitationExcerpt(
		norm:OfficeLawNorm,
		reference:OfficeLawCitationReference
	):string{
		const text=norm.paragraphs.join("\n\n");
		const scopes=OfficeLawCitations.officeLawCitationScopes(norm,reference);
		return scopes.map((scope)=>{
			return text.slice(scope.start,scope.end).trim();
		}).filter((value)=>{
			return 0<value.length;
		}).join("\n\n");
	}

	public static officeLawCitationScopes(
		norm:OfficeLawNorm,
		reference:OfficeLawCitationReference
	):OfficeLawCitationSpan[]{
		if(undefined !== reference.parseError){
			throw new Error(reference.parseError);
		}

		const text=norm.paragraphs.join("\n\n");
		const qualifiers=reference.qualifiers ?? [
			...(null === reference.paragraph ? [] : [{
				type:"paragraph" as const,
				values:[{start:reference.paragraph,end:null}]
			}]),
			...(null === reference.number ? [] : [{
				type:"number" as const,
				values:[{start:reference.number,end:null}]
			}])
		];
		let scopes:OfficeLawCitationSpan[]=[{start:0,end:text.length}];

		for(const type of ["paragraph","number","letter","sentence"] as const){
			const matching=qualifiers.filter(item=>item.type === type);

			if(matching.length === 0){
				continue;
			}

			const values=matching.flatMap(item=>item.values);

			if("paragraph" === type){
				const paragraphs=OfficeLawCitations.paragraphSpans(text);
				const expanded=OfficeLawCitations._expandCitationValues(
					values,paragraphs.map(paragraph=>paragraph.value)
				);
				scopes=expanded.map(value=>{
					const paragraph=paragraphs.find(item=>item.value === value);

					if(undefined === paragraph){
						throw new Error(
							`Absatz ${value} wurde in dieser Vorschrift nicht gefunden.`
						);
					}

					return{start:paragraph.start,end:paragraph.end};
				});
			}
			else if("number" === type || "letter" === type){
				scopes=OfficeLawCitations.selectAnchors(
					text,scopes,values,type
				);
			}
			else{
				const expanded=OfficeLawCitations._expandCitationValues(values);
				scopes=OfficeLawCitations.selectSentences(
					text,scopes,expanded
				);
			}
		}

		const excerpt=scopes.map(scope=>text.slice(scope.start,scope.end).trim())
			.filter(value=>value.length>0).join("\n\n");

		if(!excerpt){
			throw new Error("Für die zitierte Vorschrift liegt kein Text vor.");
		}

		return scopes;
	}
};
