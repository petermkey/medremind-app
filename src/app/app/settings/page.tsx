'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, waitForRealtimeSyncIdle } from '@/lib/store/store';
import { supabaseSignOut, saveProfile } from '@/lib/supabase/auth';
import { subscribeToPush, unsubscribeFromPush } from '@/lib/push/subscription';
import { useInstallState } from '@/lib/push/useInstallState';
import {
  backupCurrentStoreToSupabase,
  downloadCurrentStoreSnapshot,
  pullStoreFromSupabase,
} from '@/lib/supabase/cloudStore';
import { importStoreSnapshotToSupabase } from '@/lib/supabase/importStore';
import {
  clearSyncOutbox,
  flushSyncOutbox,
  getSyncStatusSnapshot,
  subscribeSyncStatus,
  type SyncStatus,
} from '@/lib/supabase/syncOutbox';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

type BuildInfo = {
  sha: string;
  environment: string;
};

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
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [importPayload, setImportPayload] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [outbox, setOutbox] = useState<SyncStatus>(getSyncStatusSnapshot());
  const [flushing, setFlushing] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const installState = useInstallState();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/version')
      .then(r => (r.ok ? r.json() : null))
      .then((data: BuildInfo | null) => {
        if (!cancelled && data) setBuildInfo(data);
      })
      .catch(() => {
        // Non-critical info; keep UI working even if endpoint is unavailable.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return subscribeSyncStatus(setOutbox);
  }, []);

  async function handleSaveProfile() {
    const patch = { name: name.trim(), timezone, ageRange: ageRange as '18-30'|'31-50'|'51-70'|'70+' };
    updateProfile(patch);
    const p = useStore.getState().profile;
    if (p) saveProfile({ ...p, ...patch }).catch(() => {});
    show('✓ Profile saved');
  }

  async function saveNotifications() {
    updateNotificationSettings({ pushEnabled, emailEnabled, leadTimeMin: parseInt(leadTime), digestTime });

    if (pushEnabled) {
      const result = await subscribeToPush();
      if (!result.ok) {
        if (result.reason === 'not-installed') {
          setPushEnabled(false);
          updateNotificationSettings({ pushEnabled: false });
          show('Add MedRemind to your Home Screen first, then enable push.', 'warning');
        } else if (result.reason === 'permission-denied') {
          setPushEnabled(false);
          updateNotificationSettings({ pushEnabled: false });
          show('Notification permission denied.', 'warning');
        } else {
          show('Push setup failed. Try again.', 'warning');
        }
        return;
      }
      show('✓ Push notifications enabled');
    } else {
      // User turned push off — unsubscribe this device.
      await unsubscribeFromPush();
      show('✓ Preferences saved');
    }
  }

  async function handleSignOut() {
    const realtimeResult = await waitForRealtimeSyncIdle(8_000);
    if (!realtimeResult.ok) {
      const proceed = window.confirm(
        `There are still ${realtimeResult.pending} in-flight sync request(s). Sign out anyway?`,
      );
      if (!proceed) {
        show('Sign out canceled. Please wait for sync completion.', 'warning');
        return;
      }
    }
    if (outbox.pending > 0 || outbox.running) {
      setFlushing(true);
      setSyncStatus(`Syncing ${outbox.pending} pending change(s) before sign out...`);
      try {
        const result = await flushSyncOutbox(8_000);
        if (!result.ok) {
          const proceed = window.confirm(
            `There are still ${result.pending} unsynced change(s). Sign out anyway?`,
          );
          if (!proceed) {
            show('Sign out canceled. Please wait for sync completion.', 'warning');
            return;
          }
        }
      } finally {
        setFlushing(false);
      }
    }
    await unsubscribeFromPush().catch(() => {});
    await supabaseSignOut();
    clearSyncOutbox();
    signOut();
    router.push('/login');
  }

  async function handleDeleteAccount() {
    await supabaseSignOut();
    clearSyncOutbox();
    signOut();
    if (typeof window !== 'undefined') localStorage.clear();
    router.push('/register');
  }

  function loadSnapshotFromCurrentBrowser() {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem('medremind-store');
    if (!raw) {
      setImportStatus('No local medremind-store key found in this browser/origin.');
      return;
    }
    setImportPayload(raw);
    setImportStatus('Loaded medremind-store from current browser.');
  }

  async function handleCloudImport() {
    if (!importPayload.trim()) {
      setImportStatus('Paste medremind-store JSON first.');
      return;
    }
    setImporting(true);
    setImportStatus('Import in progress...');
    try {
      const summary = await importStoreSnapshotToSupabase(importPayload.trim());
      setImportStatus(
        `Imported: protocols ${summary.protocols}, items ${summary.protocolItems}, active ${summary.activeProtocols}, doses ${summary.scheduledDoses}, records ${summary.doseRecords}, custom drugs ${summary.customDrugs}.`
      );
      show('✓ Cloud import completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setImportStatus(message);
      show(message, 'warning');
    } finally {
      setImporting(false);
    }
  }

  function handleExportSnapshot() {
    downloadCurrentStoreSnapshot();
    setSyncStatus('Snapshot exported to file.');
  }

  async function handleBackupCurrentState() {
    setSyncing(true);
    setSyncStatus('Backing up current state to cloud...');
    try {
      const summary = await backupCurrentStoreToSupabase();
      setSyncStatus(
        `Backup done: protocols ${summary.protocols}, items ${summary.protocolItems}, active ${summary.activeProtocols}, doses ${summary.scheduledDoses}, records ${summary.doseRecords}.`
      );
      show('✓ Cloud backup completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cloud backup failed';
      setSyncStatus(message);
      show(message, 'warning');
    } finally {
      setSyncing(false);
    }
  }

  async function handleRestoreFromCloud() {
    setSyncing(true);
    setSyncStatus('Loading cloud data...');
    try {
      const summary = await pullStoreFromSupabase();
      setSyncStatus(
        `Loaded from cloud: protocols ${summary.protocols}, items ${summary.protocolItems}, active ${summary.activeProtocols}, doses ${summary.scheduledDoses}, records ${summary.doseRecords}.`
      );
      show('✓ Cloud restore completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cloud restore failed';
      setSyncStatus(message);
      show(message, 'warning');
    } finally {
      setSyncing(false);
    }
  }

  async function handleFlushSyncNow() {
    setFlushing(true);
    setSyncStatus('Flushing pending sync operations...');
    try {
      const result = await flushSyncOutbox(10_000);
      if (result.ok) {
        setSyncStatus('All pending sync operations completed.');
        show('✓ Sync queue is clean');
      } else {
        const message = `Still pending: ${result.pending}. Last error: ${result.lastError ?? 'unknown'}.`;
        setSyncStatus(message);
        show(message, 'warning');
      }
    } finally {
      setFlushing(false);
    }
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
          <Button size="sm" onClick={handleSaveProfile}>Save Profile</Button>
        </Section>

        {/* Notifications */}
        <Section title="🔔 Notifications">
          {installState === 'browser' && (
            <div className="bg-[rgba(251,191,36,0.08)] border border-[rgba(251,191,36,0.25)] rounded-xl px-4 py-3 flex flex-col gap-1">
              <p className="text-xs font-semibold text-[#FBB924]">Add to Home Screen for push notifications</p>
              <p className="text-xs text-[#8B949E] leading-relaxed">
                Push notifications only work when MedRemind is installed on your Home Screen. In Safari, tap the share icon and select &ldquo;Add to Home Screen&rdquo;.
              </p>
            </div>
          )}
          <Toggle label="Push notifications" sub="Dose reminders delivered to your device" checked={pushEnabled} onChange={setPushEnabled} />
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
            {buildInfo && (
              <>
                <br /><br />
                <span className="text-xs">
                  Build: <code>{buildInfo.sha.slice(0, 7)}</code> · Env: <code>{buildInfo.environment}</code>
                </span>
              </>
            )}
          </div>
          <div className="flex gap-2 text-xs">
            <a href="#" className="text-[#3B82F6] hover:underline">Privacy Policy</a>
            <span className="text-[#8B949E]">·</span>
            <a href="#" className="text-[#3B82F6] hover:underline">Terms of Service</a>
          </div>
        </Section>

        {/* Account */}
        <Section title="⚙️ Account">
          <Button variant="secondary" fullWidth onClick={handleSignOut} loading={flushing}>Sign Out</Button>
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

        <Section title="☁️ Data Recovery">
          <p className="text-xs text-[#8B949E] leading-relaxed">
            Cloud sync: {outbox.pending > 0 ? `${outbox.pending} pending change(s)` : 'all changes synced'}.
            {outbox.lastSuccessAt ? ` Last success: ${new Date(outbox.lastSuccessAt).toLocaleTimeString()}.` : ''}
            {outbox.lastError ? ` Last error: ${outbox.lastError}.` : ''}
          </p>
          <p className="text-xs text-[#8B949E] leading-relaxed">
            Import old `medremind-store` snapshot into Supabase for the current signed-in account.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleExportSnapshot}>
              Export snapshot
            </Button>
            <Button variant="secondary" size="sm" onClick={handleBackupCurrentState} loading={syncing}>
              Backup current to cloud
            </Button>
            <Button variant="secondary" size="sm" onClick={handleRestoreFromCloud} loading={syncing}>
              Restore from cloud
            </Button>
            <Button variant="secondary" size="sm" onClick={handleFlushSyncNow} loading={flushing}>
              Flush sync now
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={loadSnapshotFromCurrentBrowser}>
              Load from local storage
            </Button>
            <Button size="sm" onClick={handleCloudImport} loading={importing}>
              Import to cloud
            </Button>
          </div>
          {syncStatus && (
            <p className="text-xs text-[#8B949E] bg-[rgba(16,185,129,0.08)] border border-[rgba(16,185,129,0.2)] rounded-xl px-3 py-2">
              {syncStatus}
            </p>
          )}
          <textarea
            value={importPayload}
            onChange={e => setImportPayload(e.target.value)}
            placeholder="Paste medremind-store JSON here"
            rows={7}
            className="w-full bg-[#1C2333] border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-[#F0F6FC] text-xs font-mono outline-none focus:border-[#3B82F6]"
          />
          {importStatus && (
            <p className="text-xs text-[#8B949E] bg-[rgba(59,130,246,0.06)] border border-[rgba(59,130,246,0.15)] rounded-xl px-3 py-2">
              {importStatus}
            </p>
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
