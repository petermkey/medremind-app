'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

export default function SettingsPage() {
  const router = useRouter();
  const { profile, updateProfile, signOut, notificationSettings, updateNotificationSettings } = useStore();
  const { show } = useToast();

  const [name, setName] = useState(profile?.name ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'UTC');
  const [ageRange, setAgeRange] = useState<'18-30'|'31-50'|'51-70'|'70+'>(profile?.ageRange ?? '31-50');
  const [pushEnabled, setPushEnabled] = useState(notificationSettings.pushEnabled);
  const [emailEnabled, setEmailEnabled] = useState(notificationSettings.emailEnabled);
  const [leadTime, setLeadTime] = useState(String(notificationSettings.leadTimeMin));
  const [digestTime, setDigestTime] = useState(notificationSettings.digestTime);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  function saveProfile() {
    updateProfile({ name: name.trim(), timezone, ageRange: ageRange as '18-30'|'31-50'|'51-70'|'70+' });
    show('✓ Profile saved');
  }

  function saveNotifications() {
    updateNotificationSettings({ pushEnabled, emailEnabled, leadTimeMin: parseInt(leadTime), digestTime });
    if (pushEnabled && typeof window !== 'undefined' && 'Notification' in window) {
      Notification.requestPermission().then(perm => {
        if (perm !== 'granted') {
          setPushEnabled(false);
          show('Notification permission denied', 'warning');
        } else {
          show('✓ Notifications enabled');
        }
      });
    } else {
      show('✓ Preferences saved');
    }
  }

  function handleSignOut() {
    signOut();
    router.push('/login');
  }

  function handleDeleteAccount() {
    signOut();
    if (typeof window !== 'undefined') localStorage.clear();
    router.push('/register');
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <h1 className="text-xl font-extrabold text-[#F0F6FC]">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">

        {/* Profile */}
        <Section title="👤 Profile">
          <Input label="Display name" value={name} onChange={e => setName(e.target.value)} />
          <Select label="Age range" value={ageRange} onChange={e => setAgeRange(e.target.value as '18-30'|'31-50'|'51-70'|'70+')}
            options={['18-30','31-50','51-70','70+'].map(v => ({ value: v, label: v }))} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Timezone</label>
            <p className="text-sm text-[#F0F6FC] bg-[#1C2333] px-4 py-3 rounded-xl border border-[rgba(255,255,255,0.08)]">{timezone}</p>
          </div>
          <Button size="sm" onClick={saveProfile}>Save Profile</Button>
        </Section>

        {/* Notifications */}
        <Section title="🔔 Notifications">
          <Toggle label="Push notifications" sub="Browser alerts at dose time" checked={pushEnabled} onChange={setPushEnabled} />
          <Toggle label="Email digest" sub="Daily summary at set time" checked={emailEnabled} onChange={setEmailEnabled} />
          <Select label="Reminder lead time" value={leadTime} onChange={e => setLeadTime(e.target.value)}
            options={[
              { value: '0',  label: 'At dose time' },
              { value: '5',  label: '5 min before' },
              { value: '10', label: '10 min before' },
              { value: '15', label: '15 min before' },
              { value: '30', label: '30 min before' },
            ]}
          />
          {emailEnabled && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#8B949E] uppercase tracking-wide">Daily digest time</label>
              <input type="time" value={digestTime} onChange={e => setDigestTime(e.target.value)}
                className="w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-sm outline-none focus:border-[#3B82F6]"
              />
            </div>
          )}
          <Button size="sm" onClick={saveNotifications}>Save Notifications</Button>
        </Section>

        {/* About */}
        <Section title="ℹ️ About">
          <div className="text-sm text-[#8B949E] leading-relaxed bg-[rgba(59,130,246,0.05)] border border-[rgba(59,130,246,0.15)] rounded-xl p-4">
            <strong className="text-[#F0F6FC]">MedRemind v0.1.0</strong><br /><br />
            This app is a protocol management and adherence tracking tool. It is <strong>not</strong> a medical device and does not provide medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider before starting, modifying, or discontinuing any medication or supplement regimen.
          </div>
          <div className="flex gap-2 text-xs">
            <a href="#" className="text-[#3B82F6] hover:underline">Privacy Policy</a>
            <span className="text-[#8B949E]">·</span>
            <a href="#" className="text-[#3B82F6] hover:underline">Terms of Service</a>
          </div>
        </Section>

        {/* Account */}
        <Section title="⚙️ Account">
          <Button variant="secondary" fullWidth onClick={handleSignOut}>Sign Out</Button>
          {!showDeleteConfirm ? (
            <button onClick={() => setShowDeleteConfirm(true)} className="text-xs text-[#EF4444] hover:underline text-center w-full mt-1">
              Delete account and all data
            </button>
          ) : (
            <div className="bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm text-[#EF4444] font-semibold">This will permanently delete all your data.</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                <Button variant="danger" size="sm" onClick={handleDeleteAccount}>Delete Everything</Button>
              </div>
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-bold text-[#8B949E] uppercase tracking-widest mb-3">{title}</div>
      <div className="bg-[#161B22] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

function Toggle({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-semibold text-[#F0F6FC]">{label}</div>
        <div className="text-xs text-[#8B949E]">{sub}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 ${checked ? 'bg-[#3B82F6]' : 'bg-[#1C2333]'}`}
      >
        <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all duration-200 ${checked ? 'left-6' : 'left-0.5'}`} />
      </button>
    </div>
  );
}
