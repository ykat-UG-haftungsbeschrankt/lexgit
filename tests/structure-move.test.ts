import assert from "node:assert/strict";
import { test } from "node:test";
import { OfficeLawStructure } from "../src/law/structure";
import type { OfficeLawEditableEntry } from "../src/law/structure";

function section(id:utf8_t):OfficeLawEditableEntry{
	return{
		documentNumber:id,kind:"section",identifier:null,title:null,
		hierarchy:{number:"010",label:id,title:null},
		parentId:null,path:`${id}/index.xml`
	};
}

function provision(id:utf8_t,parentId:utf8_t):OfficeLawEditableEntry{
	return{
		documentNumber:id,kind:"norm",identifier:id,title:null,
		hierarchy:null,parentId,path:`${parentId}/${id}.xml`
	};
}

test("moving a section keeps destination provisions in their parent",()=>{
	const entries=[
		section("SOURCE"),provision("A","SOURCE"),
		section("DESTINATION"),provision("B","DESTINATION"),
		provision("C","DESTINATION")
	];
	const moved=OfficeLawStructure.moveOfficeLawEntry(
		entries,"SOURCE","DESTINATION"
	);
	const paths=new Map(moved.map((entry)=>{
		return[entry.documentNumber,entry.path];
	}));
	assert.equal(paths.get("SOURCE"),"DESTINATION/SOURCE/index.xml");
	assert.equal(paths.get("A"),"DESTINATION/SOURCE/A.xml");
	assert.equal(paths.get("B"),"DESTINATION/B.xml");
	assert.equal(paths.get("C"),"DESTINATION/C.xml");
	const restored=OfficeLawStructure.moveOfficeLawEntry(
		moved,"SOURCE",null
	);
	assert.equal(restored.find((entry)=>{
		return "A" === entry.documentNumber;
	})?.path,"SOURCE/A.xml");
});
