import electron from "electron";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Use Electron's Node runtime so packaging also works on hosts with Node 20.
const child=spawn(electron,[fileURLToPath(new URL("./package-electron.cjs",import.meta.url)),...process.argv.slice(2)],{
	stdio:"inherit",env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}
});
child.on("error",error=>{ console.error(error); process.exitCode=1; });
child.on("exit",code=>{ process.exitCode=code ?? 1; });
