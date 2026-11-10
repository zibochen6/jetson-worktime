// Dependency-free development server. Frontend never sees RTSP or credentials.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mockReply} from './mock.mjs';
const root=path.resolve(fileURLToPath(new URL('./public/',import.meta.url)));
const mock=process.argv.includes('--mock');
const target=new URL(process.env.API_BASE_URL || 'http://192.168.2.16:8088');
if(target.protocol!=='http:' || target.username || target.password) throw new Error('API_BASE_URL must be an HTTP backend URL without credentials');
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/dev-info') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({mode:mock?'mock':'proxy'}));return;}
  if(u.pathname.startsWith('/api/') || u.pathname==='/stream.mjpg' || u.pathname.startsWith('/mock/')) {
    if(mock) {try {await mockReply(req,res,u);} catch {if(!res.headersSent)res.writeHead(500);res.end();}return;}
    if(u.pathname.startsWith('/mock/')) {res.writeHead(404);res.end();return;}
    const upstream=http.request({hostname:target.hostname,port:target.port||80,path:req.url,method:req.method,
      headers:{...req.headers}}, response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
      response.on('error',()=>res.destroy());
    });
    // Preserve Host and Origin together so same-origin write checks still apply.
    upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({schema_version:'1.0',error:{code:'BACKEND_UNAVAILABLE',message:'Backend unavailable'}}));}else res.destroy();});
    req.pipe(upstream);res.on('close',()=>upstream.destroy());return;
  }
  try {
    const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname==='/settings'?'/settings.html':u.pathname));
    if(!file.startsWith(root+path.sep))throw new Error('outside root');
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.json':'application/json; charset=utf-8'})[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||5173),'127.0.0.1',()=>console.log(`Frontend ${mock?'MOCK':'proxy'}: http://127.0.0.1:${server.address().port}`));
