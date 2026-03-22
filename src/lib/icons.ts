import type { DoseForm, RouteOfAdmin } from '@/types';

// ─── 16 dose-form icons ─────────────────────────────────────────────────────
export const DOSE_FORM_ICONS: Record<DoseForm, string> = {
  tablet:      '💊', // round pressed tablet
  capsule:     '🔴', // hard-shell capsule
  softgel:     '🫐', // soft-gel / gelcap
  injection:   '💉', // syringe
  cream:       '🧴', // topical cream / lotion
  drops:       '💧', // oral / eye drops
  powder:      '🥄', // powder / granules
  liquid:      '🥤', // oral liquid / syrup
  patch:       '🩹', // transdermal patch
  inhaler:     '🌬️', // pressurised inhaler
  spray:       '💨', // sublingual or oral spray
  eye_drops:   '👁️', // ophthalmic drops
  nasal_spray: '👃', // intranasal spray
  suppository: '🕯️', // rectal / vaginal suppository
  lozenge:     '🍬', // sublingual lozenge / pastille
  other:       '❓', // unspecified form
};

// ─── Route-of-administration icons ──────────────────────────────────────────
export const ROUTE_ICONS: Record<RouteOfAdmin, string> = {
  oral:          '👄', // swallowed by mouth
  subcutaneous:  '💉', // under the skin
  intramuscular: '💪', // into the muscle
  topical:       '🖐️', // applied to skin
  sublingual:    '👅', // under the tongue
  inhalation:    '🌬️', // breathed in
  nasal:         '👃', // into the nose
  iv:            '🏥', // intravenous
  other:         '❓',
};
