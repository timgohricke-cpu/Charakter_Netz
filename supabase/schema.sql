-- =====================================================================
-- Charakter-Netz – Version 2: Datenbank, Rechte (Row Level Security), Bilder
-- Ausführen: Supabase → SQL Editor → „New query“ → diesen Text einfügen → „Run“.
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.
-- =====================================================================

create extension if not exists pgcrypto;

-- Die Domain der Pseudo-E-Mail. Muss mit EMAIL_DOMAIN in config.js übereinstimmen.
create or replace function public.cn_email_domain() returns text
language sql immutable set search_path = '' as $$ select 'users.charakter-netz.app'::text $$;

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null check (username ~ '^[A-Za-z0-9_.-]{3,24}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  map_path    text check (map_path is null or char_length(map_path) <= 200),
  map_w       integer check (map_w is null or map_w between 1 and 8192),
  map_h       integer check (map_h is null or map_h between 1 and 8192),
  share_token uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists boards_owner_idx on public.boards (owner_id);
create unique index if not exists boards_share_token_idx on public.boards (share_token);

create table if not exists public.characters (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 100),
  short      text not null default '' check (char_length(short) <= 300),
  info       text not null default '' check (char_length(info) <= 20000),
  place      text not null default '' check (char_length(place) <= 2000),
  image_path text check (image_path is null or char_length(image_path) <= 200),
  x          double precision not null default 0 check (x between -1e6 and 1e6),
  y          double precision not null default 0 check (y between -1e6 and 1e6),
  map_x      double precision check (map_x is null or map_x between 0 and 1),
  map_y      double precision check (map_y is null or map_y between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, id)
);
create index if not exists characters_board_idx on public.characters (board_id);

-- Fraktionen (je Board, mit Farbe) und Status „verstorben“
create table if not exists public.factions (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, id)
);
create index if not exists factions_board_idx on public.factions (board_id);
alter table public.characters add column if not exists dead boolean not null default false;

-- Zuordnung Charakter <-> Fraktionen (keine, eine oder mehrere; beide müssen zum selben Board gehören)
create table if not exists public.character_factions (
  board_id     uuid not null,
  character_id uuid not null,
  faction_id   uuid not null,
  position     smallint not null default 0 check (position between 0 and 20),
  primary key (character_id, faction_id),
  foreign key (board_id, character_id) references public.characters (board_id, id) on delete cascade,
  foreign key (board_id, faction_id) references public.factions (board_id, id) on delete cascade
);
create index if not exists character_factions_board_idx on public.character_factions (board_id);
create index if not exists character_factions_faction_idx on public.character_factions (faction_id);

-- Übergang von der kurzzeitigen Spalte characters.faction_id (nur eine Fraktion) zur Zuordnungstabelle
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'characters' and column_name = 'faction_id') then
    insert into public.character_factions (board_id, character_id, faction_id)
      select board_id, id, faction_id from public.characters where faction_id is not null
      on conflict do nothing;
    alter table public.characters drop constraint if exists characters_faction_fkey;
    alter table public.characters drop column faction_id;
  end if;
end $$;

