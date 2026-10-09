import assert from "node:assert/strict";
import { test } from "node:test";
import { OfficeLawDiff } from "../src/law/diff";
import { OfficeLawXml } from "../src/law/xml";

function source(content:utf8_t,footnotes:utf8_t=""):utf8_t{
	return '<norm doknr="TEST"><metadaten><titel>Title</titel>'
		+'</metadaten><textdaten><text><Content>'+content
		+'</Content></text><fussnoten><Content>'+footnotes
		+'</Content></fussnoten></textdaten></norm>';
}

function content(xml:utf8_t,container:utf8_t="text"):utf8_t{
	const root=OfficeLawXml.parseDocument(xml).documentElement!;
	const data=OfficeLawXml.children(root,"textdaten")[0]!;
	const target=OfficeLawXml.children(data,container)[0]!;
	return OfficeLawXml.serialize(
		OfficeLawXml.children(target,"Content")[0]!
	);
}

test("marks inserted siblings without shifting unchanged elements",()=>{
	const previous=source("<P>One</P><P>Two</P>");
	const current=source("<P>New</P><P>One</P><P>Two</P>");
	const result=OfficeLawDiff.createXmlDiff(previous,current);
	assert.equal(content(result),'<Content><P diff="added">New</P>'
		+'<P>One</P><P>Two</P></Content>');
	assert.equal(current,source("<P>New</P><P>One</P><P>Two</P>"));
});

test("marks deleted siblings while preserving list structure",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source("<UL><LI>One</LI><LI>Two</LI></UL>"),
		source("<UL><LI>Two</LI></UL>")
	);
	assert.equal(content(result),'<Content><UL>'
		+'<LI diff="removed">One</LI><LI>Two</LI></UL></Content>');
});

test("aligns an insertion next to an edited sibling without IDs",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source("<P>One</P><P>Two</P>"),
		source("<P>New</P><P>One changed</P><P>Two</P>")
	);
	assert.equal(content(result),'<Content><P diff="added">New</P>'
		+'<P>One<diff diff="added"> changed</diff></P>'
		+'<P>Two</P></Content>');
});

test("diffs text within formatted mixed content",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source("<P>Before <B>old value</B> after &amp; more</P>"),
		source("<P>Before <B>new value</B> after &amp; more</P>")
	);
	assert.equal(content(result),'<Content><P>Before <B>'
		+'<diff diff="removed">old</diff><diff diff="added">new</diff>'
		+' value</B> after &amp; more</P></Content>');
});

test("represents changed attributes as removed and added elements",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source('<TABLE><TR><TD colspan="1">Cell</TD></TR></TABLE>'),
		source('<TABLE><TR><TD colspan="2">Cell</TD></TR></TABLE>')
	);
	assert.equal(content(result),'<Content><TABLE><TR>'
		+'<TD colspan="1" diff="removed">Cell</TD>'
		+'<TD colspan="2" diff="added">Cell</TD>'
		+'</TR></TABLE></Content>');
});

test("matches unchanged siblings regardless of attribute order",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source('<P a="1" b="2">One</P>'),
		source('<P b="2" a="1">One</P>')
	);
	assert(!result.includes('diff='));
});

test("preserves IDs when matching inserted and modified siblings",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source('<P id="a">One</P><P id="b">Old</P>'),
		source('<P id="new">New</P><P id="a">One</P>'
			+'<P id="b">Edited</P>')
	);
	assert.equal(content(result),'<Content>'
		+'<P id="new" diff="added">New</P><P id="a">One</P>'
		+'<P id="b"><diff diff="removed">Old</diff>'
		+'<diff diff="added">Edited</diff></P></Content>');
});

test("treats renamed tags as removed and added",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source("<P><B>Text</B></P>"),source("<P><I>Text</I></P>")
	);
	assert.equal(content(result),'<Content><P>'
		+'<B diff="removed">Text</B><I diff="added">Text</I>'
		+'</P></Content>');
});

test("supports wholly added and removed documents",()=>{
	const current=source("<P>One</P><P>Two</P>");
	assert.equal(content(OfficeLawDiff.createXmlDiff(null,current)),
		'<Content><P diff="added">One</P>'
		+'<P diff="added">Two</P></Content>');
	assert.equal(content(OfficeLawDiff.createXmlDiff(current,null)),
		'<Content><P diff="removed">One</P>'
		+'<P diff="removed">Two</P></Content>');
});

test("selects footnotes independently and preserves metadata",()=>{
	const previous=source("<P>Body</P>","<P>Old note</P>");
	const current=source("<P>Body</P>","<P>New note</P>");
	const result=OfficeLawDiff.createXmlDiff(
		previous,current,"fussnoten"
	);
	assert.equal(content(result),"<Content><P>Body</P></Content>");
	assert.equal(content(result,"fussnoten"),'<Content><P>'
		+'<diff diff="removed">Old</diff><diff diff="added">New</diff>'
		+' note</P></Content>');
	assert.equal(OfficeLawXml.parse(result).title,"Title");
});

test("ignores structural indentation, preserves spaces and comments",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source("\n<P>One <B>bold</B> two</P><!--keep-->\n"),
		source("<P>One <B>bold</B> two</P><!--keep-->")
	);
	assert.equal(content(result),'<Content>'
		+'<P>One <B>bold</B> two</P><!--keep--></Content>');
	assert(!result.includes('diff='));
});

test("treats CDATA and equivalent text as unchanged",()=>{
	const result=OfficeLawDiff.createXmlDiff(
		source("<P><![CDATA[a < b]]></P>"),
		source("<P>a &lt; b</P>")
	);
	assert(!result.includes('diff='));
});

test("rejects invalid sources and reserved annotations",()=>{
	for(const value of [
		"<norm>",source('<P diff="added">Text</P>'),
		source('<P><diff diff="added">Text</diff></P>')
	]){
		assert.throws(()=>{
			OfficeLawDiff.createXmlDiff(value,source("<P>Text</P>"));
		});
	}
	assert.throws(()=>{
		OfficeLawDiff.createXmlDiff(null,null);
	});
});
