begin;

-- This ledger intentionally survives project deletion, so deleting projects
-- cannot reset a user's quota. Only server code may reserve or update jobs.
create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null,
  request_key uuid not null,
  snapshot jsonb not null,
  status text not null default 'creating' check (
    status in ('creating', 'processing', 'succeeded', 'failed')
  ),
  description text not null default '',
  caption text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  prediction_id text,
  result_path text,
  error_message text,
  created_at timestamptz not null default now(),
  unique (user_id, request_key)
);

create index if not exists generations_owner_date on public.generations (user_id, created_at desc);

create index if not exists generations_date on public.generations (created_at);

create index if not exists generations_project_date on public.generations (project_id, user_id, created_at desc);

alter table public.generations enable row level security;

revoke all on public.generations
from
  anon,
  authenticated;

grant
select
  on public.generations to authenticated;

grant all on public.generations to service_role;

drop policy if exists generations_select_own on public.generations;

create policy generations_select_own on public.generations for
select
  to authenticated using (
    (
      select
        auth.uid ()
    ) = user_id
  );

create or replace function public.reserve_generation (
  p_user_id uuid,
  p_project_id uuid,
  p_request_key uuid
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
 existing public.generations;
 saved_project public.projects;
 reserved public.generations;
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 -- One shared lock makes the global and per-user checks atomic across servers.
 perform pg_advisory_xact_lock(824731901);
 select * into existing from public.generations where user_id=p_user_id and request_key=p_request_key;
 if found then
  if existing.project_id<>p_project_id then raise exception 'REQUEST_CONFLICT'; end if;
  return jsonb_build_object('created',false,'job',to_jsonb(existing));
 end if;
 select * into saved_project from public.projects where id=p_project_id and user_id=p_user_id;
 if not found then raise exception 'PROJECT_NOT_FOUND'; end if;
 if length(trim(saved_project.facts))=0 then raise exception 'FACTS_REQUIRED'; end if;
 if (select count(*) from public.generations where user_id=p_user_id and created_at>=day_start)>=3 then raise exception 'USER_LIMIT'; end if;
 if (select count(*) from public.generations where created_at>=day_start)>=20 then raise exception 'GLOBAL_LIMIT'; end if;
 if exists(select 1 from public.generations where user_id=p_user_id and created_at>now()-interval '60 seconds') then raise exception 'COOLDOWN'; end if;
 if exists(select 1 from public.generations where user_id=p_user_id and status in ('creating','processing') and created_at>now()-interval '5 minutes') then raise exception 'IN_PROGRESS'; end if;
 insert into public.generations(user_id,project_id,request_key,snapshot)
 values(p_user_id,p_project_id,p_request_key,to_jsonb(saved_project)) returning * into reserved;
 return jsonb_build_object('created',true,'job',to_jsonb(reserved));
end;
$$;

revoke all on function public.reserve_generation (uuid, uuid, uuid)
from
  public,
  anon,
  authenticated;

grant
execute on function public.reserve_generation (uuid, uuid, uuid) to service_role;

commit;
