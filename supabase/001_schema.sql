-- ===== B Fit Equipe · fase 1 (+ esquema da fase 2) =====
create extension if not exists pgcrypto;

create table public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  usuario text unique not null,
  is_admin boolean not null default false,
  must_change_password boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.levels(
  code text primary key,
  track text not null check (track in ('tecnica','comercial','gestao','funcao')),
  cargo text not null,
  ordem int not null,
  reqs jsonb not null default '[]'
);

create table public.criteria(
  id smallint primary key,
  nome text not null,
  peso int not null,
  descricao text
);

create table public.assignments(
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  function_key text not null,         -- edfisica | professor | coord_salao | coord_comercial | comercial | recepcao | administrativo
  titulo text not null,
  track text not null check (track in ('tecnica','comercial','gestao','funcao')),
  level_code text references public.levels(code),
  evaluator_id uuid references public.profiles(id),
  observacao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.assignments(profile_id);
create index on public.assignments(evaluator_id);

create table public.evaluations(
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  evaluator_id uuid not null default auth.uid() references public.profiles(id),
  periodo text not null,                       -- ex.: 2026-T4
  level_code text references public.levels(code),
  subetapa text check (subetapa in ('A','B','C')),
  scores jsonb not null default '{}',          -- {"1":4,"2":5,...} por criteria.id
  reqs_ok jsonb not null default '[]',         -- índices dos requisitos cumpridos
  observacoes text,
  pdi text,
  proximo_nivel text references public.levels(code),
  nota_final numeric(4,2),
  status text not null default 'rascunho' check (status in ('rascunho','enviada','ciente')),
  enviada_em timestamptz,
  ciente_em timestamptz,
  comentario_colaborador text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.evaluations(assignment_id);

-- serviço terceirizado (marketing do Júlio): fora do plano de carreira
create table public.service_contracts(
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  prestador text not null,
  prestador_profile_id uuid references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  ativo boolean not null default true
);
create table public.service_reviews(
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.service_contracts(id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references public.profiles(id),
  periodo text not null,
  scores jsonb not null default '{}',   -- entregas, prazos, qualidade, marca, resultados (1–5)
  entregas jsonb not null default '[]', -- [{demanda,prazo,entregue,status}]
  decisao text,
  ajustes text,
  proximas text,
  status text not null default 'rascunho' check (status in ('rascunho','enviada','ciente')),
  created_at timestamptz not null default now()
);

-- ===== Fase 2 (checklist gamificado) — esquema pronto =====
create table public.task_templates(
  id uuid primary key default gen_random_uuid(),
  function_key text not null,
  titulo text not null,
  descricao text,
  turno text,
  xp int not null default 10,
  ordem int not null default 0,
  status text not null default 'rascunho' check (status in ('rascunho','aprovada','arquivada'))
);
create table public.checklist_entries(
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  template_id uuid references public.task_templates(id),
  tipo text not null check (tipo in ('obrigatoria','proativa')),
  descricao text,
  xp int not null default 0,
  foto_path text,
  validado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (profile_id, data, template_id)
);
create table public.badges(code text primary key, nome text not null, descricao text, icone text, xp_bonus int default 0);
create table public.profile_badges(profile_id uuid references public.profiles(id) on delete cascade, badge_code text references public.badges(code), earned_at timestamptz default now(), primary key(profile_id,badge_code));

-- ===== Funções auxiliares =====
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as
$$ select coalesce((select is_admin from profiles where id=auth.uid()),false) $$;

create or replace function public.is_evaluator_of(p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from assignments where profile_id=p and evaluator_id=auth.uid() and ativo) $$;

create or replace function public.is_evaluated_by(p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from assignments where profile_id=auth.uid() and evaluator_id=p and ativo) $$;

create or replace function public.assignment_owner(a uuid) returns uuid language sql stable security definer set search_path=public as
$$ select profile_id from assignments where id=a $$;
create or replace function public.assignment_evaluator(a uuid) returns uuid language sql stable security definer set search_path=public as
$$ select evaluator_id from assignments where id=a $$;

-- nota ponderada automática
create or replace function public.calc_nota() returns trigger language plpgsql security definer set search_path=public as $$
declare s numeric:=0; w numeric:=0; c record;
begin
  for c in select id,peso from criteria loop
    if (new.scores ? c.id::text) and (new.scores->>c.id::text) ~ '^[1-5]$' then
      s:=s+(new.scores->>c.id::text)::numeric*c.peso; w:=w+c.peso; end if;
  end loop;
  new.nota_final:= case when w=100 then round(s/100,2) when w>0 then round(s/w,2) else null end;
  new.updated_at:=now();
  if new.status='enviada' and new.enviada_em is null then new.enviada_em:=now(); end if;
  return new;
end $$;
create trigger trg_calc_nota before insert or update on public.evaluations for each row execute function public.calc_nota();

-- ciência do colaborador
create or replace function public.acknowledge_evaluation(eval_id uuid, comentario text default null) returns void
language plpgsql security definer set search_path=public as $$
begin
  update evaluations e set status='ciente', ciente_em=now(), comentario_colaborador=comentario
   where e.id=eval_id and e.status='enviada' and assignment_owner(e.assignment_id)=auth.uid();
  if not found then raise exception 'Avaliação não encontrada ou não liberada para ciência'; end if;
end $$;

create or replace function public.mark_password_changed() returns void language sql security definer set search_path=public as
$$ update profiles set must_change_password=false where id=auth.uid() $$;

-- XP / ranking privado (fase 2): devolve só a própria posição
create or replace function public.my_xp_rank(desde date default date_trunc('week',now())::date)
returns table(xp bigint, posicao bigint, total bigint) language sql stable security definer set search_path=public as $$
  with t as (select p.id, coalesce(sum(c.xp),0) xp from profiles p left join checklist_entries c on c.profile_id=p.id and c.data>=desde where p.ativo group by p.id),
       r as (select id, xp, rank() over (order by xp desc) pos, count(*) over () tot from t)
  select xp, pos, tot from r where id=auth.uid() $$;

-- ===== RLS =====
alter table public.profiles enable row level security;
alter table public.levels enable row level security;
alter table public.criteria enable row level security;
alter table public.assignments enable row level security;
alter table public.evaluations enable row level security;
alter table public.service_contracts enable row level security;
alter table public.service_reviews enable row level security;
alter table public.task_templates enable row level security;
alter table public.checklist_entries enable row level security;
alter table public.badges enable row level security;
alter table public.profile_badges enable row level security;

create policy p_sel on public.profiles for select to authenticated using (id=auth.uid() or is_admin() or is_evaluator_of(id) or is_evaluated_by(id));
create policy p_adm on public.profiles for all to authenticated using (is_admin()) with check (is_admin());

create policy l_sel on public.levels for select to authenticated using (true);
create policy l_adm on public.levels for all to authenticated using (is_admin()) with check (is_admin());
create policy c_sel on public.criteria for select to authenticated using (true);
create policy c_adm on public.criteria for all to authenticated using (is_admin()) with check (is_admin());
create policy b_sel on public.badges for select to authenticated using (true);
create policy b_adm on public.badges for all to authenticated using (is_admin()) with check (is_admin());

create policy a_sel on public.assignments for select to authenticated using (profile_id=auth.uid() or evaluator_id=auth.uid() or is_admin());
create policy a_adm on public.assignments for all to authenticated using (is_admin()) with check (is_admin());

create policy e_sel on public.evaluations for select to authenticated using (
  is_admin() or assignment_evaluator(assignment_id)=auth.uid()
  or (assignment_owner(assignment_id)=auth.uid() and status<>'rascunho'));
create policy e_ins on public.evaluations for insert to authenticated with check (
  is_admin() or (assignment_evaluator(assignment_id)=auth.uid() and evaluator_id=auth.uid()));
create policy e_upd on public.evaluations for update to authenticated using (
  is_admin() or (assignment_evaluator(assignment_id)=auth.uid() and status<>'ciente'))
  with check (is_admin() or (assignment_evaluator(assignment_id)=auth.uid() and status<>'ciente'));
create policy e_del on public.evaluations for delete to authenticated using (
  is_admin() or (assignment_evaluator(assignment_id)=auth.uid() and status='rascunho'));

create policy sc_sel on public.service_contracts for select to authenticated using (is_admin() or reviewer_id=auth.uid() or prestador_profile_id=auth.uid());
create policy sc_adm on public.service_contracts for all to authenticated using (is_admin()) with check (is_admin());
create policy sr_sel on public.service_reviews for select to authenticated using (
  is_admin() or exists(select 1 from service_contracts s where s.id=contract_id and (s.reviewer_id=auth.uid() or (s.prestador_profile_id=auth.uid() and service_reviews.status<>'rascunho'))));
create policy sr_wr on public.service_reviews for all to authenticated using (
  is_admin() or exists(select 1 from service_contracts s where s.id=contract_id and s.reviewer_id=auth.uid()))
  with check (is_admin() or exists(select 1 from service_contracts s where s.id=contract_id and s.reviewer_id=auth.uid()));

create policy t_sel on public.task_templates for select to authenticated using (status='aprovada' or is_admin());
create policy t_adm on public.task_templates for all to authenticated using (is_admin()) with check (is_admin());

create policy ce_sel on public.checklist_entries for select to authenticated using (profile_id=auth.uid() or is_admin() or is_evaluator_of(profile_id));
create policy ce_ins on public.checklist_entries for insert to authenticated with check (profile_id=auth.uid());
create policy ce_upd on public.checklist_entries for update to authenticated using (profile_id=auth.uid() and data=(now() at time zone 'America/Sao_Paulo')::date) with check (profile_id=auth.uid());
create policy ce_del on public.checklist_entries for delete to authenticated using (profile_id=auth.uid() and data=(now() at time zone 'America/Sao_Paulo')::date);
create policy ce_adm on public.checklist_entries for all to authenticated using (is_admin()) with check (is_admin());

create policy pb_sel on public.profile_badges for select to authenticated using (profile_id=auth.uid() or is_admin());
create policy pb_adm on public.profile_badges for all to authenticated using (is_admin()) with check (is_admin());

revoke execute on function public.calc_nota() from public, anon, authenticated;
