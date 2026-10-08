import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

let env;
const projectId='demo-storage-test';
const image=new Uint8Array([137,80,78,71,13,10,26,10]);
const upload=(storage,path,size=image.length,contentType='image/png')=>uploadBytes(ref(storage,path),new Uint8Array(size),{contentType});
const read=(storage,path)=>getBytes(ref(storage,path));
const raw='members/t-test/private.png';
beforeAll(async()=>{
  if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw Error('Storage 測試必須同時執行 Firestore 與 Storage Emulator');
  env=await initializeTestEnvironment({projectId,
    firestore:{host:'127.0.0.1',port:Number(process.env.FIRESTORE_EMULATOR_HOST.split(':').at(-1)),rules:fs.readFileSync('firestore.rules','utf8')},
    storage:{host:'127.0.0.1',port:Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':').at(-1)),rules:fs.readFileSync('storage.rules','utf8')}});
});
beforeEach(async()=>{
  await env.clearFirestore();await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    for(const role of ['booth','checkin','referee','scorer','staff','admin','super_admin'])await setDoc(doc(db,'staff',role),{active:true,roles:[role]});
    for(const [uid,data]of Object.entries({inactive:{active:false,roles:['admin']},missingActive:{roles:['admin']},empty:{active:true,roles:[]},invalid:{active:true,roles:['captain']},missingRoles:{active:true},wrongType:{active:true,roles:'admin'}}))await setDoc(doc(db,'staff',uid),data);
    for(const p of [raw,'members-public/t-test/public.png','teams/t-test/logo.png','sponsors/a.png','gallery/2026-10-09/a.png','exports/private.csv'])await upload(ctx.storage(),p);
  });
});
afterAll(async()=>{await env?.cleanup();});

test.each([null,'absent','inactive','missingActive','empty','invalid','missingRoles','wrongType'])('ST1 %s 不得寫入或讀取球員原圖',async uid=>{
  const s=(uid?env.authenticatedContext(uid):env.unauthenticatedContext()).storage();
  await assertFails(read(s,raw));
  for(const p of [raw,'teams/t-test/logo.png','sponsors/a.png','gallery/2026-10-09/a.png'])await assertFails(upload(s,p));
});
test.each(['booth','checkin','referee','scorer','staff','admin','super_admin'])('ST2 %s 合法角色遵循公開與原圖權限',async uid=>{
  const s=env.authenticatedContext(uid).storage();
  for(const p of ['teams/t-test/logo.png','sponsors/a.png','gallery/2026-10-09/a.png',raw])await assertSucceeds(upload(s,p));
  await (uid==='booth'?assertFails:assertSucceeds)(read(s,raw));
  await assertFails(upload(s,'members-public/t-test/public.png'));await assertFails(read(s,'exports/private.csv'));await assertFails(upload(s,'exports/private.csv'));
});
test('ST3 公開縮圖、隊徽、贊助及相簿維持訪客公開讀，原圖與匯出不公開',async()=>{
  const s=env.unauthenticatedContext().storage();
  for(const p of ['members-public/t-test/public.png','teams/t-test/logo.png','sponsors/a.png','gallery/2026-10-09/a.png'])await assertSucceeds(read(s,p));
  await assertFails(read(s,raw));await assertFails(read(s,'exports/private.csv'));await assertFails(upload(s,'unlisted/file.png'));
});
test.each([['teams/t-test/logo.png',1],[raw,1],['sponsors/a.png',2],['gallery/2026-10-09/a.png',5]])('ST4 %s 保留嚴格大小及圖片类型限制',async(path,mb)=>{
  const s=env.authenticatedContext('admin').storage();
  await assertSucceeds(upload(s,path,mb*1024*1024-1));await assertFails(upload(s,path,mb*1024*1024));
  await assertFails(upload(s,path,12,'text/plain'));
});
test('ST5 同一登入 session 的角色停用／復用立即跨 Firestore 生效',async()=>{
  const s=env.authenticatedContext('admin').storage();await assertSucceeds(read(s,raw));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'staff','admin'),{active:false}));
  await assertFails(read(s,raw));await assertFails(upload(s,'teams/t-test/logo.png'));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'staff','admin'),{active:true}));
  await assertSucceeds(read(s,raw));
});
