-- Aparelho de checklist (ESP32): PIN por colaborador + token de dispositivo + RPCs kiosk_*
create extension if not exists pgcrypto with schema extensions;

alter table public.checklist_days add column if not exists origem_abertura text not null default 'app';
alter table public.checklist_days add column if not exists origem_fechamento text;
alter table public.checklist_entries add column if not exists origem text not null default 'app';

create table if not exists public.profile_pins(
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null, falhas int not null default 0, bloqueado_ate timestamptz, updated_at timestamptz not null default now());
alter table public.profile_pins enable row level security; -- sem políticas: só via funções

create table if not exists public.kiosk_devices(
  id uuid primary key default gen_random_uuid(), nome text not null, token_hash text not null unique,
  criado_por uuid references public.profiles(id), created_at timestamptz not null default now(),
  revogado_em timestamptz, ultimo_uso timestamptz);
alter table public.kiosk_devices enable row level security;
drop policy if exists kd_sel on public.kiosk_devices;
create policy kd_sel on public.kiosk_devices for select to authenticated using (is_admin());

create table if not exists public.kiosk_sessions(
  token_hash text primary key, device_id uuid not null references public.kiosk_devices(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade, expira_em timestamptz not null);
alter table public.kiosk_sessions enable row level security;

create or replace function public._sha(t text) returns text language sql immutable set search_path=public,extensions as
$$ select encode(extensions.digest(coalesce(t,''),'sha256'),'hex') $$;

-- PIN: o próprio colaborador define; admin redefine (apaga)
create or replace function public.set_my_pin(pin text) returns void language plpgsql security definer set search_path=public,extensions as $$
begin
  if auth.uid() is null then raise exception 'Sem sessão'; end if;
  if pin !~ '^[0-9]{4,6}$' then raise exception 'O PIN deve ter de 4 a 6 números'; end if;
  if pin ~ '^(.)\1+$' or pin in ('1234','12345','123456','4321','654321') then raise exception 'PIN fácil demais; escolha outro'; end if;
  insert into profile_pins(profile_id,pin_hash) values(auth.uid(),extensions.crypt(pin,extensions.gen_salt('bf',8)))
   on conflict(profile_id) do update set pin_hash=excluded.pin_hash,falhas=0,bloqueado_ate=null,updated_at=now();
end $$;
create or replace function public.my_pin_status() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profile_pins where profile_id=auth.uid()) $$;
create or replace function public.admin_reset_pin(p uuid) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Só admin'; end if; delete from profile_pins where profile_id=p; delete from kiosk_sessions where profile_id=p; end $$;
create or replace function public.admin_pin_list() returns table(profile_id uuid, tem_pin boolean, bloqueado_ate timestamptz) language sql stable security definer set search_path=public as
$$ select p.id, k.profile_id is not null, k.bloqueado_ate from profiles p left join profile_pins k on k.profile_id=p.id where is_admin() $$;

-- dispositivos
create or replace function public.admin_create_device(nome text) returns text language plpgsql security definer set search_path=public,extensions as $$
declare t text:='bfk_'||encode(extensions.gen_random_bytes(24),'hex');
begin if not is_admin() then raise exception 'Só admin'; end if;
  insert into kiosk_devices(nome,token_hash,criado_por) values(coalesce(nullif(trim(nome),''),'Aparelho'),_sha(t),auth.uid()); return t; end $$;
create or replace function public.admin_revoke_device(d uuid) returns void language plpgsql security definer set search_path=public as $$
begin if not is_admin() then raise exception 'Só admin'; end if; update kiosk_devices set revogado_em=now() where id=d and revogado_em is null; delete from kiosk_sessions where device_id=d; end $$;

-- núcleo compartilhado pelo app e pelo aparelho (mesmas regras)
create or replace function public._iniciar_turno(uid uuid, orig text) returns public.checklist_days language plpgsql security definer set search_path=public as $$
declare r checklist_days;
begin
  insert into checklist_days(profile_id,data,origem_abertura) values(uid,sp_today(),orig) on conflict do nothing;
  select * into r from checklist_days where profile_id=uid and data=sp_today(); return r;
end $$;
create or replace function public._fechar_turno(uid uuid, tarefas uuid[], proativas text[], orig text) returns public.checklist_days
language plpgsql security definer set search_path=public as $$
declare d checklist_days; t uuid; p text;
begin
  select * into d from checklist_days where profile_id=uid and fechado_em is null and data>=sp_today()-1 order by data desc limit 1 for update;
  if not found then
    if exists(select 1 from checklist_days where profile_id=uid and data=sp_today() and fechado_em is not null) then raise exception 'O checklist de hoje já foi concluído'; end if;
    raise exception 'Inicie o turno antes de fechar';
  end if;
  perform set_config('bfit.fechando','1',true); perform set_config('bfit.dia',d.data::text,true);
  perform set_config('bfit.uid',uid::text,true); perform set_config('bfit.origem',orig,true);
  foreach t in array coalesce(tarefas,'{}') loop
    insert into checklist_entries(profile_id,template_id,tipo) values(uid,t,'obrigatoria') on conflict do nothing; end loop;
  foreach p in array coalesce(proativas,'{}') loop
    if coalesce(trim(p),'')<>'' then insert into checklist_entries(profile_id,tipo,descricao) values(uid,'proativa',left(trim(p),300)); end if; end loop;
  perform set_config('bfit.fechando','',true); perform set_config('bfit.uid','',true);
  update checklist_days set fechado_em=now(),origem_fechamento=orig where profile_id=d.profile_id and data=d.data returning * into d;
  return d;
