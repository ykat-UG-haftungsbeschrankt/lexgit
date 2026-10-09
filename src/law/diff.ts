import { OfficeLawXml } from "./xml";

type XmlDocument=ReturnType<typeof OfficeLawXml.parseDocument>;
type XmlElement=NonNullable<XmlDocument["documentElement"]>;
type XmlNode=NonNullable<ReturnType<XmlElement["childNodes"]["item"]>>;

interface XmlDiffSignature{
	name:utf8_t;
	value:utf8_t;
	children:XmlDiffSignature[];
};

export interface OfficeLawDiffLine{
	kind:"added"|"modified"|"removed"|"unchanged";
	text:string;
	originalText:string|null;
	editedText:string|null;
};

export interface OfficeLawLineChange{
	kind:"added"|"removed"|"unchanged";
	text:string;
};

export class OfficeLawDiff{
	public destructor():void{}

	public static createXmlDiff(
		original:utf8_t|null,edited:utf8_t|null,
		container:"text"|"fussnoten"="text"
	):utf8_t{
		if(null === original && null === edited){
			throw new Error("An XML diff needs at least one source.");
		}
		const before=null === original ? null
			:OfficeLawXml.parseDocument(original);
		const after=null === edited ? null
			:OfficeLawXml.parseDocument(edited);
		const document=OfficeLawXml.parseDocument(edited ?? original!);
		for(const source of [before,after]){
			if(null !== source){
				OfficeLawDiff._validateXml(source.documentElement!);
			}
		}
		const root=document.documentElement!;
		const data=OfficeLawDiff._ensureXml(document,root,"textdaten");
		const target=OfficeLawDiff._ensureXml(document,data,container);
		const content=OfficeLawDiff._ensureXml(document,target,"Content");
		while(null !== content.firstChild){
			content.removeChild(content.firstChild);
		}
		const previous=null === before ? null
			:OfficeLawDiff._xmlContent(before.documentElement!,container);
		const current=null === after ? null
			:OfficeLawDiff._xmlContent(after.documentElement!,container);
		OfficeLawDiff._diffXmlChildren(
			document,content,
			null === previous ? []:OfficeLawDiff._xmlChildren(previous),
			null === current ? []:OfficeLawDiff._xmlChildren(current)
		);
		return OfficeLawXml.serialize(root);
	}

	protected static _validateXml(node:XmlNode):void{
		if(1 === node.nodeType){
			const element=node as XmlElement;
			if("diff" === element.nodeName.toLowerCase()
				|| element.hasAttribute("diff")){
				throw new Error("Source XML contains reserved diff annotations.");
			}
		}
		for(let index=0;index<node.childNodes.length;index++){
			const child=node.childNodes.item(index);
			if(null !== child){
				OfficeLawDiff._validateXml(child);
			}
		}
	}

	protected static _ensureXml(
		document:XmlDocument,parent:XmlElement,name:utf8_t
	):XmlElement{
		const found=OfficeLawXml.children(parent,name)[0];
		if(undefined !== found){
			return found;
		}
		const element=document.createElement(name);
		parent.appendChild(element);
		return element;
	}

	protected static _xmlContent(
		root:XmlElement,container:utf8_t
	):XmlElement|null{
		const data=OfficeLawXml.children(root,"textdaten")[0];
		const target=undefined === data ? undefined
			:OfficeLawXml.children(data,container)[0];
		return undefined === target ? null
			:OfficeLawXml.children(target,"Content")[0] ?? null;
	}

	protected static _xmlChildren(parent:XmlNode):XmlNode[]{
		const nodes:XmlNode[]=[];
		let text:utf8_t="";
		for(let index=0;index<parent.childNodes.length;index++){
			const child=parent.childNodes.item(index);
			if(null === child){
				continue;
			}
			if(3 === child.nodeType || 4 === child.nodeType){
				text+=child.nodeValue ?? "";
			}
			else{
				if(0<text.length){
					nodes.push(parent.ownerDocument!.createTextNode(text));
					text="";
				}
				nodes.push(child);
			}
		}
		if(0<text.length){
			nodes.push(parent.ownerDocument!.createTextNode(text));
		}
		// Ignore indentation only in purely structural containers.
		const structural=new Set([
			"content","dl","ul","ol","table","thead","tbody","tfoot",
			"tr","tgroup","row","colgroup"
		]);
		if(structural.has(parent.nodeName.toLowerCase())
			&& !nodes.some(OfficeLawDiff._hasXmlText)){
			return nodes.filter(OfficeLawDiff._isXmlContent);
		}
		return nodes;
	}

