import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const player = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
test('PostgreSQL migration, conflict detection, RLS, membership, token rotation and cleanup', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),unique(bucket_id,name));
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
      grant usage on schema storage to authenticated,anon,service_role;
      grant select,insert,delete on storage.objects to authenticated;
      -- pgcrypto is not bundled in this local WASM fixture. Only random byte generation is substituted.
      create function public.gen_random_bytes(integer) returns bytea language sql as $$ select substring(decode(md5(gen_random_uuid()::text),'hex') from 1 for $1) $$;
      insert into auth.users values ('${owner}'),('${player}'),('${outsider}');
    `);
    const base = (await readFile('supabase/schema.sql','utf8')).replace('create extension if not exists pgcrypto;','');
    await db.exec(base);
    const migration = await readFile('supabase/migrations/202610170001_reliability.sql','utf8');
    await db.exec(migration);
    await db.exec(migration); // Safe repeat, including constraints and privileges.
    async function as(user, fn, role = 'authenticated') {
      await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);`);
      try { return await fn(); } finally { await db.exec('reset role'); }
    }
    const q = async (sql, params = []) => (await db.query(sql,params)).rows;
    const [campaign] = await as(owner, () => q("select public.create_campaign('Mesa') as id"));
    const cid = campaign.id;
    const [ca] = await as(owner, () => q('select * from public.campaigns where id=$1',[cid]));
    await as(player, () => q('select public.join_campaign($1)',[ca.invite_code]));
    const [ch] = await as(player, () => q('insert into public.characters(campaign_id,owner_id) values($1,$2) returning *',[cid,player]));
    const save = (user, patch, expected) => as(user, () => q('select * from public.save_character($1,$2,$3)',[ch.id,JSON.stringify(patch),JSON.stringify(expected)]));

    await t.test('merge unrelated edits, reject conflicts without changing data', async () => {
      await save(owner,{hp:40},{hp:100});
      const [result] = await save(player,{notes:'new notes'},{notes:''});
      assert.equal(result.hp,40);
      await assert.rejects(save(player,{hp:20},{hp:100}),/CONFLITO/);
      assert.equal((await as(player,()=>q('select hp from public.characters where id=$1',[ch.id])))[0].hp,40);
      await assert.rejects(save(player,{hp:-1},{hp:40}),/constraint/);
      await assert.rejects(save(player,{active_slot:'Invalid'},{active_slot:'Normal'}),/constraint/);
    });
    await t.test('nonowners and outsiders cannot mutate other records', async () => {
      await assert.rejects(save(outsider,{notes:'stolen'},{notes:'new notes'}),/não encontrado|permissão/);
      await assert.rejects(as(player,()=>q('select * from public.save_campaign($1,$2,$3)',[cid,'{"grad1":"#000000"}','{"grad1":"#f064a5"}'])),/não encontrada|permissão/);
      await assert.rejects(as(player,()=>q('update public.characters set overlay_token=gen_random_uuid() where id=$1',[ch.id])),/permission denied/);
      await assert.rejects(as(outsider,()=>q('select public.rotate_overlay($1)',[ch.id])),/Sem permissão/);
      await assert.rejects(as('',()=>q('select public.save_character($1,$2,$3)',[ch.id,'{}','{}']),'anon'),/permission denied/);
      await assert.rejects(as(player,()=>q('select * from public.claim_portrait_cleanup(10)')),/permission denied/);
      const [masterCh] = await as(owner,()=>q('insert into public.characters(campaign_id,owner_id) values($1,$2) returning id',[cid,owner]));
      await assert.rejects(as(player,()=>q('select * from public.save_character($1,$2,$3)',[masterCh.id,'{"notes":"other"}','{"notes":""}'])),/não encontrado|permissão/);
      await assert.rejects(as(owner,()=>q('select * from public.save_campaign($1,$2,$3)',[cid,'{"fits":{"Pixel Art":{"x":90,"y":0,"w":80,"h":10}}}','{"fits":{}}'])),/constraint/);
    });
    const path = `${player}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`;
    const url = `https://project.supabase.co/storage/v1/object/public/portraits/${path}`;
    await q("insert into storage.objects(bucket_id,name) values('portraits',$1)",[path]);
    await t.test('upload retains other slots and cannot attach someone else file', async () => {
      await as(player,()=>q('select public.replace_portrait($1,$2,$3)',[ch.id,'Normal',url]));
      await as(player,()=>q('select public.replace_portrait($1,$2,$3)',[ch.id,'Combate',url]));
      const [row] = await as(player,()=>q('select images from public.characters where id=$1',[ch.id]));
      assert.equal(row.images.Normal,url); assert.equal(row.images.Combate,url);
      await assert.rejects(as(owner,()=>q('select public.replace_portrait($1,$2,$3)',[ch.id,'Normal',url])),/Imagem inválida/);
    });
    await t.test('rotation revokes anonymous old overlay link', async () => {
      await as(player,()=>q('select public.rotate_overlay($1)',[ch.id]));
      assert.equal((await as('',()=>q('select public.get_overlay($1) as data',[ch.overlay_token]),'anon'))[0].data,null);
    });
    await t.test('member removal transfers records, revokes access, tokens and invitation', async () => {
      const [before] = await q('select overlay_token from public.characters where id=$1',[ch.id]);
      await as(owner,()=>q('select public.remove_campaign_member($1,$2)',[cid,player]));
      const [after] = await q('select * from public.characters where id=$1',[ch.id]);
      assert.equal(after.owner_id,owner); assert.notEqual(after.overlay_token,before.overlay_token);
      assert.deepEqual(await as(player,()=>q('select * from public.characters where id=$1',[ch.id])),[]);
      assert.deepEqual(await as(player,()=>q('delete from public.characters where id=$1 returning id',[ch.id])),[]);
      await assert.rejects(as(player,()=>q('select public.join_campaign($1)',[ca.invite_code])),/inválido/);
    });
    await t.test('cleanup queues deleted portraits and ignores referenced objects', async () => {
      await q('insert into public.portrait_gc(object_name) values($1)',[path]);
      assert.deepEqual(await as('',()=>q('select * from public.claim_portrait_cleanup(100)'),'service_role'),[]);
      await as(owner,()=>q('delete from public.characters where id=$1',[ch.id]));
      const rows = await as('',()=>q('select * from public.claim_portrait_cleanup(100)'),'service_role');
      assert.deepEqual(rows,[{object_name:path}]);
      const [other] = await as(owner,()=>q('insert into public.characters(campaign_id,owner_id) values($1,$2) returning id',[cid,owner]));
      // Claimed file cannot be attached even when the uploader is a member again.
      const [newCa] = await q('select invite_code from public.campaigns where id=$1',[cid]);
      await as(player,()=>q('select public.join_campaign($1)',[newCa.invite_code]));
      const [own] = await as(player,()=>q('insert into public.characters(campaign_id,owner_id) values($1,$2) returning id',[cid,player]));
      await assert.rejects(as(player,()=>q('select public.replace_portrait($1,$2,$3)',[own.id,'Normal',url])),/limpeza/);
      assert.ok(other.id);
    });
    await t.test('orphan recovery respects grace period and unrelated storage paths', async () => {
      const oldPath = `${owner}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`;
      const recentPath = `${owner}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png`;
      await q("insert into storage.objects(bucket_id,name,created_at) values('portraits',$1,now()-interval '25 hours'),('portraits',$2,now()),('portraits','manual-file.png',now()-interval '25 hours')",[oldPath,recentPath]);
      const jobs = await as('',()=>q('select * from public.claim_portrait_cleanup(100)'),'service_role');
      assert.deepEqual(jobs,[{object_name:oldPath}]);
    });
    await t.test('player may leave but cannot remove others; owner cannot leave', async () => {
      await assert.rejects(as(player,()=>q('select public.remove_campaign_member($1,$2)',[cid,outsider])),/Sem permissão/);
      await assert.rejects(as(owner,()=>q('select public.leave_campaign($1)',[cid])),/mestre não pode/);
      await as(player,()=>q('select public.leave_campaign($1)',[cid]));
      assert.deepEqual(await as(player,()=>q('select * from public.campaigns')),[]);
    });
  } finally { await db.close(); }
});
