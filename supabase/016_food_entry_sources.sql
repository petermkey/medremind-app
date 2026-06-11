-- Allow text-AI and duplicated entries alongside photo_ai. Idempotent.
alter table food_entries drop constraint if exists food_entries_source_check;
alter table food_entries add constraint food_entries_source_check
  check (source in ('photo_ai', 'text_ai', 'duplicate'));
