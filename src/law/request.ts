export class OfficeRequestLifecycle{
	protected _controller:AbortController|null;
	protected _disposed:boolean;

	constructor(){
		this._controller=null;
		this._disposed=false;
	}

	public start():AbortController{
		if(this._disposed){
			throw new Error("A disposed request lifecycle cannot be reused.");
		}
		this.cancel();
		const controller=new AbortController();
		this._controller=controller;
		return controller;
	}

	public activate():void{
		// React StrictMode can remount an existing component after cleanup.
		this._disposed=false;
	}

	public isCurrent(controller:AbortController):boolean{
		return !this._disposed && !controller.signal.aborted
			&& this._controller === controller;
	}

	public isRunning():boolean{
		return null !== this._controller;
	}

	public isDisposed():boolean{
		return this._disposed;
	}

	public finish(controller:AbortController):boolean{
		if(!this.isCurrent(controller)){
			return false;
		}
		this._controller=null;
		return true;
	}

	public cancel():void{
		this._controller?.abort();
		this._controller=null;
	}

	public destructor():void{
		try{
			this._disposed=true;
			this.cancel();
		}
		catch(UNUSED_e){}
	}
};