	protected static _hasXmlText(node:XmlNode):bool_t{
		return 3 === node.nodeType && 0<(node.nodeValue ?? "").trim().length;
	}

	protected static _isXmlContent(node:XmlNode):bool_t{
		return 3 !== node.nodeType || OfficeLawDiff._hasXmlText(node);
	}

	protected static _xmlAttributes(node:XmlNode):utf8_t{
		if(1 !== node.nodeType){
			return "";
		}
		const element=node as XmlElement;
		const values:utf8_t[]=[];
		for(let index=0;index<element.attributes.length;index++){
			const attribute=element.attributes.item(index);
			if(null !== attribute){
				values.push(JSON.stringify([attribute.name,attribute.value]));
			}
		}
		values.sort();
		return JSON.stringify(values);
	}

	protected static _xmlKey(node:XmlNode):utf8_t{
		return JSON.stringify(OfficeLawDiff._xmlSignature(node));
	}

	protected static _xmlSignature(node:XmlNode):XmlDiffSignature{
		if(3 === node.nodeType){
			return{name:"#text",value:node.nodeValue ?? "",children:[]};
		}
		if(1 !== node.nodeType){
			return{
				name:node.nodeName,value:OfficeLawXml.serialize(node),
				children:[]
			};
		}
		return{
			name:node.nodeName.toLowerCase(),
			value:OfficeLawDiff._xmlAttributes(node),
			children:OfficeLawDiff._xmlChildren(node).map(
				OfficeLawDiff._xmlSignature
			)
		};
	}

	protected static _xmlCompatible(
		before:XmlNode,after:XmlNode
	):bool_t{
		return before.nodeType === after.nodeType
			&& (3 === before.nodeType
				|| 1 === before.nodeType
					&& before.nodeName.toLowerCase()
						=== after.nodeName.toLowerCase()
					&& OfficeLawDiff._xmlAttributes(before)
						=== OfficeLawDiff._xmlAttributes(after));
	}

	protected static _xmlTokens(node:XmlNode):Set<utf8_t>{
		return new Set((node.textContent ?? "").match(/\S+/g) ?? []);
	}

	protected static _xmlEditCost(
		before:XmlNode,after:XmlNode,
		oldTokens:Set<utf8_t>,newTokens:Set<utf8_t>
	):size_t{
		// A gap costs 4; compatible edits cost 1-7, replacements cost 9.
		if(!OfficeLawDiff._xmlCompatible(before,after)){
			return 9;
		}
		let shared:size_t=0;
		for(const token of oldTokens){
			if(newTokens.has(token)){
				shared++;
			}
		}
		const count=Math.max(oldTokens.size,newTokens.size,1);
		return 1+Math.floor(6*(1-shared/count));
	}

	protected static _diffXmlChildren(
		document:XmlDocument,parent:XmlElement,
		before:XmlNode[],after:XmlNode[]
	):void{
		if(250000<before.length*after.length){
			throw new Error("XML sibling sequence is too large to compare.");
		}
		const oldKeys=before.map(OfficeLawDiff._xmlKey);
		const newKeys=after.map(OfficeLawDiff._xmlKey);
		const oldTokens=before.map(OfficeLawDiff._xmlTokens);
		const newTokens=after.map(OfficeLawDiff._xmlTokens);
		const table:Uint32Array[]=[];
		const costs:Uint8Array[]=[];
		for(let index=0;index<=before.length;index++){
			table.push(new Uint32Array(after.length+1));
			costs.push(new Uint8Array(after.length+1));
		}
		for(let row=before.length;0 <= row;row--){
			for(let col=after.length;0 <= col;col--){
				if(before.length === row){
					table[row]![col]=4*(after.length-col);
				}
				else if(after.length === col){
					table[row]![col]=4*(before.length-row);
				}
				else{
					const cost=oldKeys[row] === newKeys[col] ? 0
						:OfficeLawDiff._xmlEditCost(
							before[row]!,after[col]!,
							oldTokens[row]!,newTokens[col]!
						);
					costs[row]![col]=cost;
					table[row]![col]=Math.min(
						cost+table[row+1]![col+1]!,
						4+table[row+1]![col]!,
						4+table[row]![col+1]!
					);
				}
			}
		}
		let row:size_t=0;
		let col:size_t=0;
		while(row<before.length || col<after.length){
			const oldNode=before[row];
			const newNode=after[col];
			if(undefined !== oldNode && undefined !== newNode){
				const cost=costs[row]![col]!;
				if(table[row]![col] === cost+table[row+1]![col+1]!){
					OfficeLawDiff._diffXmlNode(
						document,parent,oldNode,newNode,0 === cost
					);
					row++;
					col++;
					continue;
				}
			}
			if(undefined !== oldNode && (
				undefined === newNode
				|| table[row]![col] === 4+table[row+1]![col]!
			)){
				OfficeLawDiff._appendXmlChange(
					document,parent,oldNode,"removed"
				);
				row++;
			}
			else if(undefined !== newNode){
				OfficeLawDiff._appendXmlChange(
					document,parent,newNode,"added"
				);
				col++;
			}
		}
	}

