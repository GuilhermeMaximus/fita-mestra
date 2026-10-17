// Local demonstration of the real interface. No Supabase connection or credentials.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { build } from 'esbuild';

const root = resolve('dist');
const demoEntry = String.raw`
import { createApp } from './src/app.js';
const uid='demo-master';
const campaigns=[{id:'mesa',title:'Ecos de Aether',owner_id:uid,invite_code:'AETHER2026',bar:'Pixel Art',grad1:'#f064a5',grad2:'#8c72ff',fits:{},version:1}];
const base={campaign_id:'mesa',owner_id:uid,images:{},active_slot:'Normal',font:'Georgia',name_color:'#ffffff',name_size:25,show_hp:true,version:1};
let characters=[
 {...base,id:'lyra',overlay_token:'11111111-1111-4111-8111-111111111111',name:'Lyra Valen',hp:32,max_hp:45,notes:'Patrulheira das fronteiras.\n\nInventário\nArco longo, mapa das ruínas e uma bússola que aponta para o portal.'},
 {...base,id:'dorian',overlay_token:'22222222-2222-4222-8222-222222222222',name:'Dorian Ash',hp:18,max_hp:60,notes:'O escudo da companhia.'},
 {...base,id:'mira',overlay_token:'33333333-3333-4333-8333-333333333333',name:'Mira Sol',hp:28,max_hp:28,notes:'Aprendiz dos arquivos celestes.'}
];
const clone=value=>structuredClone(value);
const api={
 campaigns:async()=>clone(campaigns), characters:async id=>clone(characters.filter(c=>c.campaign_id===id)),members:async()=>[{user_id:'demo-player',label:'Dorian Ash'}],
 saveCharacter:async(id,{patch})=>{const c=characters.find(c=>c.id===id);Object.assign(c,patch,{version:c.version+1});return clone(c)},
 saveCampaign:async(id,{patch})=>{const c=campaigns.find(c=>c.id===id);Object.assign(c,patch,{version:c.version+1});return clone(c)},
 createCharacter:async(cid)=>{const c={...clone(base),id:crypto.randomUUID(),campaign_id:cid,overlay_token:crypto.randomUUID(),name:'Novo personagem',hp:100,max_hp:100,notes:''};characters.push(c);return clone(c)},
 deleteCharacter:async(id)=>{characters=characters.filter(c=>c.id!==id);return{id}},
 uploadPortrait:async({characterId,slot,file})=>{const c=characters.find(c=>c.id===characterId);c.images[slot]=URL.createObjectURL(file);c.version++;return clone(c)},
 rpc:async(name,args)=>{
  if(name==='create_campaign'){const id=crypto.randomUUID();campaigns.unshift({...clone(campaigns[0]),id,title:args.campaign_title});return id}
  if(name==='join_campaign')return 'mesa';
  if(name==='rotate_overlay'){const c=characters.find(c=>c.id===args.target_id);c.overlay_token=crypto.randomUUID();return clone(c)}
  if(name==='rotate_invite'){const c=campaigns.find(c=>c.id===args.cid);c.invite_code='NOVOCONVITE';return clone(c)}
  return null;
 }
};
let listener;
const session={user:{id:uid,email:'mestre@exemplo.com'}};
const db={auth:{onAuthStateChange:fn=>{listener=fn;return{data:{subscription:{unsubscribe(){}}}}},getSession:async()=>({data:{session}}),signOut:async()=>{listener('SIGNED_OUT',null);return{data:{}}},signInWithPassword:async()=>{listener('SIGNED_IN',session);return{data:{session}}},signUp:async()=>({data:{session:null}}),resetPasswordForEmail:async()=>({data:{}}),updateUser:async()=>({data:{}})}};
const app=createApp({db,api,doc:document,win:window});app.start();
document.title='Fita Metra · demonstração local';
const notice=document.createElement('div');notice.className='demo-notice';notice.textContent='Demonstração local · alterações não são enviadas ao Supabase';document.body.prepend(notice);
`;
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/preview-entry.js') {
      const result = await build({ stdin: { contents: demoEntry, resolveDir: process.cwd(), sourcefile: 'demo.js' }, bundle: true, format: 'esm', write: false, target: 'es2022' });
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(result.outputFiles[0].contents); return;
    }
    const filename = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + sep)) throw Error('Invalid path');
    let body = await readFile(filename);
    if (pathname === '/' || pathname === '/index.html') body = body.toString().replace('src="app.js"', 'src="preview-entry.js"');
    res.writeHead(200, { 'Content-Type': ({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store' }); res.end(body);
  } catch (e) { res.writeHead(500); res.end(e.message); }
});
server.listen(4174,'127.0.0.1',()=>console.log('Demonstração local: http://127.0.0.1:4174'));
