-- FITA METRA FICHAS - BASE V1, SOMENTE PARA BANCO NOVO.
-- Depois execute migrations/202610170001_reliability.sql antes de publicar v2.
-- Em instalações existentes execute somente a migração. Não reaplique esta base.
create extension if not exists pgcrypto;

create table if not exists public.campaigns (
 id uuid primary key default gen_random_uuid(),
 title text not null check (length(title) between 1 and 100),
 owner_id uuid not null references auth.users(id) on delete cascade,
 invite_code text not null unique default upper(substr(encode(gen_random_bytes(7),'hex'),1,10)),
 bar text not null default 'Pixel Art',
 grad1 text not null default '#f064a5',
 grad2 text not null default '#8c72ff',
 fits jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.members (
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(campaign_id,user_id)
);
create table if not exists public.characters (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references public.campaigns(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 name text not null default 'Novo personagem',
 notes text not null default '',
 hp integer not null default 100 check(hp >= 0),
 max_hp integer not null default 100 check(max_hp > 0),
 images jsonb not null default '{}'::jsonb,
 active_slot text not null default 'Normal',
 font text not null default 'Georgia',
 name_color text not null default '#ffffff',
 name_size integer not null default 25 check(name_size between 12 and 60),
 show_hp boolean not null default true,
 overlay_token uuid not null unique default gen_random_uuid(),
 updated_at timestamptz not null default now(),
 constraint hp_within_max check(hp <= max_hp)
);
create index if not exists characters_campaign_idx on public.characters(campaign_id);

create or replace function public.is_campaign_member(cid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.members where campaign_id=cid and user_id=uid)
 or exists(select 1 from public.campaigns where id=cid and owner_id=uid)
$$;
create or replace function public.is_campaign_owner(cid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.campaigns where id=cid and owner_id=uid)
$$;

alter table public.campaigns enable row level security;
alter table public.members enable row level security;
alter table public.characters enable row level security;

drop policy if exists "campaign read" on public.campaigns;
create policy "campaign read" on public.campaigns for select to authenticated
 using (public.is_campaign_member(id, (select auth.uid())));
drop policy if exists "campaign create" on public.campaigns;
create policy "campaign create" on public.campaigns for insert to authenticated
 with check (owner_id=(select auth.uid()));
drop policy if exists "campaign update" on public.campaigns;
create policy "campaign update" on public.campaigns for update to authenticated
 using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()));
drop policy if exists "member read" on public.members;
create policy "member read" on public.members for select to authenticated
 using (public.is_campaign_member(campaign_id,(select auth.uid())));
drop policy if exists "character read" on public.characters;
create policy "character read" on public.characters for select to authenticated
 using (public.is_campaign_member(campaign_id,(select auth.uid())));
drop policy if exists "character insert" on public.characters;
create policy "character insert" on public.characters for insert to authenticated
 with check (owner_id=(select auth.uid()) and public.is_campaign_member(campaign_id,(select auth.uid())));
drop policy if exists "character update" on public.characters;
create policy "character update" on public.characters for update to authenticated
 using (owner_id=(select auth.uid()) or public.is_campaign_owner(campaign_id,(select auth.uid())))
 with check (public.is_campaign_member(campaign_id,(select auth.uid())) and
  (owner_id=(select auth.uid()) or public.is_campaign_owner(campaign_id,(select auth.uid()))));
drop policy if exists "character delete" on public.characters;
create policy "character delete" on public.characters for delete to authenticated
 using (owner_id=(select auth.uid()) or public.is_campaign_owner(campaign_id,(select auth.uid())));