create table if not exists public.links (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  a          uuid not null,
  b          uuid not null,
  short      text not null check (char_length(short) between 1 and 120),
  long       text not null default '' check (char_length(long) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (a <> b),
  -- Beide Charaktere müssen zum selben Board gehören
  foreign key (board_id, a) references public.characters (board_id, id) on delete cascade,
  foreign key (board_id, b) references public.characters (board_id, id) on delete cascade
);
create index if not exists links_board_idx on public.links (board_id);

create table if not exists public.board_visits (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  visited_at timestamptz not null default now(),
  primary key (user_id, board_id)
);
create index if not exists board_visits_board_idx on public.board_visits (board_id);

-- ---------------------------------------------------------------------
-- Hilfsfunktionen für die Rechte
-- Sie liegen im Schema „private“, das die Supabase-API nicht anbietet: Die Rechte-Regeln können sie
-- benutzen, direkt aufrufen kann sie aber niemand.
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.is_board_owner(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.boards b where b.id = bid and b.owner_id = auth.uid());
$$;

-- Lesen darf: der Ersteller oder wer das Board über den Freigabe-Link besucht hat
create or replace function private.can_read_board(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists (select 1 from public.boards b where b.id = bid and b.owner_id = auth.uid())
    or exists (select 1 from public.board_visits v where v.board_id = bid and v.user_id = auth.uid())
  );
$$;

-- Board-ID aus einem Speicherpfad "<board-id>/<datei>" lesen (ungültig -> null)
create or replace function private.board_id_from_path(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Profil automatisch beim Registrieren anlegen (Benutzername prüfen)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uname text := new.raw_user_meta_data ->> 'username';
begin
  if uname is null or uname !~ '^[A-Za-z0-9_.-]{3,24}$' then
    raise exception 'invalid_username';
  end if;
  -- Die Anmelde-Adresse muss exakt zum Benutzernamen passen
  if lower(new.email) <> (lower(uname) || '@' || public.cn_email_domain()) then
    raise exception 'email_username_mismatch';
  end if;
  insert into public.profiles (id, username) values (new.id, uname);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Zeitstempel und Mengen-Grenzen
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;

create or replace function public.touch_board() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.boards set updated_at = now()
   where id = coalesce(case when tg_op = 'DELETE' then old.board_id else new.board_id end);
  return null;
end;
$$;

create or replace function public.enforce_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'boards' then
    if (select count(*) from public.boards where owner_id = new.owner_id) >= 200 then
      raise exception 'limit_boards';
    end if;
  elsif tg_table_name = 'characters' then
    if (select count(*) from public.characters where board_id = new.board_id) >= 2000 then
      raise exception 'limit_characters';
    end if;
  elsif tg_table_name = 'links' then
    if (select count(*) from public.links where board_id = new.board_id) >= 10000 then
      raise exception 'limit_links';
    end if;
  elsif tg_table_name = 'factions' then
    if (select count(*) from public.factions where board_id = new.board_id) >= 50 then
      raise exception 'limit_factions';
    end if;
  elsif tg_table_name = 'character_factions' then
    if (select count(*) from public.character_factions where character_id = new.character_id) >= 10 then
      raise exception 'limit_char_factions';
    end if;
  end if;
  return new;
end;
$$;

-- Besitzer und Freigabe-Token dürfen nicht über normale Updates verändert werden,
-- Kinder-Datensätze nicht in ein anderes Board verschoben werden.
create or replace function public.protect_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'boards' then
    if new.owner_id <> old.owner_id or new.created_at <> old.created_at then
      raise exception 'immutable_column';
    end if;
    if new.share_token <> old.share_token and current_setting('cn.rotate', true) is distinct from 'on' then
      raise exception 'immutable_column';
    end if;
  elsif new.board_id <> old.board_id then
    raise exception 'immutable_column';
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['boards', 'characters', 'links', 'factions'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function public.touch_updated_at()', t);
    execute format('drop trigger if exists %1$s_limits on public.%1$s', t);
    execute format('create trigger %1$s_limits before insert on public.%1$s for each row execute function public.enforce_limits()', t);
    execute format('drop trigger if exists %1$s_protect on public.%1$s', t);
    execute format('create trigger %1$s_protect before update on public.%1$s for each row execute function public.protect_columns()', t);
  end loop;
  drop trigger if exists character_factions_limits on public.character_factions;
  create trigger character_factions_limits before insert on public.character_factions
    for each row execute function public.enforce_limits();
  foreach t in array array['characters', 'links', 'factions', 'character_factions'] loop
    execute format('drop trigger if exists %1$s_touch_board on public.%1$s', t);
    execute format('create trigger %1$s_touch_board after insert or update or delete on public.%1$s for each row execute function public.touch_board()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.boards       enable row level security;
alter table public.characters   enable row level security;
alter table public.links        enable row level security;
alter table public.board_visits enable row level security;
alter table public.factions     enable row level security;
alter table public.character_factions enable row level security;

-- Nicht angemeldete Besucher bekommen überhaupt keinen Zugriff auf die Tabellen
revoke all on public.profiles, public.boards, public.characters, public.links, public.board_visits, public.factions, public.character_factions from anon;
revoke all on public.profiles, public.boards, public.characters, public.links, public.board_visits, public.factions, public.character_factions from authenticated;
grant select on public.profiles to authenticated;
grant select, insert, delete on public.characters, public.links, public.factions, public.character_factions to authenticated;
-- Ändern nur bei Inhaltsspalten (ID, Board und Zeitstempel bleiben unverändert)
grant update (name, short, info, place, image_path, x, y, map_x, map_y, dead) on public.characters to authenticated;
grant update (short, long) on public.links to authenticated;
grant update (name, color) on public.factions to authenticated;
grant update (position) on public.character_factions to authenticated;
grant select, delete on public.board_visits to authenticated;
grant update (visited_at) on public.board_visits to authenticated;
-- Boards nur spaltenweise: Das Freigabe-Token sieht nur der Ersteller (über get_share_token),
-- Besitzer, ID und Zeitstempel kann niemand selbst setzen.
grant select (id, owner_id, name, map_path, map_w, map_h, created_at, updated_at) on public.boards to authenticated;
grant insert (name, map_path, map_w, map_h) on public.boards to authenticated;
grant update (name, map_path, map_w, map_h) on public.boards to authenticated;
grant delete on public.boards to authenticated;

-- Profile: Man sieht nur sich selbst, die Ersteller der Boards, die man ansehen darf,
-- und die Besucher der eigenen Boards – keine Liste aller Nutzer.
create or replace function private.can_see_profile(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    pid = auth.uid()
    or exists (select 1 from public.board_visits v join public.boards b on b.id = v.board_id
               where v.user_id = auth.uid() and b.owner_id = pid)
    or exists (select 1 from public.board_visits v join public.boards b on b.id = v.board_id
               where v.user_id = pid and b.owner_id = auth.uid())
  );
$$;
revoke all on function private.can_see_profile(uuid) from public, anon;
grant execute on function private.can_see_profile(uuid) to authenticated;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (private.can_see_profile(id));

-- Boards
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated
  using (owner_id = auth.uid() or private.can_read_board(id));
drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards for delete to authenticated
  using (owner_id = auth.uid());

-- Charaktere, Verbindungen und Fraktionen: lesen mit Leserecht, ändern nur als Ersteller
do $$
declare t text;
begin
  foreach t in array array['characters', 'links', 'factions', 'character_factions'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.can_read_board(board_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.is_board_owner(board_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.is_board_owner(board_id)) with check (private.is_board_owner(board_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (private.is_board_owner(board_id))', t);
  end loop;
end $$;

-- Besuche: eigene sehen/aktualisieren/entfernen; der Ersteller darf Besucher seines Boards entfernen.
-- Neue Besuche entstehen nur über die Funktion open_shared_board (mit gültigem Link).
drop policy if exists visits_select on public.board_visits;
create policy visits_select on public.board_visits for select to authenticated
  using (user_id = auth.uid() or private.is_board_owner(board_id));
drop policy if exists visits_update on public.board_visits;
create policy visits_update on public.board_visits for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists visits_delete on public.board_visits;
create policy visits_delete on public.board_visits for delete to authenticated
  using (user_id = auth.uid() or private.is_board_owner(board_id));

-- ---------------------------------------------------------------------
-- Funktionen für Freigabe-Links und Konto
-- ---------------------------------------------------------------------
-- Freigabe-Link öffnen: gibt die Board-ID zurück und merkt sich den Besuch
create or replace function public.open_shared_board(p_board uuid, p_token uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare bid uuid; v_owner uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select id, owner_id into bid, v_owner from public.boards where id = p_board and share_token = p_token;
  if bid is null then return null; end if;
  if v_owner <> auth.uid() then
    insert into public.board_visits (user_id, board_id) values (auth.uid(), bid)
      on conflict (user_id, board_id) do update set visited_at = now();
  end if;
  return bid;
end;
$$;

-- Freigabe-Token lesen (nur Ersteller)
create or replace function public.get_share_token(p_board uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select share_token from public.boards where id = p_board and owner_id = auth.uid();
$$;

-- Neuen Link erzeugen (alter Link wird ungültig); optional alle bisherigen Besucher entfernen
create or replace function public.reset_share_link(p_board uuid, p_remove_visitors boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tok uuid := gen_random_uuid();
begin
  if not private.is_board_owner(p_board) then raise exception 'not_owner'; end if;
  perform set_config('cn.rotate', 'on', true);
  update public.boards set share_token = tok where id = p_board;
  perform set_config('cn.rotate', 'off', true);
  if p_remove_visitors then delete from public.board_visits where board_id = p_board; end if;
  return tok;
end;
$$;

-- Eigenes Konto löschen (Boards, Charaktere, Verbindungen, Besuche werden mitgelöscht;
-- die Bilder löscht die App vorher über die Storage-API)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Die Anmelde-Adresse (Pseudo-E-Mail) darf nachträglich nicht geändert werden, sonst könnte man
-- fremde Benutzernamen blockieren oder sich selbst aussperren.
create or replace function public.protect_auth_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and not exists (
    select 1 from public.profiles p
     where p.id = new.id and lower(new.email) = lower(p.username) || '@' || public.cn_email_domain()) then
    raise exception 'email_change_not_allowed';
  end if;
  return new;
end;
$$;
drop trigger if exists cn_protect_email on auth.users;
create trigger cn_protect_email before update of email on auth.users
  for each row execute function public.protect_auth_email();

-- Höchstzahl an Bildern je Board (schützt den Speicherplatz vor Missbrauch)
create or replace function private.board_image_quota_ok(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select bid is not null and (select count(*) from storage.objects o
    where o.bucket_id = 'board-images' and o.name like bid::text || '/%') < 3000;
$$;

revoke all on function private.is_board_owner(uuid), private.can_read_board(uuid), private.board_id_from_path(text),
  public.open_shared_board(uuid, uuid), public.get_share_token(uuid), public.reset_share_link(uuid, boolean),
  public.delete_my_account(), public.handle_new_user(), public.touch_board(), public.enforce_limits(),
  public.protect_columns(), public.touch_updated_at(), public.cn_email_domain(), public.protect_auth_email(),
  private.board_image_quota_ok(uuid) from public, anon;
-- Interne Funktionen (Trigger, Hilfen) braucht niemand direkt aufzurufen
revoke all on function public.handle_new_user(), public.touch_board(), public.enforce_limits(),
  public.protect_columns(), public.touch_updated_at(), public.cn_email_domain(), public.protect_auth_email()
  from authenticated;
grant execute on function private.is_board_owner(uuid), private.can_read_board(uuid), private.board_id_from_path(text),
  public.open_shared_board(uuid, uuid), public.get_share_token(uuid), public.reset_share_link(uuid, boolean),
  public.delete_my_account(), private.board_image_quota_ok(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Bilder: privater Storage-Bucket, Pfad "<board-id>/<datei>.jpg"
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('board-images', 'board-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists cn_images_select on storage.objects;
create policy cn_images_select on storage.objects for select to authenticated
  using (bucket_id = 'board-images' and private.can_read_board(private.board_id_from_path(name)));
drop policy if exists cn_images_insert on storage.objects;
create policy cn_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'board-images' and private.is_board_owner(private.board_id_from_path(name))
              and private.board_image_quota_ok(private.board_id_from_path(name)));
drop policy if exists cn_images_update on storage.objects;
create policy cn_images_update on storage.objects for update to authenticated
  using (bucket_id = 'board-images' and private.is_board_owner(private.board_id_from_path(name)))
  with check (bucket_id = 'board-images' and private.is_board_owner(private.board_id_from_path(name)));
drop policy if exists cn_images_delete on storage.objects;
create policy cn_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'board-images' and private.is_board_owner(private.board_id_from_path(name)));

-- ---------------------------------------------------------------------
-- Aufräumen: frühere Fassungen der Hilfsfunktionen im öffentlichen Schema entfernen
-- (die Regeln oben verwenden bereits die Fassungen aus „private“)
-- ---------------------------------------------------------------------
drop function if exists public.is_board_owner(uuid);
drop function if exists public.can_read_board(uuid);
drop function if exists public.can_see_profile(uuid);
drop function if exists public.board_image_quota_ok(uuid);
drop function if exists public.board_id_from_path(text);