end $$;
create or replace function public.iniciar_turno() returns public.checklist_days language plpgsql security definer set search_path=public as $$
begin if auth.uid() is null then raise exception 'Sem sessão'; end if; return _iniciar_turno(auth.uid(),'app'); end $$;
create or replace function public.fechar_turno(tarefas uuid[], proativas text[] default '{}') returns public.checklist_days language plpgsql security definer set search_path=public as $$
begin if auth.uid() is null then raise exception 'Sem sessão'; end if; return _fechar_turno(auth.uid(),tarefas,proativas,'app'); end $$;

create or replace function public.checklist_guard() returns trigger language plpgsql security definer set search_path=public as $$
declare t record; who uuid:=coalesce(nullif(current_setting('bfit.uid',true),'')::uuid,auth.uid());
begin
  if tg_op='INSERT' then
    if coalesce(current_setting('bfit.fechando',true),'')<>'1' then raise exception 'Tarefas só são registradas no fechamento do turno'; end if;
    if new.profile_id is distinct from who then raise exception 'Só o próprio colaborador registra'; end if;
    new.data:=current_setting('bfit.dia')::date; new.validado_por:=null; new.validado_em:=null;
    new.origem:=coalesce(nullif(current_setting('bfit.origem',true),''),'app');
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
  if auth.uid()=old.profile_id and not is_admin() then raise exception 'Dia fechado: não é possível alterar'; end if;
  if not can_validate(old.profile_id) then raise exception 'Sem permissão'; end if;
  if old.tipo<>'proativa' then raise exception 'Só proatividade é validada'; end if;
  new.descricao:=old.descricao; new.xp:=old.xp; new.data:=old.data; new.profile_id:=old.profile_id; new.template_id:=null; new.tipo:=old.tipo; new.origem:=old.origem;
  new.validado_por:=case when new.validado_por is null then null else auth.uid() end;
  new.validado_em:=case when new.validado_por is null then null else now() end;
  return new;
end $$;

-- ====== API do aparelho (anon + token do dispositivo) ======
create or replace function public._kiosk_dev(dev text) returns uuid language plpgsql security definer set search_path=public as $$
declare i uuid;
begin
  update kiosk_devices set ultimo_uso=now() where token_hash=_sha(dev) and revogado_em is null returning id into i;
  if i is null then raise exception 'Aparelho não autorizado' using errcode='28000'; end if; return i;
end $$;
create or replace function public._kiosk_who(dev text, sess text) returns uuid language plpgsql security definer set search_path=public as $$
declare d uuid:=_kiosk_dev(dev); u uuid;
begin
  delete from kiosk_sessions where expira_em<now();
  update kiosk_sessions set expira_em=now()+interval '3 minutes' where token_hash=_sha(sess) and device_id=d returning profile_id into u;
  if u is null then raise exception 'Sessão expirada' using errcode='28000'; end if;
  if not exists(select 1 from profiles where id=u and ativo) then raise exception 'Colaborador inativo'; end if;
  return u;
end $$;

create or replace function public.kiosk_team(dev text) returns table(id uuid, nome text, tem_pin boolean)
language plpgsql security definer set search_path=public as $$
begin perform _kiosk_dev(dev);
  return query select p.id, split_part(p.nome,' ',1), exists(select 1 from profile_pins k where k.profile_id=p.id)
   from profiles p where p.ativo and not coalesce(p.fora_do_plano,false) order by p.nome; end $$;

create or replace function public.kiosk_login(dev text, pid uuid, pin text) returns json
language plpgsql security definer set search_path=public,extensions as $$
declare d uuid:=_kiosk_dev(dev); k profile_pins; s text;
begin
  select * into k from profile_pins where profile_id=pid for update;
  if not found or not exists(select 1 from profiles where id=pid and ativo and not coalesce(fora_do_plano,false)) then return json_build_object('ok',false,'erro','Cadastre seu PIN no app (Senha/PIN)'); end if;
  if k.bloqueado_ate>now() then return json_build_object('ok',false,'erro','PIN bloqueado. Tente em '||ceil(extract(epoch from k.bloqueado_ate-now())/60)||' min'); end if;
  if k.pin_hash<>extensions.crypt(coalesce(pin,''),k.pin_hash) then
    update profile_pins set falhas=case when falhas+1>=5 then 0 else falhas+1 end, bloqueado_ate=case when falhas+1>=5 then now()+interval '15 minutes' else bloqueado_ate end where profile_id=pid;
    return json_build_object('ok',false,'erro',case when k.falhas+1>=5 then 'PIN bloqueado por 15 min' else 'PIN incorreto ('||(5-k.falhas-1)||' tentativa(s))' end);
  end if;
  update profile_pins set falhas=0,bloqueado_ate=null where profile_id=pid;
  delete from kiosk_sessions where profile_id=pid or expira_em<now();
  s:=encode(extensions.gen_random_bytes(24),'hex');
  insert into kiosk_sessions values(_sha(s),d,pid,now()+interval '3 minutes');
  return json_build_object('ok',true,'sessao',s);
