-- 2026-10-23: novos avaliadores + revisão em 2 etapas
alter table public.assignments add column if not exists reviewer_id uuid references public.profiles(id);
alter table public.evaluations add column if not exists scores_primario jsonb,
  add column if not exists revisor_id uuid references public.profiles(id),
  add column if not exists revisao_concordo boolean,
  add column if not exists revisao_ressalvas text,
  add column if not exists revisao_justificativa text,
  add column if not exists revisado_em timestamptz;
alter table public.evaluations drop constraint if exists evaluations_status_check;
alter table public.evaluations add constraint evaluations_status_check check (status in ('rascunho','revisao','enviada','ciente'));

create or replace function public.assignment_reviewer(a uuid) returns uuid language sql stable security definer set search_path=public as
$$ select reviewer_id from assignments where id=a $$;
create or replace function public.is_reviewer_of(p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from assignments where profile_id=p and reviewer_id=auth.uid() and ativo) $$;

create or replace function public.review_flow() returns trigger language plpgsql security definer set search_path=public as $$
declare rv uuid:=assignment_reviewer(new.assignment_id); old_st text:=case when tg_op='UPDATE' then old.status else 'rascunho' end;
begin
  if rv is null then return new; end if;
  if new.status in ('enviada','ciente') and old_st in ('rascunho','revisao') and not (auth.uid()=rv or is_admin()) then new.status:='revisao'; end if;
  if new.status='revisao' and old_st='rascunho' then new.scores_primario:=new.scores; new.revisor_id:=null; new.revisado_em:=null; end if;
  if new.status='enviada' and old_st='revisao' then
    if not coalesce(new.revisao_concordo,false) and coalesce(trim(new.revisao_ressalvas),'')='' then raise exception 'Revisão exige "Concordo" e/ou ressalvas'; end if;
    if new.scores is distinct from new.scores_primario and coalesce(trim(new.revisao_justificativa),'')='' then raise exception 'Ajuste de notas exige justificativa'; end if;
    new.revisor_id:=auth.uid(); new.revisado_em:=now();
  end if;
  if new.status='revisao' then new.enviada_em:=null; end if;
  return new;
end $$;
drop trigger if exists trg_a_review on public.evaluations;
create trigger trg_a_review before insert or update on public.evaluations for each row execute function public.review_flow();

drop policy if exists e_sel on public.evaluations; drop policy if exists e_upd on public.evaluations;
create policy e_sel on public.evaluations for select to authenticated using (
  is_admin() or assignment_evaluator(assignment_id)=auth.uid()
  or (assignment_reviewer(assignment_id)=auth.uid() and status<>'rascunho')
  or (assignment_owner(assignment_id)=auth.uid() and status in ('enviada','ciente')));
create policy e_upd on public.evaluations for update to authenticated using (
  is_admin()
  or (assignment_evaluator(assignment_id)=auth.uid() and (status='rascunho' or (assignment_reviewer(assignment_id) is null and status<>'ciente')))
  or (assignment_reviewer(assignment_id)=auth.uid() and status in ('revisao','enviada')))
 with check (
  is_admin()
  or (assignment_evaluator(assignment_id)=auth.uid() and (status in ('rascunho','revisao') or (assignment_reviewer(assignment_id) is null and status<>'ciente')))
  or (assignment_reviewer(assignment_id)=auth.uid() and status in ('revisao','enviada')));
drop policy if exists a_sel on public.assignments;
create policy a_sel on public.assignments for select to authenticated using (profile_id=auth.uid() or evaluator_id=auth.uid() or reviewer_id=auth.uid() or is_admin());
drop policy if exists p_sel on public.profiles;
create policy p_sel on public.profiles for select to authenticated using (id=auth.uid() or is_admin() or is_evaluator_of(id) or is_evaluated_by(id) or is_reviewer_of(id)
  or exists(select 1 from assignments a where a.profile_id=auth.uid() and a.reviewer_id=profiles.id and a.ativo));
revoke execute on function public.assignment_reviewer(uuid), public.is_reviewer_of(uuid) from anon;

-- dados
update assignments set evaluator_id=(select id from profiles where usuario='roberta') where id='315d22e3-2af0-4d99-99bb-429a2ec7b845'; -- Verônica adm
update assignments set function_key='administrativo', titulo='Auxiliar Administrativa', level_code='ADM', evaluator_id=(select id from profiles where usuario='roberta') where id='0bca2362-0038-41df-b816-b14b5bb39a90'; -- Marcelly
delete from assignments where id='b1b9b934-ad12-419b-a22c-3537b67d0d81' and not exists(select 1 from evaluations where assignment_id='b1b9b934-ad12-419b-a22c-3537b67d0d81'); -- Thamiris recepção removida
update assignments set evaluator_id=(select id from profiles where usuario='marcelly'), reviewer_id=(select id from profiles where usuario='yasmim'),
  observacao='Inclui o apoio à professora Marcelly no turno' where id='d9482aeb-3f26-4da5-9fde-ac1f634d3ff8';