	protected static _diffXmlNode(
		document:XmlDocument,parent:XmlElement,
		before:XmlNode,after:XmlNode,unchanged:bool_t
	):void{
		if(unchanged){
			parent.appendChild(document.importNode(after,true));
		}
		else if(3 === before.nodeType){
			for(const part of OfficeLawDiff.createTokenDiff(
				before.nodeValue ?? "",after.nodeValue ?? ""
			)){
				const text=document.createTextNode(part.text);
				if("unchanged" === part.kind){
					parent.appendChild(text);
				}
				else{
					OfficeLawDiff._appendXmlChange(
						document,parent,text,part.kind
					);
				}
			}
		}
		else{
			const element=document.importNode(after,false) as XmlElement;
			OfficeLawDiff._diffXmlChildren(
				document,element,OfficeLawDiff._xmlChildren(before),
				OfficeLawDiff._xmlChildren(after)
			);
			parent.appendChild(element);
		}
	}

	protected static _appendXmlChange(
		document:XmlDocument,parent:XmlElement,node:XmlNode,
		kind:"added"|"removed"
	):void{
		const copy=document.importNode(node,true);
		if(1 === copy.nodeType){
			const element=copy as XmlElement;
			element.setAttribute("diff",kind);
			parent.appendChild(element);
		}
		else if(3 === copy.nodeType || 4 === copy.nodeType){
			const element=document.createElement("diff");
			element.setAttribute("diff",kind);
			element.appendChild(copy);
			parent.appendChild(element);
		}
		else{
			parent.appendChild(copy);
		}
	}

	static createTokenDiff(
		originalText:string,
		editedText:string
	):OfficeLawLineChange[]{
		const originalTokens=originalText.match(/\s+|\S+/g) ?? [];
		const editedTokens=editedText.match(/\s+|\S+/g) ?? [];
		const tableSize=originalTokens.length*editedTokens.length;

		if(100000<tableSize){
			return[
				{kind:"removed",text:originalText},
				{kind:"added",text:editedText}
			];
		}

		const table:Array<Uint32Array>=[];

		for(let row=0;row<=originalTokens.length;row++){
			table.push(new Uint32Array(editedTokens.length+1));
		}

		for(let originalIndex=originalTokens.length-1;
			0<=originalIndex;
			originalIndex--){
			const row=table[originalIndex];
			const nextRow=table[originalIndex+1];

			if(row === undefined || nextRow === undefined){
				throw new Error("Unable to calculate the inline text diff.");
			}

			for(let editedIndex=editedTokens.length-1;
				0<=editedIndex;
				editedIndex--){
				if(originalTokens[originalIndex] === editedTokens[editedIndex]){
					row[editedIndex]=1+(nextRow[editedIndex+1] ?? 0);
				}
				else{
					row[editedIndex]=Math.max(
						nextRow[editedIndex] ?? 0,
						row[editedIndex+1] ?? 0
					);
				}
			}
		}

		const parts:OfficeLawLineChange[]=[];
		let originalIndex=0;
		let editedIndex=0;

		function appendPart(kind:OfficeLawLineChange["kind"],text:string):void{
			const previous=parts.at(-1);

			if(previous?.kind === kind){
				previous.text+=text;
			}
			else{
				parts.push({kind,text});
			}
		}

		while(
			originalIndex<originalTokens.length
			|| editedIndex<editedTokens.length
		){
			const originalToken=originalTokens[originalIndex];
			const editedToken=editedTokens[editedIndex];

			if(
				originalToken !== undefined
				&& editedToken !== undefined
				&& originalToken === editedToken
			){
				appendPart("unchanged",originalToken);
				originalIndex++;
				editedIndex++;
				continue;
			}

			const row=table[originalIndex];
			const nextRow=table[originalIndex+1];
			const canRemove=originalToken !== undefined
				&& (
					editedToken === undefined
					|| (
						row !== undefined
						&& nextRow !== undefined
						&& (nextRow[editedIndex] ?? 0)
							>= (row[editedIndex+1] ?? 0)
					)
				);

			if(canRemove && originalToken !== undefined){
				appendPart("removed",originalToken);
				originalIndex++;
			}
			else if(editedToken !== undefined){
				appendPart("added",editedToken);
				editedIndex++;
			}
		}

		return parts;
	}

