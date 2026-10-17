-- Upgrade from the original Fita Mestra schema. Apply once before publishing v2.
-- All changes are atomic. Existing invalid data causes an explicit rollback.
begin;

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
revoke all on public.schema_migrations from public, anon, authenticated;

alter table public.campaigns add column if not exists fits jsonb not null default '{}'::jsonb;
alter table public.characters add column if not exists images jsonb not null default '{}'::jsonb;
alter table public.characters add column if not exists active_slot text not null default 'Normal';
alter table public.characters add column if not exists updated_at timestamptz not null default now();
alter table public.characters add column if not exists version bigint not null default 1;
alter table public.campaigns add column if not exists version bigint not null default 1;

create or replace function public.touch_character()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at=clock_timestamp(); new.version=old.version+1; return new; end $$;
create or replace function public.touch_campaign()
returns trigger language plpgsql set search_path = '' as $$
begin new.version=old.version+1; return new; end $$;
drop trigger if exists touch_campaign_trigger on public.campaigns;
create trigger touch_campaign_trigger before update on public.campaigns
for each row execute function public.touch_campaign();

create or replace function public.valid_fits(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item record; k text; n numeric;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  for item in select * from jsonb_each(value) loop
    if item.key not in ('Gótico','Pixel Art','Arco-íris','Steampunk','Dark','Floresta','Céu')
       or jsonb_typeof(item.value) <> 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(item.value)) <> 4 then return false; end if;
    foreach k in array array['x','y','w','h'] loop
      if not (item.value ? k) or jsonb_typeof(item.value->k) <> 'number' then return false; end if;
      n := (item.value->>k)::numeric;
      if n < (case when k in ('w','h') then 1 else 0 end) or n > 100 then return false; end if;
    end loop;
    if (item.value->>'x')::numeric + (item.value->>'w')::numeric > 100
       or (item.value->>'y')::numeric + (item.value->>'h')::numeric > 100 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.valid_images(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item record;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  for item in select * from jsonb_each(value) loop
    if item.key not in ('Normal','Combate','Machucado','Inconsciente') or jsonb_typeof(item.value) <> 'string'
       or length(item.value #>> '{}') > 2048 or (item.value #>> '{}') !~ '^https://' then return false; end if;
  end loop;
  return true;
end $$;

alter table public.campaigns drop constraint if exists campaign_appearance_valid;
alter table public.campaigns add constraint campaign_appearance_valid check (
  bar in ('Gótico','Pixel Art','Arco-íris','Steampunk','Dark','Floresta','Céu')
  and grad1 ~ '^#[0-9A-Fa-f]{6}$' and grad2 ~ '^#[0-9A-Fa-f]{6}$' and public.valid_fits(fits)
);
alter table public.characters drop constraint if exists character_fields_valid;
alter table public.characters add constraint character_fields_valid check (
  length(btrim(name)) between 1 and 120 and length(notes) <= 50000
  and max_hp between 1 and 1000000 and hp between 0 and max_hp
  and active_slot in ('Normal','Combate','Machucado','Inconsciente')
  and name_color ~ '^#[0-9A-Fa-f]{6}$' and name_size between 12 and 60
  and length(btrim(font)) between 1 and 80 and public.valid_images(images)
);

-- Restrict writes to supported columns. Sensitive changes use authorized RPCs.
revoke insert, update on public.characters from authenticated;
grant insert (campaign_id, owner_id) on public.characters to authenticated;
grant update (name, notes, hp, max_hp, active_slot, font, name_color, name_size, show_hp) on public.characters to authenticated;
revoke insert, update on public.campaigns from authenticated;
grant insert (title, owner_id) on public.campaigns to authenticated;
grant update (bar, grad1, grad2, fits) on public.campaigns to authenticated;

create or replace function public.lock_character_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.campaign_id <> old.campaign_id then raise exception 'Identidade do personagem não pode ser alterada'; end if;
  if current_user in ('anon','authenticated') and (new.owner_id <> old.owner_id or new.overlay_token <> old.overlay_token or new.images <> old.images) then
    raise exception 'Use a operação autorizada para alterar identidade ou imagens';
  end if;
  return new;
end $$;
create or replace function public.lock_campaign_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id then raise exception 'Identidade da campanha não pode ser alterada'; end if;
  if current_user in ('anon','authenticated') and new.invite_code <> old.invite_code then raise exception 'Use a operação de renovar convite'; end if;
  return new;
end $$;

drop policy if exists "character update" on public.characters;
create policy "character update" on public.characters for update to authenticated
using (public.is_campaign_member(campaign_id, auth.uid()) and (owner_id=auth.uid() or public.is_campaign_owner(campaign_id, auth.uid())))
with check (public.is_campaign_member(campaign_id, auth.uid()) and (owner_id=auth.uid() or public.is_campaign_owner(campaign_id, auth.uid())));
drop policy if exists "character delete" on public.characters;
create policy "character delete" on public.characters for delete to authenticated
using (public.is_campaign_member(campaign_id, auth.uid()) and (owner_id=auth.uid() or public.is_campaign_owner(campaign_id, auth.uid())));

-- Lock the row and compare only edited fields, so unrelated edits can merge.
create or replace function public.save_character(target_id uuid, patch jsonb, expected jsonb)
returns public.characters language plpgsql security invoker set search_path = '' as $$
declare old_row public.characters; new_row public.characters; k text;
begin
  if jsonb_typeof(patch) is distinct from 'object' or jsonb_typeof(expected) is distinct from 'object' then raise exception 'Alterações inválidas'; end if;
  select * into old_row from public.characters where id=target_id for update;
  if not found then raise exception 'Personagem não encontrado ou sem permissão'; end if;
  for k in select jsonb_object_keys(patch) loop
    if k not in ('name','notes','hp','max_hp','active_slot','font','name_color','name_size','show_hp') then raise exception 'Campo não permitido'; end if;
    if not (expected ? k) or (to_jsonb(old_row)->k) is distinct from (expected->k) then raise exception 'CONFLITO: %', k; end if;
  end loop;
  new_row := jsonb_populate_record(old_row, patch);
  update public.characters set name=new_row.name, notes=new_row.notes, hp=new_row.hp, max_hp=new_row.max_hp,
    active_slot=new_row.active_slot, font=new_row.font, name_color=new_row.name_color,
    name_size=new_row.name_size, show_hp=new_row.show_hp where id=target_id returning * into new_row;
  if not found then raise exception 'Personagem não encontrado ou sem permissão'; end if;
  return new_row;
end $$;

create or replace function public.save_campaign(target_id uuid, patch jsonb, expected jsonb)
returns public.campaigns language plpgsql security invoker set search_path = '' as $$
declare old_row public.campaigns; new_row public.campaigns; k text;
begin
  if jsonb_typeof(patch) is distinct from 'object' or jsonb_typeof(expected) is distinct from 'object' then raise exception 'Alterações inválidas'; end if;
  select * into old_row from public.campaigns where id=target_id for update;
  if not found then raise exception 'Campanha não encontrada ou sem permissão'; end if;
  for k in select jsonb_object_keys(patch) loop
    if k not in ('bar','grad1','grad2','fits') then raise exception 'Campo não permitido'; end if;
    if not (expected ? k) or (to_jsonb(old_row)->k) is distinct from (expected->k) then raise exception 'CONFLITO: %', k; end if;
  end loop;
  new_row := jsonb_populate_record(old_row, patch);
  update public.campaigns set bar=new_row.bar, grad1=new_row.grad1, grad2=new_row.grad2, fits=new_row.fits
    where id=target_id returning * into new_row;
  if not found then raise exception 'Campanha não encontrada ou sem permissão'; end if;
  return new_row;
end $$;

create or replace function public.replace_portrait(target_id uuid, slot_name text, image_url text)
returns public.characters language plpgsql security definer set search_path = '' as $$
declare ch public.characters; path text;
begin
  select * into ch from public.characters where id=target_id for update;
  if not found or auth.uid() is null or not public.is_campaign_member(ch.campaign_id, auth.uid())
    or not (ch.owner_id=auth.uid() or public.is_campaign_owner(ch.campaign_id, auth.uid())) then raise exception 'Personagem não encontrado ou sem permissão'; end if;
  if slot_name is null or slot_name not in ('Normal','Combate','Machucado','Inconsciente') then raise exception 'Variação inválida'; end if;
  path := substring(image_url from '^https://[^/]+/storage/v1/object/public/portraits/([0-9a-f-]+/[0-9a-f-]+\.(png|jpg|webp))$');
  if path is null or split_part(path,'/',1) <> auth.uid()::text then raise exception 'Imagem inválida'; end if;
  -- Row lock coordinates with cleanup: claimed objects cannot be attached later.
  perform 1 from storage.objects where bucket_id='portraits' and name=path for update;
  if not found then raise exception 'Arquivo não encontrado'; end if;
  if exists(select 1 from public.portrait_gc where object_name=path and claimed_at is not null) then raise exception 'Arquivo em limpeza; envie novamente'; end if;
  delete from public.portrait_gc where object_name=path;
  update public.characters set images=jsonb_set(images,array[slot_name],to_jsonb(image_url),true)
    where id=target_id returning * into ch;
  return ch;
end $$;

-- Keep old clients compatible, without letting them bypass authorization/validation.
create or replace function public.set_portrait_slot(character_id uuid, slot_name text, image_url text)
returns void language plpgsql security invoker set search_path = '' as $$
begin perform public.replace_portrait(character_id, slot_name, image_url); end $$;

create or replace function public.rotate_overlay(target_id uuid)
returns public.characters language plpgsql security definer set search_path = '' as $$
declare ch public.characters;
begin
  select * into ch from public.characters where id=target_id for update;
  if not found or auth.uid() is null or not public.is_campaign_member(ch.campaign_id, auth.uid())
    or not (ch.owner_id=auth.uid() or public.is_campaign_owner(ch.campaign_id, auth.uid())) then raise exception 'Sem permissão'; end if;
  update public.characters set overlay_token=gen_random_uuid() where id=target_id returning * into ch;
  return ch;
end $$;
create or replace function public.rotate_invite(cid uuid)
returns public.campaigns language plpgsql security definer set search_path = '' as $$
declare ca public.campaigns;
begin
  if auth.uid() is null or not public.is_campaign_owner(cid,auth.uid()) then raise exception 'Somente o mestre'; end if;
  update public.campaigns set invite_code=upper(replace(gen_random_uuid()::text,'-','')) where id=cid returning * into ca;
  return ca;
end $$;
create or replace function public.list_campaign_members(cid uuid)
returns table(user_id uuid,label text) language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_campaign_owner(cid,auth.uid()) then raise exception 'Somente o mestre'; end if;
  return query select m.user_id, coalesce(string_agg(distinct ch.name, ', '), 'Participante') || ' · ' || left(m.user_id::text,8)
    from public.members m left join public.characters ch on ch.campaign_id=m.campaign_id and ch.owner_id=m.user_id
    where m.campaign_id=cid group by m.user_id;
end $$;
create or replace function public.remove_campaign_member(cid uuid,target_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare master uuid;
begin
  select owner_id into master from public.campaigns where id=cid for update;
  if master is null or auth.uid() is null or (auth.uid()<>master and auth.uid()<>target_user) then raise exception 'Sem permissão'; end if;
  if target_user=master then raise exception 'O mestre não pode sair da própria campanha'; end if;
  if not exists(select 1 from public.members where campaign_id=cid and user_id=target_user) then raise exception 'Participante não encontrado'; end if;
  -- All participants could read all tokens, so revoke every overlay and the invite.
  update public.characters set owner_id=case when owner_id=target_user then master else owner_id end,
    overlay_token=gen_random_uuid() where campaign_id=cid;
  delete from public.members where campaign_id=cid and user_id=target_user;
  update public.campaigns set invite_code=upper(replace(gen_random_uuid()::text,'-','')) where id=cid;
end $$;
create or replace function public.leave_campaign(cid uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin perform public.remove_campaign_member(cid,auth.uid()); end $$;

-- Serialize joining with removal/invite rotation on the same campaign row.
create or replace function public.join_campaign(code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro'; end if;
  select id into cid from public.campaigns where invite_code=upper(trim(code)) for update;
  if cid is null then raise exception 'Código de convite inválido'; end if;
  insert into public.members(campaign_id,user_id) values(cid,auth.uid()) on conflict do nothing;
  return cid;
end $$;

update storage.buckets set public=true, file_size_limit=5242880,
  allowed_mime_types=array['image/png','image/jpeg','image/webp'] where id='portraits';

-- Persistent garbage collection. Never DELETE storage.objects directly:
-- the worker removes the actual object through the Storage API.
create table if not exists public.portrait_gc (
  object_name text primary key,
  queued_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
alter table public.portrait_gc enable row level security;
revoke all on public.portrait_gc from public, anon, authenticated;
grant all on public.portrait_gc to service_role;

create or replace function public.portrait_path(url text)
returns text language sql immutable set search_path = '' as $$
  select substring(url from '^https://[^/]+/storage/v1/object/public/portraits/([0-9a-f-]+/[0-9a-f-]+\.(png|jpg|webp))$')
$$;
create or replace function public.portrait_referenced(path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.characters c, jsonb_each_text(c.images) i where public.portrait_path(i.value)=path)
$$;
create or replace function public.queue_old_portraits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare item record; path text;
begin
  for item in select * from jsonb_each_text(old.images) loop
    path := public.portrait_path(item.value);
    if path is not null and (tg_op='DELETE' or not exists(select 1 from jsonb_each_text(new.images) n where n.value=item.value)) then
      insert into public.portrait_gc(object_name) values(path) on conflict do nothing;
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists queue_old_portraits_trigger on public.characters;
create trigger queue_old_portraits_trigger after update of images or delete on public.characters
for each row execute function public.queue_old_portraits();

-- Files are deleted only by the cleanup worker, which coordinates with attachment.
drop policy if exists "portrait delete" on storage.objects;

create or replace function public.claim_portrait_cleanup(batch_size integer default 100)
returns table(object_name text) language plpgsql security definer set search_path = '' as $$
declare obj record;
begin
  -- Crash recovery for files uploaded but never attached. 24h protects slow uploads.
  insert into public.portrait_gc(object_name)
    select o.name from storage.objects o where o.bucket_id='portraits' and o.created_at < now()-interval '24 hours'
    and o.name ~ '^[0-9a-f-]+/[0-9a-f-]+\.(png|jpg|webp)$'
    and not public.portrait_referenced(o.name) on conflict do nothing;
  for obj in select o.id,o.name from storage.objects o join public.portrait_gc q on q.object_name=o.name
    where o.bucket_id='portraits' and (q.claimed_at is null or q.claimed_at < now()-interval '10 minutes')
    order by q.queued_at limit least(greatest(batch_size,1),500) for update of o skip locked loop
    if public.portrait_referenced(obj.name) then
      delete from public.portrait_gc q where q.object_name=obj.name;
    else
      update public.portrait_gc q set claimed_at=now(),attempts=attempts+1 where q.object_name=obj.name;
      object_name := obj.name; return next;
    end if;
  end loop;
  delete from public.portrait_gc q where not exists(select 1 from storage.objects o where o.bucket_id='portraits' and o.name=q.object_name);
end $$;

-- Every new application RPC is explicit opt-in. No anonymous execution.
do $$
declare signature text;
begin
  foreach signature in array array[
    'save_character(uuid,jsonb,jsonb)', 'save_campaign(uuid,jsonb,jsonb)',
    'replace_portrait(uuid,text,text)', 'rotate_overlay(uuid)', 'rotate_invite(uuid)',
    'list_campaign_members(uuid)', 'remove_campaign_member(uuid,uuid)', 'leave_campaign(uuid)'
  ] loop
    execute 'revoke all on function public.' || signature || ' from public, anon';
    execute 'grant execute on function public.' || signature || ' to authenticated';
  end loop;
end $$;
revoke all on function public.claim_portrait_cleanup(integer) from public, anon, authenticated;
grant execute on function public.claim_portrait_cleanup(integer) to service_role;
revoke all on function public.portrait_referenced(text) from public, anon, authenticated;
revoke all on function public.queue_old_portraits() from public, anon, authenticated;
revoke all on function public.lock_character_identity() from public, anon, authenticated;
revoke all on function public.lock_campaign_identity() from public, anon, authenticated;

insert into public.schema_migrations(version) values('202610170001') on conflict do nothing;
commit;
