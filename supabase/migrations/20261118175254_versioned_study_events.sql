begin;

create schema if not exists flashcards_private;
revoke all on schema flashcards_private from public, anon, authenticated;

create function flashcards_private.study_text(value jsonb, max_length integer)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(value) = 'string'
    and length(btrim(value #>> '{}')) between 1 and max_length
    and length(value #>> '{}') <= max_length, false);
$$;

create function flashcards_private.study_date(value jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
begin
  if not flashcards_private.study_text(value, 40) or (value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}($|T)'
  then return false; end if;
  return isfinite((value #>> '{}')::timestamptz);
exception when invalid_datetime_format or datetime_field_overflow then
  return false;
end;
$$;

create function flashcards_private.study_card(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(value) = 'object'
    and flashcards_private.study_text(value->'id', 100)
    and flashcards_private.study_text(value->'fr', 500)
    and flashcards_private.study_text(value->'en', 500)
    and (not value ? 'kind' or value->>'kind' in ('vocabulary', 'example', 'grammar', 'conjugation')), false);
$$;

create function flashcards_private.study_deck(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(value) is distinct from 'object' or jsonb_typeof(value->'cards') is distinct from 'array'
    or jsonb_typeof(value->'attempts') is distinct from 'number' or jsonb_typeof(value->'correct') is distinct from 'number'
  then return false; end if;
  return flashcards_private.study_text(value->'id', 100)
    and flashcards_private.study_text(value->'name', 80)
    and flashcards_private.study_text(value->'category', 80)
    and (value->>'correct') ~ '^[0-9]+$' and (value->>'attempts') ~ '^[0-9]+$'
    and (value->>'correct')::numeric <= (value->>'attempts')::numeric
    and (value->>'attempts')::numeric <= 9007199254740991
    and not exists(select 1 from jsonb_array_elements(value->'cards') card
      where not flashcards_private.study_card(card));
end;
$$;

create function flashcards_private.study_event(value jsonb)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  payload jsonb := value->'payload';
  item jsonb;
  key text;
  target_card boolean;
  target_deck boolean;
  uuid_pattern constant text := '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(value) is distinct from 'object'
    or jsonb_typeof(payload) is distinct from 'object'
    or not coalesce((value->>'id') ~* uuid_pattern and (value->>'generation') ~* uuid_pattern, false)
    or not flashcards_private.study_date(value->'at')
    or (value ? 'schemaVersion' and value->'schemaVersion' <> '1'::jsonb)
  then return false; end if;

  target_deck := flashcards_private.study_text(payload->'deckId', 100);
  target_card := target_deck and flashcards_private.study_text(payload->'cardId', 100);
  case value->>'type'
    when 'library.initialize', 'library.replace' then
      item := payload->'library';
      if value->>'id' <> value->>'generation' or item->'version' is distinct from '11'::jsonb
        or jsonb_typeof(item->'decks') is distinct from 'array'
        or (payload ? 'sourceHash' and not coalesce((payload->>'sourceHash') ~ '^[0-9a-f]{64}$', false))
      then return false; end if;
      return not exists(select 1 from jsonb_array_elements(item->'decks') deck
        where not flashcards_private.study_deck(deck));
    when 'answer' then
      return target_card and jsonb_typeof(payload->'correct') = 'boolean'
        and payload->>'direction' in ('fr', 'en', 'exercise')
        and payload->>'mode' in ('deck', 'shuffled', 'shuffle', 'due', 'missed')
        and flashcards_private.study_text(payload->'sessionId', 100);
    when 'answer.undo' then
      return (payload->>'answerId') ~* uuid_pattern;
    when 'deck.add' then
      return flashcards_private.study_deck(payload->'deck');
    when 'card.add' then
      return target_deck and flashcards_private.study_card(payload->'card');
    when 'card.remove' then
      return target_card;
    when 'flag.upsert' then
      item := payload->'flag';
      return target_card and flashcards_private.study_text(item->'id', 100)
        and item->>'reason' in ('context', 'wording', 'error')
        and item->>'direction' in ('fr', 'en', 'exercise')
        and jsonb_typeof(item->'note') = 'string' and length(item->>'note') <= 2000
        and flashcards_private.study_date(item->'flaggedAt')
        and (not item ? 'resolvedAt' or flashcards_private.study_date(item->'resolvedAt'))
        and flashcards_private.study_text(item->'original'->'fr', 500)
        and flashcards_private.study_text(item->'original'->'en', 500)
        and (not item ? 'revision' or (flashcards_private.study_text(item->'revision'->'fr', 500)
          and flashcards_private.study_text(item->'revision'->'en', 500)));
    when 'card.edit', 'deck.edit' then
      if jsonb_typeof(payload->'fields') is distinct from 'object' then return false; end if;
      for key, item in select * from jsonb_each(payload->'fields') loop
        if value->>'type' = 'card.edit' then
          if not coalesce(case
            when key in ('fr', 'en') then flashcards_private.study_text(item, 500)
            when key = 'kind' then item = 'null'::jsonb or (item #>> '{}') in ('vocabulary', 'grammar', 'conjugation', 'example')
            else false end, false) then return false; end if;
        elsif not (case
          when key in ('name', 'category') then flashcards_private.study_text(item, 80)
          when key = 'topic' then item = 'null'::jsonb or flashcards_private.study_text(item, 120)
          when key in ('frontLanguage', 'backLanguage') then item = 'null'::jsonb or flashcards_private.study_text(item, 80)
          else false end) then return false;
        end if;
      end loop;
      if value->>'type' = 'deck.edit' then return target_deck; end if;
      return target_card and (not payload ? 'resetReview' or jsonb_typeof(payload->'resetReview') = 'boolean');
    else return false;
  end case;
end;
$$;

revoke all on all functions in schema flashcards_private from public, anon, authenticated;

-- Apply validation to future events. Historical rows remain readable by existing clients.
alter table public.flashcard_events add constraint flashcard_events_valid_payload
  check (coalesce(flashcards_private.study_event(event), false)) not valid;

commit;
