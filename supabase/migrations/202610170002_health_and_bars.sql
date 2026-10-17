-- Apply after 202610170001_reliability.sql. Preserves existing records.
begin;
alter table public.characters add column if not exists extra_hp integer not null default 0 check(extra_hp between 0 and 1000000);
alter table public.campaigns add column if not exists custom_bar text;
grant update(extra_hp) on public.characters to authenticated;

create or replace function public.normalize_character_health()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.hp > new.max_hp then
    new.extra_hp := new.extra_hp + (new.hp - new.max_hp);
    new.hp := new.max_hp;
  end if;
  return new;
end $$;
drop trigger if exists normalize_character_health on public.characters;
create trigger normalize_character_health before insert or update on public.characters
for each row execute function public.normalize_character_health();
create or replace function public.save_character(target_id uuid, patch jsonb, expected jsonb)
returns public.characters language plpgsql security invoker set search_path = '' as $$
declare old_row public.characters; new_row public.characters; k text;
begin
  if jsonb_typeof(patch) is distinct from 'object' or jsonb_typeof(expected) is distinct from 'object' then raise exception 'Alterações inválidas'; end if;
  select * into old_row from public.characters where id=target_id for update;
  if not found then raise exception 'Personagem não encontrado ou sem permissão'; end if;
  for k in select jsonb_object_keys(patch) loop
    if k not in ('name','notes','hp','extra_hp','max_hp','active_slot','font','name_color','name_size','show_hp') then raise exception 'Campo não permitido'; end if;
    if not (expected ? k) or (to_jsonb(old_row)->k) is distinct from (expected->k) then raise exception 'CONFLITO: %', k; end if;
  end loop;
  new_row := jsonb_populate_record(old_row, patch);
  update public.characters set name=new_row.name, notes=new_row.notes, hp=new_row.hp, extra_hp=new_row.extra_hp, max_hp=new_row.max_hp,
    active_slot=new_row.active_slot, font=new_row.font, name_color=new_row.name_color,
    name_size=new_row.name_size, show_hp=new_row.show_hp where id=target_id returning * into new_row;
  if not found then raise exception 'Personagem não encontrado ou sem permissão'; end if;
  return new_row;
end $$;
create or replace function public.replace_portrait(target_id uuid, slot_name text, image_url text)
returns public.characters language plpgsql security definer set search_path = '' as $$
declare ch public.characters; path text;
begin
  select * into ch from public.characters where id=target_id for update;
  if not found or auth.uid() is null or not public.is_campaign_member(ch.campaign_id, auth.uid())
    or not public.is_campaign_owner(ch.campaign_id, auth.uid()) then raise exception 'Personagem não encontrado ou sem permissão'; end if;
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
create or replace function public.valid_fits(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item record; k text; n numeric;
begin
  if value is null or jsonb_typeof(value) <> 'object' then return false; end if;
  for item in select * from jsonb_each(value) loop
    if item.key not in ('Gótico','Pixel Art','Arco-íris','Steampunk','Dark','Floresta','Céu','Personalizada')
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

alter table public.campaigns drop constraint if exists campaign_appearance_valid;
alter table public.campaigns add constraint campaign_appearance_valid check (
 bar in ('Gótico','Pixel Art','Arco-íris','Steampunk','Dark','Floresta','Céu','Personalizada')
 and (bar <> 'Personalizada' or custom_bar is not null)
 and (custom_bar is null or public.portrait_path(custom_bar) is not null)
 and grad1 ~ '^#[0-9A-Fa-f]{6}$' and grad2 ~ '^#[0-9A-Fa-f]{6}$' and public.valid_fits(fits)
);
drop policy if exists "portrait upload" on storage.objects;
create policy "portrait upload" on storage.objects for insert to authenticated
with check (bucket_id='portraits' and (storage.foldername(name))[1]=auth.uid()::text
 and exists(select 1 from public.campaigns c where c.owner_id=auth.uid()));

create or replace function public.replace_bar(target_id uuid, image_url text)
returns public.campaigns language plpgsql security definer set search_path = '' as $$
declare ca public.campaigns; path text;
begin
 select * into ca from public.campaigns where id=target_id for update;
 if not found or auth.uid() is null or not public.is_campaign_owner(target_id, auth.uid()) then raise exception 'Somente o mestre'; end if;
 path := public.portrait_path(image_url);
 if path is null or split_part(path,'/',1) <> auth.uid()::text then raise exception 'Imagem inválida'; end if;
 perform 1 from storage.objects where bucket_id='portraits' and name=path for update;
 if not found then raise exception 'Arquivo não encontrado'; end if;
 if exists(select 1 from public.portrait_gc where object_name=path and claimed_at is not null) then raise exception 'Arquivo em limpeza; envie novamente'; end if;
 delete from public.portrait_gc where object_name=path;
 update public.campaigns set custom_bar=image_url where id=target_id returning * into ca;
 return ca;
end $$;
revoke all on function public.replace_bar(uuid,text) from public, anon;
grant execute on function public.replace_bar(uuid,text) to authenticated;

create or replace function public.portrait_referenced(path text)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.characters c, jsonb_each_text(c.images) i where public.portrait_path(i.value)=path)
 or exists(select 1 from public.campaigns c where public.portrait_path(c.custom_bar)=path)
$$;
create or replace function public.queue_old_bar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare path text;
begin
 path := public.portrait_path(old.custom_bar);
 if path is not null and (tg_op='DELETE' or old.custom_bar is distinct from new.custom_bar) then
  insert into public.portrait_gc(object_name) values(path) on conflict do nothing;
 end if;
 return null;
end $$;
drop trigger if exists queue_old_bar on public.campaigns;
create trigger queue_old_bar after update of custom_bar or delete on public.campaigns
for each row execute function public.queue_old_bar();
revoke all on function public.queue_old_bar() from public, anon, authenticated;
create or replace function public.get_overlay(token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
 'name',ch.name,'hp',ch.hp,'max_hp',ch.max_hp,'extra_hp',ch.extra_hp,'images',ch.images,
 'active_slot',ch.active_slot,'font',ch.font,'name_color',ch.name_color,
 'name_size',ch.name_size,'show_hp',ch.show_hp,'bar',ca.bar,'custom_bar',ca.custom_bar,
 'grad1',ca.grad1,'grad2',ca.grad2,'fits',ca.fits
 ) from public.characters ch join public.campaigns ca on ca.id=ch.campaign_id
 where ch.overlay_token=token limit 1
$$;
insert into public.schema_migrations(version) values('202610170002') on conflict do nothing;
commit;
