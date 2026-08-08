-- WS9 remediation (L2): seed the global drugs dictionary.
-- Source: src/lib/data/seed.ts's SEED_DRUGS constant (the client's current
-- hardcoded drug list). This does NOT change app behavior — the client
-- still reads SEED_DRUGS directly, not this table. This migration only
-- makes the `drugs` table's contents match what the schema has always
-- implied, for any future feature that queries it directly.
-- See docs/superpowers/plans/2026-08-08-rem-ws9-hygiene-bundle.md.

insert into drugs (id, name, generic_name, category, common_doses, routes, is_custom)
values
  ('61632a82-6a7e-4af4-afef-0fc1d1d9001d', 'Metformin', 'Metformin HCl', 'metabolic', '[{"amount": 500, "unit": "mg"}, {"amount": 1000, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('efd7c7e5-637f-4b20-830f-1c3e98993f92', 'Atorvastatin', 'Atorvastatin', 'cardiovascular', '[{"amount": 10, "unit": "mg"}, {"amount": 20, "unit": "mg"}, {"amount": 40, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('0e451149-2365-4da2-bca3-02391f70d704', 'Lisinopril', 'Lisinopril', 'cardiovascular', '[{"amount": 5, "unit": "mg"}, {"amount": 10, "unit": "mg"}, {"amount": 20, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('8ef792ea-26bd-4b36-8300-d3db95d9a398', 'Amlodipine', 'Amlodipine', 'cardiovascular', '[{"amount": 5, "unit": "mg"}, {"amount": 10, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('703ec1f7-e029-4a34-8a21-c6f173cee889', 'Losartan', 'Losartan', 'cardiovascular', '[{"amount": 25, "unit": "mg"}, {"amount": 50, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('e71fdd59-d42c-4e5a-b0d3-62150abda377', 'Omeprazole', 'Omeprazole', 'gastro', '[{"amount": 20, "unit": "mg"}, {"amount": 40, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('63a43f7b-6fdc-4e4e-be8d-c1d64f7fa603', 'Levothyroxine', 'Levothyroxine', 'hormonal', '[{"amount": 25, "unit": "mcg"}, {"amount": 50, "unit": "mcg"}, {"amount": 100, "unit": "mcg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('06eaa0e0-17fa-4641-b909-7899a5e513cc', 'Insulin Glargine', 'Insulin', 'metabolic', '[{"amount": 10, "unit": "units"}, {"amount": 20, "unit": "units"}]'::jsonb, ARRAY['subcutaneous']::text[], false),
  ('e6ea4811-4f5a-49e7-a8c6-83541182bebf', 'Aspirin', 'Acetylsalicylic acid', 'cardiovascular', '[{"amount": 81, "unit": "mg"}, {"amount": 325, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('854d6b84-f417-4d0c-a455-b21a80a20c39', 'Vitamin D3', 'Cholecalciferol', 'supplement', '[{"amount": 1000, "unit": "IU"}, {"amount": 2000, "unit": "IU"}, {"amount": 5000, "unit": "IU"}]'::jsonb, ARRAY['oral']::text[], false),
  ('a8e5d73a-58b6-4ecd-a5d1-e876e8afd6f0', 'Magnesium', 'Magnesium glycinate', 'supplement', '[{"amount": 200, "unit": "mg"}, {"amount": 400, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('84b7aa27-53a1-4731-adae-c080d8add931', 'Zinc', 'Zinc picolinate', 'supplement', '[{"amount": 15, "unit": "mg"}, {"amount": 30, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('469de80c-d693-4114-92e7-ba2a7e8cb613', 'Omega-3', 'EPA/DHA', 'supplement', '[{"amount": 1000, "unit": "mg"}, {"amount": 2000, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('4d4f58b9-dadf-4a83-af25-ee35bfe22d39', 'Vitamin B12', 'Methylcobalamin', 'supplement', '[{"amount": 500, "unit": "mcg"}, {"amount": 1000, "unit": "mcg"}]'::jsonb, ARRAY['oral','sublingual']::text[], false),
  ('4b48fa75-3bcd-49ac-a478-4f86cbf66aa6', 'Vitamin C', 'Ascorbic acid', 'supplement', '[{"amount": 500, "unit": "mg"}, {"amount": 1000, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('ac523b63-df3b-4d04-94c2-a0ca429a4842', 'Sertraline', 'Sertraline HCl', 'neurological', '[{"amount": 25, "unit": "mg"}, {"amount": 50, "unit": "mg"}, {"amount": 100, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('36082f73-462f-4c84-b2cd-f67ee2010f25', 'Escitalopram', 'Escitalopram', 'neurological', '[{"amount": 5, "unit": "mg"}, {"amount": 10, "unit": "mg"}, {"amount": 20, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('ca64cd1f-cc2c-46d7-bec9-2c8c23eb3a94', 'Melatonin', 'Melatonin', 'supplement', '[{"amount": 1, "unit": "mg"}, {"amount": 3, "unit": "mg"}, {"amount": 5, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('4f5abafb-e201-4192-9f27-46eb900bf567', 'Collagen Peptides', 'Hydrolysed collagen', 'supplement', '[{"amount": 5000, "unit": "mg"}, {"amount": 10000, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('a0f62869-7f2c-4313-b063-615772bf79b8', 'Creatine', 'Creatine monohydrate', 'supplement', '[{"amount": 3000, "unit": "mg"}, {"amount": 5000, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('daae7a1d-4f5d-40dd-848b-43428ab739cf', 'CoQ10', 'Ubiquinone', 'supplement', '[{"amount": 100, "unit": "mg"}, {"amount": 200, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('628d64f0-2f27-4eec-a4fc-c7ca8a397806', 'NAC', 'N-acetyl cysteine', 'supplement', '[{"amount": 600, "unit": "mg"}, {"amount": 1200, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('5e4b3d3f-af39-4a26-9b3d-81592008774d', 'Berberine', 'Berberine HCl', 'metabolic', '[{"amount": 500, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('bbf88d03-23a5-4f88-b097-a1fc3e422181', 'Ashwagandha', 'KSM-66 extract', 'supplement', '[{"amount": 300, "unit": "mg"}, {"amount": 600, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('c1681852-9768-439a-afb5-5340a3d19617', 'Testosterone', 'Testosterone cypionate', 'hormonal', '[{"amount": 100, "unit": "mg"}, {"amount": 200, "unit": "mg"}]'::jsonb, ARRAY['intramuscular','subcutaneous']::text[], false),
  ('96cc2ac2-975e-4460-a140-87bc323f6e14', 'HCG', 'Human chorionic gonadotropin', 'hormonal', '[{"amount": 500, "unit": "IU"}, {"amount": 1000, "unit": "IU"}]'::jsonb, ARRAY['subcutaneous']::text[], false),
  ('54006b90-ba89-4e3c-9f22-5f1cf9634a44', 'Anastrozole', 'Anastrozole', 'hormonal', '[{"amount": 0.25, "unit": "mg"}, {"amount": 0.5, "unit": "mg"}, {"amount": 1, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('846a2ab6-7550-4241-be34-10623b1b3880', 'Semaglutide', 'Semaglutide', 'metabolic', '[{"amount": 0.25, "unit": "mg"}, {"amount": 0.5, "unit": "mg"}, {"amount": 1, "unit": "mg"}]'::jsonb, ARRAY['subcutaneous']::text[], false),
  ('4c66d64d-8f23-4456-9608-b05d8e8f1b1b', 'Metoprolol', 'Metoprolol succinate', 'cardiovascular', '[{"amount": 25, "unit": "mg"}, {"amount": 50, "unit": "mg"}, {"amount": 100, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('263343ea-6ee8-45e2-b6cb-cd01aab9b388', 'Pantoprazole', 'Pantoprazole', 'gastro', '[{"amount": 20, "unit": "mg"}, {"amount": 40, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('2f96205c-8d6f-4603-b8a5-f5bd9aed5af1', 'Iron (Ferrous sulfate)', 'Ferrous sulfate', 'supplement', '[{"amount": 65, "unit": "mg"}, {"amount": 200, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('ac104173-c577-419b-a530-062f17d08bb3', 'Folic Acid', 'Folate', 'supplement', '[{"amount": 400, "unit": "mcg"}, {"amount": 800, "unit": "mcg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('7d2bed14-bb0d-4b83-849b-aebb1f67a3ff', 'Calcium', 'Calcium carbonate', 'supplement', '[{"amount": 500, "unit": "mg"}, {"amount": 1000, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('d080b79d-f741-43ef-afdc-e015f96a16b7', 'Potassium', 'Potassium chloride', 'supplement', '[{"amount": 99, "unit": "mg"}, {"amount": 200, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false),
  ('de4db756-4142-4cfd-9afe-9a548ddb5011', 'Alpha Lipoic Acid', 'ALA', 'supplement', '[{"amount": 200, "unit": "mg"}, {"amount": 600, "unit": "mg"}]'::jsonb, ARRAY['oral']::text[], false)
on conflict (id) do nothing;