create or replace function public.join_campaign(code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cid uuid;
begin
 if auth.uid() is null then raise exception 'Faça login primeiro'; end if;
 select id into cid from public.campaigns where invite_code=upper(trim(code));
 if cid is null then raise exception 'Código de convite inválido'; end if;
 insert into public.members(campaign_id,user_id) values(cid,auth.uid()) on conflict do nothing;
 return cid;
end $$;

-- Overlay somente-leitura: o token UUID funciona como segredo do link.
create or replace function public.get_overlay(token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
 'name',ch.name,'hp',ch.hp,'max_hp',ch.max_hp,'images',ch.images,
 'active_slot',ch.active_slot,'font',ch.font,'name_color',ch.name_color,
 'name_size',ch.name_size,'show_hp',ch.show_hp,'bar',ca.bar,
 'grad1',ca.grad1,'grad2',ca.grad2,'fits',ca.fits
 ) from public.characters ch join public.campaigns ca on ca.id=ch.campaign_id
 where ch.overlay_token=token limit 1
$$;
revoke all on function public.get_overlay(uuid) from public;
grant execute on function public.get_overlay(uuid) to anon, authenticated;
revoke all on function public.join_campaign(text) from public;
grant execute on function public.join_campaign(text) to authenticated;

-- Imagens públicas por URL aleatória, sem listagem aberta.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portraits','portraits',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=true;
drop policy if exists "portrait upload" on storage.objects;
create policy "portrait upload" on storage.objects for insert to authenticated
 with check (bucket_id='portraits' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "portrait read" on storage.objects;
create policy "portrait read" on storage.objects for select to authenticated
 using (bucket_id='portraits' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "portrait delete" on storage.objects;
create policy "portrait delete" on storage.objects for delete to authenticated
 using (bucket_id='portraits' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- Adiciona o criador como membro automaticamente.
create or replace function public.add_owner_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.members(campaign_id,user_id) values(new.id,new.owner_id);
 return new;
end $$;
drop trigger if exists add_owner_member_trigger on public.campaigns;
create trigger add_owner_member_trigger after insert on public.campaigns
 for each row execute function public.add_owner_member();

-- Atualiza timestamp sem depender do cliente.
create or replace function public.touch_character()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at=now(); return new; end $$;
drop trigger if exists touch_character_trigger on public.characters;
create trigger touch_character_trigger before update on public.characters
 for each row execute function public.touch_character();
-- Impede trocar o dono de um personagem/campanha após a criação.
create or replace function public.lock_character_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.owner_id <> old.owner_id or new.campaign_id <> old.campaign_id or new.overlay_token <> old.overlay_token then
  raise exception 'Identidade do personagem não pode ser alterada';
 end if;
 return new;
end $$;
drop trigger if exists lock_character_identity_trigger on public.characters;
create trigger lock_character_identity_trigger before update on public.characters
 for each row execute function public.lock_character_identity();
create or replace function public.lock_campaign_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.owner_id <> old.owner_id or new.invite_code <> old.invite_code then
  raise exception 'Identidade e convite da campanha não podem ser alterados';
 end if;
 return new;
end $$;
drop trigger if exists lock_campaign_identity_trigger on public.campaigns;
create trigger lock_campaign_identity_trigger before update on public.campaigns
 for each row execute function public.lock_campaign_identity();

-- Atualização atômica de UMA variação: preserva as demais imagens do personagem.
create or replace function public.set_portrait_slot(character_id uuid, slot_name text, image_url text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 if slot_name not in ('Normal','Combate','Machucado','Inconsciente') then
  raise exception 'Variação inválida';
 end if;
 if image_url is null or length(image_url)>2048 or image_url not like 'https://%' then
  raise exception 'URL inválida';
 end if;
 update public.characters
 set images=jsonb_set(coalesce(images,'{}'::jsonb),array[slot_name],to_jsonb(image_url),true)
 where id=character_id;
 if not found then raise exception 'Personagem não encontrado ou sem permissão'; end if;
end $$;
revoke all on function public.set_portrait_slot(uuid,text,text) from public;
grant execute on function public.set_portrait_slot(uuid,text,text) to authenticated;


-- Reparos seguros para instalações anteriores e permissões de API.
drop policy if exists "Usuarios podem criar campanhas" on public.campaigns;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.campaigns, public.members, public.characters to authenticated;
grant select, insert, update, delete on public.campaigns, public.members, public.characters to service_role;
-- Não expomos tabelas diretamente ao visitante sem login.
revoke all on public.campaigns, public.members, public.characters from anon;

-- Criação de campanha em uma transação. O servidor define o proprietário a partir do JWT.
create or replace function public.create_campaign(campaign_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'É necessário entrar na conta'; end if;
  if campaign_title is null or length(btrim(campaign_title)) not between 1 and 100 then
    raise exception 'Informe um nome de 1 a 100 caracteres';
  end if;
  insert into public.campaigns(title,owner_id)
  values(btrim(campaign_title), auth.uid()) returning id into new_id;
  return new_id;
end $$;
revoke all on function public.create_campaign(text) from public;
grant execute on function public.create_campaign(text) to authenticated;

-- Evita usuários não membros lerem campanhas de terceiros.
-- RLS permanece habilitado nas três tabelas.
-- O link OBS só consegue ler um portrait se possuir o token UUID individual.
