// The packager must treat .asar files as archives, not Electron virtual folders.
process.noAsar=true;
const { build }=require("electron-builder");

const args=process.argv.slice(2);
if(args.some(argument=>argument !== "--dir")){
	throw new Error("Only --dir is supported. Build installers on the target platform.");
}
build({dir:args.includes("--dir"),publish:"never"}).catch(error=>{
	console.error(error);
	process.exitCode=1;
});
