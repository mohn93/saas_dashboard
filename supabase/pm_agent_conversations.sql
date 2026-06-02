-- Chat persistence for the PM Data Agent (shared workspace, full-fidelity).
-- Lives in the pm_agent schema in ULink's prod DB (project ref cjgihassfsspxivjtgoi).

create table if not exists pm_agent.conversations (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  created_by_email text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists pm_agent.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references pm_agent.conversations(id) on delete cascade,
  question        text not null,
  payload         jsonb not null,
  user_email      text,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on pm_agent.messages (conversation_id, created_at);

-- No policies: the dashboard uses the service-role client (bypasses RLS).
-- Enabling RLS hard-blocks any access through the exposed PostgREST API.
alter table pm_agent.conversations enable row level security;
alter table pm_agent.messages      enable row level security;

-- Keep conversations.updated_at fresh whenever a turn is appended (atomic with the insert).
create or replace function pm_agent.bump_conversation_updated_at()
  returns trigger language plpgsql as $$
  begin
    update pm_agent.conversations
      set updated_at = now()
      where id = new.conversation_id;
    return new;
  end $$;

drop trigger if exists messages_bump_updated_at on pm_agent.messages;
create trigger messages_bump_updated_at
  after insert on pm_agent.messages
  for each row execute function pm_agent.bump_conversation_updated_at();

-- PostgREST must reload to expose the new tables (the pm_agent schema is already exposed).
notify pgrst, 'reload schema';
