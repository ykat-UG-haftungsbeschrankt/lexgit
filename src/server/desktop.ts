import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { createOfficeLawApi } from "./api";

export async function startDesktopServer(repository:string,assets:string){
	const token=randomBytes(32).toString("hex");
	let origin="";
	let api:ReturnType<typeof createOfficeLawApi>;
	const server=createServer((request,response)=>{
		if(request.headers.host !== new URL(origin).host){
			response.writeHead(403).end("Invalid host.");
			return;
		}
		response.setHeader("Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'");
		response.setHeader("X-Content-Type-Options","nosniff");
		api.middleware(request,response,()=>{
			void (async()=>{
				if(request.method !== "GET" && request.method !== "HEAD"){
					response.writeHead(405).end("Method not allowed.");
					return;
				}
				const pathname=decodeURIComponent(new URL(request.url ?? "/",origin).pathname);
				const root=resolve(assets);
				const file=resolve(root,pathname === "/" ? "index.html" : `.${pathname}`);
				if(!file.startsWith(root+sep)){
					response.writeHead(403).end("Invalid asset path.");
					return;
				}
				let info;
				try{ info=await stat(file); }
				catch(error){
					if(error instanceof Error && "code" in error && error.code === "ENOENT"){
						response.writeHead(404).end("Not found.");
						return;
					}
					throw error;
				}
				if(!info.isFile()){ response.writeHead(404).end("Not found."); return; }
				const types:Record<string,string>={
					".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
					".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".woff2":"font/woff2"
				};
				response.setHeader("Content-Type",types[extname(file)] ?? "application/octet-stream");
				response.setHeader("Cache-Control","no-store");
				if(request.method === "HEAD"){ response.end(); return; }
				const stream=createReadStream(file);
				stream.on("error",error=>response.destroy(error));
				stream.pipe(response);
			})().catch(error=>{
				if(response.headersSent){ response.destroy(error instanceof Error ? error : undefined); }
				else{ response.writeHead(500).end(error instanceof Error ? error.message : "Asset failure."); }
			});
		});
	});
	await new Promise<void>((accept,reject)=>{
		server.once("error",reject);
		server.listen(0,"127.0.0.1",accept);
	});
	const address=server.address();
	if(address === null || typeof address === "string"){ throw new Error("Desktop server address unavailable."); }
	origin=`http://127.0.0.1:${address.port}`;
	api=createOfficeLawApi(repository,{origin,token});
	return {
		origin,token,
		close:()=>new Promise<void>((accept,reject)=>{
			server.close(error=>error ? reject(error) : accept());
			server.closeAllConnections();
		})
	};
}
