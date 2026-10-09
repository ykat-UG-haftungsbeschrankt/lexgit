import assert from "node:assert/strict";
import { test } from "node:test";
import { OfficeRequestLifecycle } from "../src/law/request";

test("new requests cancel old requests and discard stale results",()=>{
	const requests=new OfficeRequestLifecycle();
	try{
		const first=requests.start();
		assert.equal(requests.isRunning(),true);
		const second=requests.start();
		assert.equal(first.signal.aborted,true);
		assert.equal(requests.isCurrent(first),false);
		assert.equal(requests.finish(first),false);
		assert.equal(requests.isCurrent(second),true);
		assert.equal(requests.finish(second),true);
		assert.equal(requests.isRunning(),false);
		assert.equal(requests.finish(second),false);
	}
	finally{
		requests.destructor();
	}
});

test("cleanup aborts pending work and is idempotent",()=>{
	const requests=new OfficeRequestLifecycle();
	const controller=requests.start();
	requests.destructor();
	requests.destructor();
	assert.equal(controller.signal.aborted,true);
	assert.equal(requests.isCurrent(controller),false);
	assert.equal(requests.isRunning(),false);
	assert.equal(requests.isDisposed(),true);
	assert.throws(()=>{
		requests.start();
	},/disposed/);
});

test("StrictMode remount allows new work but not old completions",()=>{
	const requests=new OfficeRequestLifecycle();
	try{
		const first=requests.start();
		requests.destructor();
		requests.activate();
		assert.equal(requests.isDisposed(),false);
		const second=requests.start();
		assert.equal(requests.finish(first),false);
		assert.equal(requests.isCurrent(second),true);
		requests.cancel();
		assert.equal(second.signal.aborted,true);
		assert.equal(requests.finish(second),false);
	}
	finally{
		requests.destructor();
	}
});
