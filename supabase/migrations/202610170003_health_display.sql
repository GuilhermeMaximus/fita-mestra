-- Apply after 202610170002_health_and_bars.sql.
begin;
alter table public.characters add column if not exists hp_display text not null default 'bar' check(hp_display in ('bar','numbers'));
grant update(hp_display) on public.characters to authenticated;
create or replace function public.save_character(target_id uuid, patch jsonb, expected jsonb)
returns public.characters language plpgsql security invoker set search_path = '' as $$
declare old_row public.characters; new_row public.characters; k text;
begin
  if jsonb_typeof(patch) is distinct from 'object' or jsonb_typeof(expected) is distinct from 'object' then raise exception 'Alterações inválidas'; end if;
  select * into old_row from public.characters where id=target_id for update;
  if not found then raise exception 'Personagem não encontrado ou sem permissão'; end if;
  for k in select jsonb_object_keys(patch) loop
    if k not in ('name','notes','hp','extra_hp','max_hp','active_slot','font','name_color','name_size','show_hp','hp_display') then raise exception 'Campo não permitido'; end if;
    if not (expected ? k) or (to_jsonb(old_row)->k) is distinct from (expected->k) then raise exception 'CONFLITO: %', k; end if;
  end loop;
  new_row := jsonb_populate_record(old_row, patch);
  update public.characters set name=new_row.name, notes=new_row.notes, hp=new_row.hp, extra_hp=new_row.extra_hp, max_hp=new_row.max_hp,
    active_slot=new_row.active_slot, font=new_row.font, name_color=new_row.name_color,
    name_size=new_row.name_size, show_hp=new_row.show_hp, hp_display=new_row.hp_display where id=target_id returning * into new_row;
  if not found then raise exception 'Personagem não encontrado ou sem permissão'; end if;
  return new_row;
end $$;
create or replace function public.get_overlay(token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
 'name',ch.name,'hp',ch.hp,'max_hp',ch.max_hp,'extra_hp',ch.extra_hp,'images',ch.images,
 'active_slot',ch.active_slot,'font',ch.font,'name_color',ch.name_color,
 'name_size',ch.name_size,'show_hp',ch.show_hp,'hp_display',ch.hp_display,'bar',ca.bar,'custom_bar',ca.custom_bar,
 'grad1',ca.grad1,'grad2',ca.grad2,'fits',ca.fits
 ) from public.characters ch join public.campaigns ca on ca.id=ch.campaign_id
 where ch.overlay_token=token limit 1
$$;
insert into public.schema_migrations(version) values('202610170003') on conflict do nothing;
commit;
