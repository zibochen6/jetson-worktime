// Explicit mock-only studio data. No fake training results are used by device routes.
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export const materialDefaults={enabled:false,class_id:0,confidence:.25,stable_seconds:1,missing_seconds:2,sample_hz:2,configured:false,regions:{pending:[],completed:[]},display:{pending:true,completed:true},colors:{pending:'#fbbf24',completed:'#38bdf8'},opacity:{pending:.12,completed:.12}};
const models=[{id:'builtin-person',name:'YOLO11n Pose',role:'person',task:'pose',classes:{0:'person'},builtin:true,source:'builtin',installed:true,sha256:'mock',revision:1}];
const datasets=[],images=[],snapshots=[],jobs=[],downloads=[];
const operations=new Map();
async function body(req){let value='';for await(const c of req)value+=c;if(value.length>1024*1024)return {};return value?JSON.parse(value):{};}
export async function studioMock(req,res,url,settings){
 const p=url.pathname.split('/').filter(Boolean).slice(2);if(!['models','datasets','training','materials'].includes(p[0]))return false;
 const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));return true;};
 const error=(key,status=400)=>json({error:{code:'STUDIO_ERROR',message_key:'studio.error.'+key,message:key}},status);
 if(p.join('/')==='models'&&req.method==='GET')return json({models,selection:settings.models});
 if(p.join('/')==='models'&&req.method==='POST'){for await(const _ of req){}const role=url.searchParams.get('role')||'material';const model={id:randomUUID(),name:url.searchParams.get('name'),role,task:role==='person'?'pose':'detect',classes:role==='person'?{0:'person'}:{0:'product'},builtin:false,source:'upload',revision:1,sha256:'mock'};models.push(model);return json(model);}
 if(p.join('/')==='models/downloads'){if(req.method==='GET')return json({downloads});const b=await body(req);const model={id:randomUUID(),name:b.catalog_id.replace('yolo','YOLO'),role:'material',task:'detect',classes:{0:'product'},builtin:true,source:'official',revision:1};models.push(model);const download={id:randomUUID(),catalog_id:b.catalog_id,state:'completed',bytes:1,total:1,model_id:model.id};downloads.push(download);return json(download);}
 if(p[0]==='models'&&req.method==='DELETE'){const i=models.findIndex(m=>m.id===p[1]);if(i<0)return error('notFound',404);if(models[i].builtin||Object.values(settings.models).includes(p[1]))return error('referenced',409);models.splice(i,1);return json({deleted:true});}
 if(p.join('/')==='datasets'){if(req.method==='GET')return json({datasets});const b=await body(req);if(!b.name||!b.class_name)return error('datasetInvalid');const ds={...b,id:randomUUID(),revision:1};datasets.push(ds);return json(ds);}
 if(p[0]==='datasets'){
 const ds=datasets.find(d=>d.id===p[1]);if(!ds)return error('notFound',404);
 if(p.length===2)return json({...ds,images:images.filter(i=>i.dataset_id===ds.id&&!i.deleted)});
 if(p[2]==='images'&&p.length===4&&req.method==='GET'){const jpeg=await readFile(new URL('./public/mock.jpg',import.meta.url));res.writeHead(200,{'Content-Type':'image/jpeg'});res.end(jpeg);return true;}
 if(p[2]==='images'&&p[4]==='annotations'){const b=await body(req),im=images.find(i=>i.id===p[3]);if(!im)return error('notFound',404);if(b.expected_revision!==im.revision)return error('conflict',409);Object.assign(im,{boxes:b.boxes,annotated:b.annotated,revision:im.revision+1});ds.revision++;return json(im);}
 if(p[2]==='images'&&p.length===4&&req.method==='DELETE'){const im=images.find(i=>i.id===p[3]);im.deleted=true;ds.revision++;return json({deleted:true});}
 if(['images','captures'].includes(p[2])&&req.method==='POST'){let group;if(p[2]==='captures')group=(await body(req)).group_id;else{for await(const _ of req){}group=url.searchParams.get('group');}const im={id:randomUUID(),dataset_id:ds.id,width:2560,height:1440,group_id:group,boxes:[],annotated:false,revision:1};images.push(im);ds.revision++;return json(im);}
 if(p[2]==='snapshots'){if(req.method==='GET')return json({snapshots:snapshots.filter(s=>s.dataset_id===ds.id)});const b=await body(req);if(b.expected_revision!==ds.revision)return error('conflict',409);const ims=images.filter(i=>i.dataset_id===ds.id&&!i.deleted&&i.annotated);if(new Set(ims.map(i=>i.group_id)).size<3)return error('splitGroups');if(new Set(ims.filter(i=>i.boxes.length).map(i=>i.group_id)).size<3)return error('splitPositive');const s={id:randomUUID(),dataset_id:ds.id,counts:{train:Math.max(1,ims.length-2),val:1,test:1},revision:1};snapshots.push(s);return json(s);}
 }
 if(p.join('/')==='training/jobs'){if(req.method==='GET')return json({jobs});const b=await body(req);if(operations.has(b.token))return json(operations.get(b.token));if(!snapshots.some(s=>s.id===b.snapshot_id))return error('notFound',404);const job={id:randomUUID(),state:'queued',stage:'queued',epoch:0,progress:0,parameters:{epochs:100,...b.parameters},metrics:{},revision:1};jobs.push(job);operations.set(b.token,job);return json(job);}
 if(p[0]==='training'&&p[1]==='jobs'){const job=jobs.find(j=>j.id===p[2]);if(!job)return error('notFound',404);if(p[3]==='actions'){const b=await body(req);job.state=b.action==='resume'?'queued':b.action==='cancel'?'cancelled':'paused';job.revision++;}return json(job);}
 if(p.join('/')==='materials/status')return json({enabled:settings.materials.enabled,available:settings.materials.configured,pending:settings.materials.configured?3:null,completed:settings.materials.configured?5:null,cumulative:settings.materials.enabled?5:0,reviews:[],session_id:'mock-work-session'});
 return error('notFound',404);
}
