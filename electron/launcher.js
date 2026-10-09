class RepositoryLauncher{
	constructor(){
		this.open=document.querySelector("#open");
		this.form=document.querySelector("#clone");
		this.url=document.querySelector("#url");
		this.status=document.querySelector("#status");
		this.error=document.querySelector("#error");
		this.open.addEventListener("click",()=>this.run(()=>window.officeLawDesktop.openRepository()));
		this.form.addEventListener("submit",event=>{
			event.preventDefault();
			this.run(()=>window.officeLawDesktop.cloneRepository(this.url.value));
		});
	}
	async run(operation){
		this.open.disabled=true;
		this.form.querySelector("button").disabled=true;
		this.url.disabled=true;
		this.status.textContent="Repository wird geöffnet …";
		this.error.textContent="";
		try{
			const result=await operation();
			this.status.textContent=result.cancelled ? "Auswahl abgebrochen." : "Repository geöffnet.";
		}
		catch(error){
			this.status.textContent="";
			this.error.textContent=error instanceof Error ? error.message : String(error);
		}
		finally{
			this.open.disabled=false;
			this.form.querySelector("button").disabled=false;
			this.url.disabled=false;
		}
	}
}
new RepositoryLauncher();
