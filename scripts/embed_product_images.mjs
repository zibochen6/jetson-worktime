/** Re-embed optimized product assets without adding runtime asset routes. */
import {readFile,writeFile} from 'node:fs/promises';
const page=new URL('../frontend/public/index.html',import.meta.url);
let html=await readFile(page,'utf8');
for(const angle of ['horizontal','vertical']) {
 const bytes=await readFile(new URL('../frontend/assets/product-'+angle+'.webp',import.meta.url));
 if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw new Error('Expected WebP asset: '+angle);
 const pattern=new RegExp('(<img\\b[^>]*data-product-image="'+angle+'"[^>]*src=")[^"]*(")');
 if(!pattern.test(html))throw new Error('Product image slot missing: '+angle);
 html=html.replace(pattern,(_,prefix,suffix)=>prefix+'data:image/webp;base64,'+bytes.toString('base64')+suffix);
}
await writeFile(page,html);
console.log('Embedded horizontal and vertical product assets');
