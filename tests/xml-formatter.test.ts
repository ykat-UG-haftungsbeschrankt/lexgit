import assert from "node:assert/strict";
import { test } from "node:test";
import { OfficeLawXml } from "../src/law/xml";
import { OfficeLawStorage } from "../src/law/storage";

const SOURCE='<norm doknr="TEST"><metadaten><enbez>1</enbez>'
	+'<titel>Original</titel></metadaten><textdaten><text>'
	+'<Content><P>a<B>b</B>c &amp; d</P></Content>'
	+'</text></textdaten></norm>';

test("lowercases names, sorts attributes and indents structural tags",()=>{
	const result=OfficeLawXml.format(
		'<NORM Z="last" DOKNR="TEST" A="first">'
		+'<METADATEN/><TEXTDATEN><TEXT><Content>'
		+'<P>Text</P></Content></TEXT></TEXTDATEN></NORM>'
	);
	assert.equal(result,[
		'<norm a="first" doknr="TEST" z="last">',
		'\t<metadaten>',
		'\t</metadaten>',
		'\t<textdaten>',
		'\t\t<text>',
		'\t\t\t<content>',
		'\t\t\t\t<p>Text</p>',
		'\t\t\t</content>',
		'\t\t</text>',
		'\t</textdaten>',
		'</norm>',
		''
	].join("\n"));
	assert.equal(OfficeLawXml.format(result),result);
	assert.equal(OfficeLawXml.parse(result).documentNumber,"TEST");
});

test("preserves mixed text, whitespace, CDATA, comments and PRE",()=>{
	const source='<norm><P>a<B>b</B>c <BR/> tail</P>'
		+'<PRE>  first\n second <B>x</B> </PRE>'
		+'<custom xml:space="preserve"> <Inner/> \n</custom>'
		+'<empty> </empty><!--keep--><?keep value?>'
		+'<data><![CDATA[a < b\n  c]]></data></norm>';
	const result=OfficeLawXml.format(source);
	for(const fragment of [
		'<p>a<b>b</b>c <br></br> tail</p>',
		'<pre>  first\n second <b>x</b> </pre>',
		'<custom xml:space="preserve"> <inner></inner> \n</custom>',
		'<empty> </empty>','<!--keep-->','<?keep value?>',
		'<![CDATA[a < b\n  c]]>'
	]){
		assert(result.includes(fragment),fragment);
	}
	assert.equal(OfficeLawXml.format(result),result);
});

test("rejects invalid XML and attributes with case collisions",()=>{
	for(const source of [
		'<norm><P></norm>',
		'<norm A="one" a="two"/>',
		'<!DOCTYPE norm [<!ENTITY x "bad">]><norm/>'
	]){
		assert.throws(()=>{
			OfficeLawXml.format(source);
		});
	}
});

test("puts nested paragraphs and entries on their own lines",()=>{
	const source='<norm><P>Intro<DL><DT>1.</DT>'
		+'<DD><LA>Body <B>bold</B></LA></DD></DL>Tail</P></norm>';
	const result=OfficeLawXml.format(source);
	assert.equal(result,[
		'<norm>',
		'\t<p>Intro',
		'\t\t<dl>',
		'\t\t\t<dt>1.</dt>',
		'\t\t\t<dd><la>Body <b>bold</b></la></dd>',
		'\t\t</dl>',
		'\tTail</p>',
		'</norm>',''
	].join("\n"));
	assert.equal(OfficeLawXml.format(result),result);
	const preserved=OfficeLawXml.format(
		'<norm><P xml:space="preserve">Intro<DL><DT>1.</DT>'
		+'<DD>Body</DD></DL>Tail</P></norm>'
	);
	assert(preserved.includes(
		'<p xml:space="preserve">Intro<dl><dt>1.</dt>'
		+'<dd>Body</dd></dl>Tail</p>'
	));
	assert.equal(OfficeLawXml.format(preserved),preserved);
});

test("keeps XHTML opening tags intact when attributes contain >",()=>{
	const source='<div xmlns="http://www.w3.org/1999/xhtml"'
		+' title="a > b"><section title="c > d"/></div>';
	const result=OfficeLawXml.format(source);
	const root=OfficeLawXml.parseDocument(result).documentElement!;
	assert.equal(root.getAttribute("title"),"a > b");
	assert.equal(
		OfficeLawXml.children(root,"section")[0]?.getAttribute("title"),
		"c > d"
	);
	assert.equal(OfficeLawXml.format(result),result);
});

test("preserves namespace URIs and attribute values",()=>{
	const source='<X:Root xmlns:X="urn:CaseSensitive" X:ID="AbC">'
		+'<X:Child/></X:Root>';
	const result=OfficeLawXml.format(source);
	const root=OfficeLawXml.parseDocument(result).documentElement!;
	assert.equal(root.tagName,"x:root");
	assert.equal(root.namespaceURI,"urn:CaseSensitive");
	assert.equal(root.getAttributeNS("urn:CaseSensitive","id"),"AbC");
	assert.equal(OfficeLawXml.format(result),result);
	const html=OfficeLawXml.format(
		'<div xmlns="http://www.w3.org/1999/xhtml"><section/></div>'
	);
	assert.equal(
		OfficeLawXml.parseDocument(html).documentElement!.namespaceURI,
		"http://www.w3.org/1999/xhtml"
	);
	assert.equal(OfficeLawXml.format(html),html);
});

test("a title edit only changes its own line after normalization",()=>{
	const formatted=OfficeLawXml.format(SOURCE);
	const norm=OfficeLawXml.parse(formatted);
	assert.deepEqual(norm.paragraphs,["abc & d"]);
	const updated=OfficeLawXml.write({...norm,title:"Edited"},formatted);
	assert.equal(
		updated,formatted.replace(
			"<titel>Original</titel>","<titel>Edited</titel>"
		)
	);
	assert.equal(OfficeLawXml.write(norm,formatted),formatted);
	assert.equal(
		OfficeLawStorage.editOfficeLawNormText(
			formatted,norm.paragraphs.join("\n\n")
		),formatted
	);
});