	static createInlineLineDiff(
		originalText:string,
		editedText:string
	):OfficeLawDiffLine[]{
		const lines=OfficeLawDiff.createLineDiff(originalText,editedText);
		const result:OfficeLawDiffLine[]=[];

		for(let index=0;index<lines.length;){
			const line=lines[index];

			if(line === undefined){
				index++;
				continue;
			}

			if(line.kind === "unchanged"){
				result.push({
					kind:"unchanged",
					text:line.text,
					originalText:line.text,
					editedText:line.text
				});
				index++;
				continue;
			}

			const removed:string[]=[];
			const added:string[]=[];

			while(index<lines.length){
				const changed=lines[index];

				if(changed === undefined || changed.kind === "unchanged"){
					break;
				}

				if(changed.kind === "removed"){
					removed.push(changed.text);
				}
				else{
					added.push(changed.text);
				}

				index++;
			}

			const pairedCount=Math.min(removed.length,added.length);

			for(let pairIndex=0;pairIndex<pairedCount;pairIndex++){
				const originalLine=removed[pairIndex];
				const editedLine=added[pairIndex];

				if(originalLine !== undefined && editedLine !== undefined){
					result.push({
						kind:"modified",
						text:editedLine,
						originalText:originalLine,
						editedText:editedLine
					});
				}
			}

			for(let removedIndex=pairedCount;
				removedIndex<removed.length;
				removedIndex++){
				const removedLine=removed[removedIndex];

				if(removedLine !== undefined){
					result.push({
						kind:"removed",
						text:removedLine,
						originalText:removedLine,
						editedText:null
					});
				}
			}

			for(let addedIndex=pairedCount;
				addedIndex<added.length;
				addedIndex++){
				const addedLine=added[addedIndex];

				if(addedLine !== undefined){
					result.push({
						kind:"added",
						text:addedLine,
						originalText:null,
						editedText:addedLine
					});
				}
			}
		}

		return result;
	}

	static createLineDiff(
		originalText:string,
		editedText:string
	):OfficeLawLineChange[]{
		const originalLines=originalText.split("\n");
		const editedLines=editedText.split("\n");
		const tableSize=originalLines.length*editedLines.length;

		if(250000<tableSize){
			return[
				...originalLines.map(
					(text)=>({kind:"removed" as const,text})
				),
				...editedLines.map(
					(text)=>({kind:"added" as const,text})
				)
			];
		}

		const rows=originalLines.length+1;
		const columns=editedLines.length+1;
		const table:Array<Uint32Array>=[];

		for(let row=0;row<rows;row++){
			table.push(new Uint32Array(columns));
		}

		for(let originalIndex=originalLines.length-1;
			0<=originalIndex;
			originalIndex--){
			const row=table[originalIndex];
			const nextRow=table[originalIndex+1];

			if(row === undefined || nextRow === undefined){
				throw new Error("Unable to calculate the text difference.");
			}

			for(let editedIndex=editedLines.length-1;
				0<=editedIndex;
				editedIndex--){
				if(originalLines[originalIndex] === editedLines[editedIndex]){
					row[editedIndex]=1+(nextRow[editedIndex+1] ?? 0);
				}
				else{
					row[editedIndex]=Math.max(
						nextRow[editedIndex] ?? 0,
						row[editedIndex+1] ?? 0
					);
				}
			}
		}

		const diff:OfficeLawLineChange[]=[];
		let originalIndex=0;
		let editedIndex=0;

		while(
			originalIndex<originalLines.length
			|| editedIndex<editedLines.length
		){
			const originalLine=originalLines[originalIndex];
			const editedLine=editedLines[editedIndex];

			if(
				originalLine !== undefined
				&& editedLine !== undefined
				&& originalLine === editedLine
			){
				diff.push({kind:"unchanged",text:originalLine});
				originalIndex++;
				editedIndex++;
				continue;
			}

			const row=table[originalIndex];
			const nextRow=table[originalIndex+1];
			const canRemove=originalLine !== undefined
				&& (
					editedLine === undefined
					|| (
						nextRow !== undefined
						&& row !== undefined
						&& (nextRow[editedIndex] ?? 0)
							>= (row[editedIndex+1] ?? 0)
					)
				);

			if(canRemove && originalLine !== undefined){
				diff.push({kind:"removed",text:originalLine});
				originalIndex++;
			}
			else if(editedLine !== undefined){
				diff.push({kind:"added",text:editedLine});
				editedIndex++;
			}
		}

		return diff;
	}
};
