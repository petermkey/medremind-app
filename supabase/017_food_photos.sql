-- Add photo_path column to food_entries
alter table food_entries add column if not exists photo_path text;

-- Create food-photos bucket
insert into storage.buckets (id, name, public)
values ('food-photos', 'food-photos', false)
on conflict (id) do nothing;

-- Create policy for food photos owner read
do $$ begin
  create policy "Food photos owner read" on storage.objects for select
    using (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
exception when duplicate_object then null;
end $$;

-- Create policy for food photos owner write
do $$ begin
  create policy "Food photos owner write" on storage.objects for insert
    with check (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
exception when duplicate_object then null;
end $$;