end $$;

create or replace function public._kiosk_state(u uuid) returns json language plpgsql security definer set search_path=public as $$
declare cur checklist_days; st text; cd date; streak int:=0; d0 date; ex int; xpd int; feitas int;
begin
  select count(*) into ex from task_templates t where t.status='aprovada' and t.function_key in (select function_key from assignments where profile_id=u and ativo);
  select * into cur from checklist_days where profile_id=u and (data=sp_today() or (data=sp_today()-1 and fechado_em is null)) order by data desc limit 1;
  st:=case when cur.profile_id is null then 'novo' when cur.fechado_em is null then 'aberto' else 'fechado' end; cd:=coalesce(cur.data,sp_today());
  select count(*) filter (where tipo='obrigatoria'), coalesce(sum(xp) filter (where tipo='obrigatoria' or validado_por is not null),0) into feitas,xpd from checklist_entries where profile_id=u and data=cd;
  if st<>'fechado' then xpd:=0; end if;
  d0:=sp_today();
  if not exists(select 1 from checklist_days k where k.profile_id=u and k.data=d0 and k.fechado_em is not null
     and (ex=0 or (select count(*) from checklist_entries c where c.profile_id=u and c.data=d0 and c.tipo='obrigatoria')>=ceil(ex/2.0))) then d0:=d0-1; end if;
  loop
    exit when not exists(select 1 from checklist_days k where k.profile_id=u and k.data=d0 and k.fechado_em is not null
     and (ex=0 or (select count(*) from checklist_entries c where c.profile_id=u and c.data=d0 and c.tipo='obrigatoria')>=ceil(ex/2.0))) or streak>60;
    streak:=streak+1; d0:=d0-1;
  end loop;
  return json_build_object('nome',(select split_part(nome,' ',1) from profiles where id=u),'status',st,'data',cd,
    'aberto',to_char(cur.aberto_em at time zone 'America/Sao_Paulo','HH24:MI'),'fechado',to_char(cur.fechado_em at time zone 'America/Sao_Paulo','HH24:MI'),
    'feitas',feitas,'total',ex,'xp_dia',xpd,'sequencia',streak,
    'tarefas',(select coalesce(json_agg(json_build_object('id',t.id,'t',t.titulo,'xp',t.xp,'ok',exists(select 1 from checklist_entries c where c.profile_id=u and c.data=cd and c.template_id=t.id)) order by t.function_key,t.ordem),'[]')
       from task_templates t where t.status='aprovada' and t.function_key in (select function_key from assignments where profile_id=u and ativo)));
end $$;

create or replace function public.kiosk_status(dev text, sess text) returns json language plpgsql security definer set search_path=public as
$$ begin return _kiosk_state(_kiosk_who(dev,sess)); end $$;
create or replace function public.kiosk_iniciar(dev text, sess text) returns json language plpgsql security definer set search_path=public as
$$ declare u uuid:=_kiosk_who(dev,sess); begin perform _iniciar_turno(u,'aparelho'); return _kiosk_state(u); end $$;
create or replace function public.kiosk_fechar(dev text, sess text, tarefas uuid[], proativa text default null) returns json language plpgsql security definer set search_path=public as
$$ declare u uuid:=_kiosk_who(dev,sess); begin perform _fechar_turno(u,tarefas,case when coalesce(trim(proativa),'')='' then '{}'::text[] else array[left(proativa,200)] end,'aparelho'); return _kiosk_state(u); end $$;
create or replace function public.kiosk_logout(dev text, sess text) returns void language plpgsql security definer set search_path=public as
$$ begin perform _kiosk_dev(dev); delete from kiosk_sessions where token_hash=_sha(sess); end $$;

-- permissões
revoke execute on all functions in schema public from anon;
grant execute on function public.kiosk_team(text), public.kiosk_login(text,uuid,text), public.kiosk_status(text,text),
  public.kiosk_iniciar(text,text), public.kiosk_fechar(text,text,uuid[],text), public.kiosk_logout(text,text) to anon;
revoke execute on function public._iniciar_turno(uuid,text), public._fechar_turno(uuid,uuid[],text[],text), public._kiosk_state(uuid),
  public._kiosk_who(text,text), public._kiosk_dev(text) from authenticated, public;

-- endurece: nada executável por PUBLIC; app = authenticated; aparelho = anon só kiosk_*
do $g$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname not like '\_%' then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.proname like 'kiosk\_%' then execute format('grant execute on function %s to anon', f.sig); end if;
  end loop; end $g$;
alter default privileges in schema public revoke execute on functions from public, anon;
