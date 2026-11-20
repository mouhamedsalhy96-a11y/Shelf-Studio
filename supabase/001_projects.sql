begin;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid () references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  facts text not null default '' check (char_length(facts) <= 1500),
  scene text not null default 'studio' check (scene in ('studio', 'lifestyle', 'seasonal')),
  ratio text not null default '1:1' check (ratio in ('1:1', '4:5', '16:9')),
  channel text not null default 'Product listing' check (
    channel in ('Product listing', 'Instagram', 'Website')
  ),
  source_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint own_project_image_path check (
    source_path like user_id::text || '/' || id::text || '/%'
  )
);

create index if not exists projects_owner_updated on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

revoke all on public.projects
from
  anon;

revoke all on public.projects
from
  authenticated;

grant
select
,
  insert,
update,
delete on public.projects to authenticated;

drop policy if exists projects_select_own on public.projects;

create policy projects_select_own on public.projects for
select
  to authenticated using (
    (
      select
        auth.uid ()
    ) = user_id
  );

drop policy if exists projects_insert_own on public.projects;

create policy projects_insert_own on public.projects for insert to authenticated
with
  check (
    (
      select
        auth.uid ()
    ) = user_id
  );

drop policy if exists projects_update_own on public.projects;

create policy projects_update_own on public.projects
for update
  to authenticated using (
    (
      select
        auth.uid ()
    ) = user_id
  )
with
  check (
    (
      select
        auth.uid ()
    ) = user_id
  );

drop policy if exists projects_delete_own on public.projects;

create policy projects_delete_own on public.projects for delete to authenticated using (
  (
    select
      auth.uid ()
  ) = user_id
);

create or replace function public.stamp_project_update () returns trigger language plpgsql
set
  search_path = '' as $$
begin
 if new.id<>old.id or new.user_id<>old.user_id then raise exception 'Project identity cannot be changed'; end if;
 new.created_at:=old.created_at;
 new.updated_at:=now();
 return new;
end;
$$;

revoke all on function public.stamp_project_update ()
from
  public;

drop trigger if exists stamp_project_update on public.projects;

create trigger stamp_project_update
before update on public.projects for each row
execute function public.stamp_project_update ();

insert into
  storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
  )
values
  (
    'product-images',
    'product-images',
    false,
    8388608,
    array['image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update
set
  public = false,
  file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists product_images_select_own on storage.objects;

create policy product_images_select_own on storage.objects for
select
  to authenticated using (
    bucket_id = 'product-images'
    and (storage.foldername (name)) [1] = (
      select
        auth.uid ()
    )::text
  );

drop policy if exists product_images_insert_own on storage.objects;

create policy product_images_insert_own on storage.objects for insert to authenticated
with
  check (
    bucket_id = 'product-images'
    and (storage.foldername (name)) [1] = (
      select
        auth.uid ()
    )::text
  );

drop policy if exists product_images_update_own on storage.objects;

create policy product_images_update_own on storage.objects
for update
  to authenticated using (
    bucket_id = 'product-images'
    and (storage.foldername (name)) [1] = (
      select
        auth.uid ()
    )::text
  )
with
  check (
    bucket_id = 'product-images'
    and (storage.foldername (name)) [1] = (
      select
        auth.uid ()
    )::text
  );

drop policy if exists product_images_delete_own on storage.objects;

create policy product_images_delete_own on storage.objects for delete to authenticated using (
  bucket_id = 'product-images'
  and (storage.foldername (name)) [1] = (
    select
      auth.uid ()
  )::text
);

commit;
