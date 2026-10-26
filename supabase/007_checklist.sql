-- Fase 2: checklist diário gamificado
alter table public.checklist_entries add column if not exists validado_em timestamptz;
create or replace function public.sp_today() returns date language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
create or replace function public.can_validate(p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select is_admin() or is_evaluator_of(p) or is_reviewer_of(p) $$;

create or replace function public.checklist_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare t record; fk text;
begin
  if tg_op='INSERT' then
    if new.profile_id<>auth.uid() and not is_admin() then raise exception 'Só o próprio colaborador registra'; end if;
    new.data:=sp_today(); new.validado_por:=null; new.validado_em:=null;
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
  -- UPDATE
  if auth.uid()=old.profile_id and not is_admin() then
    if new.validado_por is distinct from old.validado_por then raise exception 'Você não pode validar a própria proatividade'; end if;
    new.xp:=old.xp; new.template_id:=old.template_id; new.tipo:=old.tipo; new.data:=old.data;
    if old.validado_por is not null then raise exception 'Proatividade já validada'; end if;
  else
    if not can_validate(old.profile_id) then raise exception 'Sem permissão'; end if;
    if old.tipo<>'proativa' then raise exception 'Só proatividade é validada'; end if;
    new.descricao:=old.descricao; new.xp:=old.xp; new.data:=old.data; new.profile_id:=old.profile_id; new.template_id:=null;
    new.validado_por:=case when new.validado_por is null then null else auth.uid() end;
    new.validado_em:=case when new.validado_por is null then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists trg_checklist_guard on public.checklist_entries;
create trigger trg_checklist_guard before insert or update on public.checklist_entries for each row execute function public.checklist_guard();

drop policy if exists ce_sel on public.checklist_entries;
create policy ce_sel on public.checklist_entries for select to authenticated using (profile_id=auth.uid() or can_validate(profile_id));
drop policy if exists ce_val on public.checklist_entries;
create policy ce_val on public.checklist_entries for update to authenticated using (tipo='proativa' and can_validate(profile_id)) with check (can_validate(profile_id));

-- XP: obrigatórias + proatividades validadas; semana começa na segunda (fuso SP); fora do plano não entra
create or replace function public.my_xp_rank(desde date default date_trunc('week',(now() at time zone 'America/Sao_Paulo'))::date)
returns table(xp bigint, posicao bigint, total bigint) language sql stable security definer set search_path=public as $$
  with t as (select p.id, coalesce(sum(c.xp) filter (where c.tipo='obrigatoria' or c.validado_por is not null),0) xp
             from profiles p left join checklist_entries c on c.profile_id=p.id and c.data>=desde
             where p.ativo and not coalesce(p.fora_do_plano,false) group by p.id),
       r as (select id, xp, rank() over (order by xp desc) pos, count(*) over () tot from t)
  select xp, pos, tot from r where id=auth.uid() $$;

-- tarefas do dia esperadas por pessoa
create or replace function public.expected_tasks(p uuid) returns bigint language sql stable security definer set search_path=public as
$$ select count(*) from task_templates t where t.status='aprovada' and t.function_key in (select function_key from assignments where profile_id=p and ativo) $$;

-- visão da equipe: admin vê todos; avaliador/revisor só seus avaliados
create or replace function public.team_checklist(desde date, ate date)
returns table(profile_id uuid, nome text, data date, feitas bigint, esperadas bigint, xp bigint, proativas bigint, pendentes_validacao bigint)
language sql stable security definer set search_path=public as $$
  select p.id, p.nome, d::date, 
    (select count(*) from checklist_entries c where c.profile_id=p.id and c.data=d::date and c.tipo='obrigatoria'),
    expected_tasks(p.id),
    (select coalesce(sum(xp),0) from checklist_entries c where c.profile_id=p.id and c.data=d::date and (c.tipo='obrigatoria' or c.validado_por is not null)),
    (select count(*) from checklist_entries c where c.profile_id=p.id and c.data=d::date and c.tipo='proativa'),
    (select count(*) from checklist_entries c where c.profile_id=p.id and c.data=d::date and c.tipo='proativa' and c.validado_por is null)
  from profiles p cross join generate_series(desde, ate, interval '1 day') d
  where p.ativo and not coalesce(p.fora_do_plano,false) and (is_admin() or (p.id<>auth.uid() and can_validate(p.id)))
  order by p.nome, d $$;
revoke execute on function public.team_checklist(date,date), public.expected_tasks(uuid), public.can_validate(uuid), public.sp_today() from anon;
