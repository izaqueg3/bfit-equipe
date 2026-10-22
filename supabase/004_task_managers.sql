-- Gestores de tarefas (Izaque e Yasmim): inserir, editar, aprovar e retirar tarefas, sem ser admin geral
alter table public.profiles add column if not exists can_manage_tasks boolean not null default false;
-- can_manage_tasks(): is_admin or can_manage_tasks; políticas t_sel/t_ins/t_upd para gestores; delete só admin e sem histórico.
-- trigger task_stamp registra updated_by e aprovada_por/aprovada_em.
