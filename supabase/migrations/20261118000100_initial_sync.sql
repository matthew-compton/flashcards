begin;

create table if not exists public.flashcard_streams (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0
);

create table if not exists public.flashcard_events (
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  revision bigint not null,
  event jsonb not null,
  received_at timestamptz not null default now(),
  primary key (owner_id, event_id),
  unique (owner_id, revision)
);

alter table public.flashcard_streams enable row level security;
alter table public.flashcard_events enable row level security;

revoke all on public.flashcard_streams from anon, authenticated;
revoke all on public.flashcard_events from anon, authenticated;
grant select on public.flashcard_events to authenticated;

drop policy if exists "Read own events" on public.flashcard_events;
create policy "Read own events" on public.flashcard_events for select to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.sync_flashcards(after_revision bigint default 0, new_events jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid := auth.uid();
  current_revision bigint;
  item jsonb;
  item_id uuid;
  page jsonb;
  last_revision bigint;
begin
  if owner is null then raise exception 'Sign in to access flashcards'; end if;
  if jsonb_typeof(new_events) <> 'array' or jsonb_array_length(new_events) > 200 then
    raise exception 'Invalid event batch';
  end if;
  insert into public.flashcard_streams (owner_id) values (owner) on conflict do nothing;
  -- Serializing each user's appends gives every device a gap-free pull cursor.
  select revision into current_revision from public.flashcard_streams where owner_id = owner for update;
  for item in select value from jsonb_array_elements(new_events) loop
    item_id := (item->>'id')::uuid;
    if item_id is null or item->>'type' is null or item->>'at' is null or jsonb_typeof(item->'payload') <> 'object' then
      raise exception 'Invalid study event';
    end if;
    if not exists (select 1 from public.flashcard_events where owner_id = owner and event_id = item_id) then
      current_revision := current_revision + 1;
      insert into public.flashcard_events (owner_id, event_id, revision, event)
        values (owner, item_id, current_revision, item);
    end if;
  end loop;
  update public.flashcard_streams set revision = current_revision where owner_id = owner;
  select coalesce(jsonb_agg(jsonb_build_object('revision', records.revision, 'event', records.event) order by records.revision), '[]'::jsonb),
    coalesce(max(records.revision), after_revision)
  into page, last_revision
  from (select revision, event from public.flashcard_events
    where owner_id = owner and revision > after_revision order by revision limit 500) records;
  return jsonb_build_object('events', page, 'hasMore', last_revision < current_revision);
end;
$$;

revoke all on function public.sync_flashcards(bigint, jsonb) from public, anon;
grant execute on function public.sync_flashcards(bigint, jsonb) to authenticated;

commit;
