-- Checklist em 2 momentos: abertura e fechamento do turno
create table if not exists public.checklist_days(
  profile_id uuid not null references public.profiles(id) on delete cascade,
  data date not null,
  aberto_em timestamptz not null default now(),
  fechado_em timestamptz,
  primary key(profile_id,data));
alter table public.checklist_days enable row level security;
drop policy if exists cd_sel on public.checklist_days;
create policy cd_sel on public.checklist_days for select to authenticated using (profile_id=auth.uid() or can_validate(profile_id));
-- sem políticas de escrita: só via RPC

-- colaborador não grava entradas diretamente (só RPC de fechamento); validação de proatividade continua (ce_val)
drop policy if exists ce_ins on public.checklist_entries;
drop policy if exists ce_upd on public.checklist_entries;
drop policy if exists ce_del on public.checklist_entries;

create or replace function public.checklist_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare t record;
begin
  if tg_op='INSERT' then
    if coalesce(current_setting('bfit.fechando',true),'')<>'1' then raise exception 'Tarefas só são registradas no fechamento do turno'; end if;
    if new.profile_id<>auth.uid() then raise exception 'Só o próprio colaborador registra'; end if;
    new.data:=current_setting('bfit.dia')::date; new.validado_por:=null; new.validado_em:=null;
    if new.tipo='obrigatoria' then
      select * into t from task_templates where id=new.template_id and status='aprovada';
      if not found then raise exception 'Tarefa não aprovada'; end if;
      select id into new.assignment_id from assignments where profile_id=new.profile_id and ativo and function_key=t.function_key limit 1;
      if new.assignment_id is null then raise exception 'Tarefa não é da sua função'; end if;
      new.xp:=t.xp; new.descricao:=t.titulo;
    else
      new.template_id:=null; new.xp:=10;
      if coalesce(trim(new.descricao),'')='' then raise exception 'Descreva a proatividade'; end if;
    end if;
    return new;
  end if;
  if tg_op='UPDATE' then
    if auth.uid()=old.profile_id and not is_admin() then raise exception 'Dia fechado: não é possível alterar'; end if;
    if not can_validate(old.profile_id) then raise exception 'Sem permissão'; end if;
    if old.tipo<>'proativa' then raise exception 'Só proatividade é validada'; end if;
    new.descricao:=old.descricao; new.xp:=old.xp; new.data:=old.data; new.profile_id:=old.profile_id; new.template_id:=null; new.tipo:=old.tipo;
    new.validado_por:=case when new.validado_por is null then null else auth.uid() end;
    new.validado_em:=case when new.validado_por is null then null else now() end;
  end if;
  return new;
end $$;

create or replace function public.iniciar_turno() returns public.checklist_days language plpgsql security definer set search_path=public as $$
declare r checklist_days;
begin
  if auth.uid() is null then raise exception 'Sem sessão'; end if;
  insert into checklist_days(profile_id,data) values(auth.uid(),sp_today()) on conflict do nothing;
  select * into r from checklist_days where profile_id=auth.uid() and data=sp_today();
  return r;
end $$;

-- fecha o turno aberto (hoje, ou ontem se virou a meia-noite) gravando tudo de uma vez
create or replace function public.fechar_turno(tarefas uuid[], proativas text[] default '{}') returns public.checklist_days
language plpgsql security definer set search_path=public as $$
declare d checklist_days; t uuid; p text;
begin
  select * into d from checklist_days where profile_id=auth.uid() and fechado_em is null and data>=sp_today()-1 order by data desc limit 1 for update;
  if not found then
    if exists(select 1 from checklist_days where profile_id=auth.uid() and data=sp_today() and fechado_em is not null) then raise exception 'O checklist de hoje já foi concluído'; end if;
    raise exception 'Inicie o turno antes de fechar';
  end if;
  perform set_config('bfit.fechando','1',true); perform set_config('bfit.dia',d.data::text,true);
  foreach t in array coalesce(tarefas,'{}') loop
    insert into checklist_entries(profile_id,template_id,tipo) values(auth.uid(),t,'obrigatoria') on conflict do nothing;
  end loop;
  foreach p in array coalesce(proativas,'{}') loop
    if coalesce(trim(p),'')<>'' then insert into checklist_entries(profile_id,tipo,descricao) values(auth.uid(),'proativa',left(trim(p),300)); end if;
  end loop;
  perform set_config('bfit.fechando','',true);
  update checklist_days set fechado_em=now() where profile_id=d.profile_id and data=d.data returning * into d;
  return d;
end $$;
revoke execute on function public.iniciar_turno(), public.fechar_turno(uuid[],text[]) from anon;

-- XP só de dia fechado
create or replace function public.my_xp_rank(desde date default date_trunc('week',(now() at time zone 'America/Sao_Paulo'))::date)
returns table(xp bigint, posicao bigint, total bigint) language sql stable security definer set search_path=public as $$
  with t as (select p.id, coalesce(sum(c.xp) filter (where (c.tipo='obrigatoria' or c.validado_por is not null)
                  and exists(select 1 from checklist_days k where k.profile_id=c.profile_id and k.data=c.data and k.fechado_em is not null)),0) xp
             from profiles p left join checklist_entries c on c.profile_id=p.id and c.data>=desde
             where p.ativo and not coalesce(p.fora_do_plano,false) group by p.id),
       r as (select id, xp, rank() over (order by xp desc) pos, count(*) over () tot from t)
  select xp, pos, tot from r where id=auth.uid() $$;

drop function if exists public.team_checklist(date,date);
create function public.team_checklist(desde date, ate date)
returns table(profile_id uuid, nome text, data date, feitas bigint, esperadas bigint, xp bigint, proativas bigint, pendentes_validacao bigint, aberto_em timestamptz, fechado_em timestamptz)
language sql stable security definer set search_path=public as $$
  select p.id, p.nome, d::date,
    (select count(*) from checklist_entries c where c.profile_id=p.id and c.data=d::date and c.tipo='obrigatoria'),
    expected_tasks(p.id),
    (select coalesce(sum(xp),0) from checklist_entries c where c.profile_id=p.id and c.data=d::date and (c.tipo='obrigatoria' or c.validado_por is not null) and k.fechado_em is not null),
    (select count(*) from checklist_entries c where c.profile_id=p.id and c.data=d::date and c.tipo='proativa'),
    (select count(*) from checklist_entries c where c.profile_id=p.id and c.data=d::date and c.tipo='proativa' and c.validado_por is null),
    k.aberto_em, k.fechado_em
  from profiles p cross join generate_series(desde, ate, interval '1 day') d
  left join checklist_days k on k.profile_id=p.id and k.data=d::date
  where p.ativo and not coalesce(p.fora_do_plano,false) and (is_admin() or (p.id<>auth.uid() and can_validate(p.id)))
  order by p.nome, d $$;
revoke execute on function public.team_checklist(date,date) from anon;
