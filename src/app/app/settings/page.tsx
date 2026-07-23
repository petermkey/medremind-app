'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, waitForRealtimeSyncIdle } from '@/lib/store/store';
import { useFoodStore } from '@/lib/store/foodStore';
import { useNutritionTargetsStore } from '@/lib/store/nutritionTargetsStore';
import { supabaseSignOut, saveProfile } from '@/lib/supabase/auth';
import {
  subscribeToPush,
  unsubscribeFromPush,
  saveNotificationSettingsToSupabase,
  getPushSubscriptionCount,
} from '@/lib/push/subscription';
import { useInstallState } from '@/lib/push/useInstallState';
import {
  backupCurrentStoreToSupabase,
  downloadCurrentStoreSnapshot,
  pullStoreFromSupabase,
} from '@/lib/supabase/cloudStore';
import { importStoreSnapshotToSupabase } from '@/lib/supabase/importStore';
import {
  clearSyncOutbox,
  discardDeadLetteredOperations,
  flushSyncOutbox,
  getSyncStatusSnapshot,
  pumpOutbox,
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

type OuraStatus = {
  connected: boolean;
  status: string | null;
  lastSyncAt: string | null;
  battery?: { level: number; charging: boolean; at: string | null } | null;
  sleepWindowDate?: string | null;
  missingScopes?: string[];
};

export default function SettingsPage() {
  const router = useRouter();
  const { profile, updateProfile, signOut, notificationSettings, updateNotificationSettings } = useStore();
  const { show } = useToast();

  const [name, setName] = useState(profile?.name ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'UTC');
  const [ageRange, setAgeRange] = useState<'18-30'|'31-50'|'51-70'|'70+'>(profile?.ageRange ?? '31-50');
  const [pushEnabled, setPushEnabled] = useState(notificationSettings.pushEnabled);
  const [leadTime, setLeadTime] = useState(String(notificationSettings.leadTimeMin));
  const [morningBriefingEnabled, setMorningBriefingEnabled] = useState(notificationSettings.morningBriefingEnabled);
  const [weeklyReviewEnabled, setWeeklyReviewEnabled] = useState(notificationSettings.weeklyReviewEnabled);
  const [smartFoodTiming, setSmartFoodTiming] = useState(notificationSettings.smartFoodTiming);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [importPayload, setImportPayload] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [outbox, setOutbox] = useState<SyncStatus>(getSyncStatusSnapshot());
  const [flushing, setFlushing] = useState(false);
  const [ouraStatus, setOuraStatus] = useState<OuraStatus | null>(null);
  const [healthSyncStatus, setHealthSyncStatus] = useState('');
  const [healthSyncing, setHealthSyncing] = useState(false);
  const [disconnectingOura, setDisconnectingOura] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [zeroPushSubscriptions, setZeroPushSubscriptions] = useState(false);
  const installState = useInstallState();
  const ringBatteryLow = ouraStatus?.battery ? ouraStatus.battery.level <= 5 : false;

  // Push can be "enabled" in settings with nothing actually registered on
  // this account (failed re-subscribe, VAPID rotation) — the cron used to
  // silently mark those reminders as delivered. Surface it here instead of
  // letting it go unnoticed (docs/system-audit-2026-07-09.md §2).
  useEffect(() => {
    if (!pushEnabled) {
      setZeroPushSubscriptions(false);
      return;
    }
    let cancelled = false;
    getPushSubscriptionCount().then(count => {
      if (!cancelled) setZeroPushSubscriptions(count === 0);
    });
    return () => { cancelled = true; };
  }, [pushEnabled]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/version').then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/integrations/oura/status').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([versionData, ouraData]: [BuildInfo | null, OuraStatus | null]) => {
      if (cancelled) return;
      if (versionData) setBuildInfo(versionData);
      if (ouraData) setOuraStatus(ouraData);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    return subscribeSyncStatus(setOutbox);
  }, []);

  // Sync local form state with store after Zustand rehydrates from localStorage.
  useEffect(() => {
    setPushEnabled(notificationSettings.pushEnabled);
    setLeadTime(String(notificationSettings.leadTimeMin));
    setMorningBriefingEnabled(notificationSettings.morningBriefingEnabled);
    setWeeklyReviewEnabled(notificationSettings.weeklyReviewEnabled);
    setSmartFoodTiming(notificationSettings.smartFoodTiming);
  }, [notificationSettings]);

  async function handleSaveProfile() {
    const patch = { name: name.trim(), timezone, ageRange: ageRange as '18-30'|'31-50'|'51-70'|'70+' };
    updateProfile(patch);
    const p = useStore.getState().profile;
    if (p) saveProfile({ ...p, ...patch }).catch(() => {});
    show('✓ Profile saved');
  }

  async function saveNotifications() {
    try {
      updateNotificationSettings({ pushEnabled, leadTimeMin: parseInt(leadTime), morningBriefingEnabled, weeklyReviewEnabled, smartFoodTiming });
    } catch (err) {
      console.error('[settings] store write error', err);
      show(`Store error: ${String(err)}`, 'warning');
      return;
    }

    // Persist to Supabase so the cron job can find this user.
    saveNotificationSettingsToSupabase({
      pushEnabled,
      leadTimeMin: parseInt(leadTime),
      morningBriefingEnabled,
      weeklyReviewEnabled,
      smartFoodTiming,
    }).catch(err => console.error('[settings] notification_settings sync failed', err));

    if (!pushEnabled) {
      try { await unsubscribeFromPush(); } catch { /* ignore */ }
      show('✓ Preferences saved');
      return;
    }

    try {
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
          show(`Push failed: ${result.message ?? result.reason}`, 'warning');
        }
        return;
      }
      setZeroPushSubscriptions(false);
      show('✓ Push notifications enabled');
    } catch (err) {
      console.error('[settings] subscribeToPush threw', err);
      show(`Push error: ${String(err)}`, 'warning');
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
    const latestOutbox = getSyncStatusSnapshot();
    setOutbox(latestOutbox);
    if (latestOutbox.pending > 0 || latestOutbox.running) {
      setFlushing(true);
      setSyncStatus(`Syncing ${latestOutbox.pending} pending change(s) before sign out...`);
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
    useFoodStore.getState().resetFoodEntries();
    useNutritionTargetsStore.getState().resetNutritionTargets();
    router.push('/login');
  }

  async function handleDeleteAccount() {
    await supabaseSignOut();
    clearSyncOutbox();
    signOut();
    useFoodStore.getState().resetFoodEntries();
    useNutritionTargetsStore.getState().resetNutritionTargets();
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

  function handleClearOutbox() {
    clearSyncOutbox();
    setSyncStatus('Outbox cleared. Local changes that were stuck will not be retried.');
    show('Outbox cleared');
  }

  function handleDiscardDeadLettered() {
    const removed = discardDeadLetteredOperations();
    setSyncStatus(`Discarded ${removed} failed change(s) that could not be synced.`);
    show(removed > 0 ? `Discarded ${removed} failed change(s)` : 'Nothing to discard');
  }

  async function handleRetrySync() {
    setSyncStatus('Retrying sync...');
    await pumpOutbox({ force: true });
    const snap = getSyncStatusSnapshot();
    if (!snap.lastError) {
      setSyncStatus('Sync succeeded.');
      show('✓ Sync OK');
    } else {
      setSyncStatus(`Retry failed: ${snap.lastError}`);
    }
  }

  async function handleHealthSync() {
    setHealthSyncing(true);
    setHealthSyncStatus('Syncing health summaries...');
    try {
      const response = await fetch('/api/integrations/health/sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setHealthSyncStatus(data.error ?? 'Health sync failed.');
        return;
      }
      setHealthSyncStatus(`Health sync complete: ${data.counts?.oura ?? 0} Oura day(s).`);
      const statusResponse = await fetch('/api/integrations/oura/status');
      if (statusResponse.ok) setOuraStatus(await statusResponse.json());
    } finally {
      setHealthSyncing(false);
    }
  }

  async function handleOuraDisconnect() {
    setDisconnectingOura(true);
    try {
      const response = await fetch('/api/integrations/oura/disconnect', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setHealthSyncStatus(data.error ?? 'Oura disconnect failed.');
        return;
      }
      setOuraStatus({
        connected: false,
        status: data.status ?? 'revoked',
        lastSyncAt: null,
        battery: null,
        sleepWindowDate: null,
      });
      setHealthSyncStatus('Oura disconnected in MedRemind.');
    } finally {
      setDisconnectingOura(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <h1 className="text-xl font-extrabold text-[#e8e6e1]">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8">

        {/* Profile */}
        <Section title="Profile">
          <Input label="Display name" value={name} onChange={e => setName(e.target.value)} />
          <Select label="Age range" value={ageRange} onChange={e => setAgeRange(e.target.value as '18-30'|'31-50'|'51-70'|'70+')}
            options={['18-30','31-50','51-70','70+'].map(v => ({ value: v, label: v }))} />
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-mono font-semibold text-[#9b978f] uppercase tracking-wider">Timezone</label>
            <p className="text-sm text-[#e8e6e1] bg-[#191d22] px-4 py-3 rounded-xl border border-[#23272d]">{timezone}</p>
          </div>
          <Button size="sm" onClick={handleSaveProfile}>Save Profile</Button>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          {pushEnabled && zeroPushSubscriptions && (
            <div className="bg-[rgba(201,106,90,0.08)] border border-[rgba(201,106,90,0.25)] rounded-xl px-4 py-3 flex flex-col gap-1">
              <p className="text-xs font-semibold text-[#d98a7c]">Push isn&apos;t actually reaching this device</p>
              <p className="text-xs text-[#9b978f] leading-relaxed">
                Push notifications are turned on, but no subscription is on file for your account. Toggle push off and back on to re-subscribe.
              </p>
            </div>
          )}
          {installState === 'browser' && (
            <div className="bg-[rgba(207,129,72,0.08)] border border-[rgba(207,129,72,0.25)] rounded-xl px-4 py-3 flex flex-col gap-1">
              <p className="text-xs font-semibold text-[#cf8148]">Add to Home Screen for push notifications</p>
              <p className="text-xs text-[#9b978f] leading-relaxed">
                Push notifications only work when MedRemind is installed on your Home Screen. In Safari, tap the share icon and select &ldquo;Add to Home Screen&rdquo;.
              </p>
            </div>
          )}
          <Toggle label="Push notifications" sub="Dose reminders delivered to your device" checked={pushEnabled} onChange={setPushEnabled} />
          <Toggle label="Morning briefing" sub="Daily readiness, sleep, and dose summary (~06:30)" checked={morningBriefingEnabled} onChange={setMorningBriefingEnabled} />
          <Toggle label="Smart reminder timing" sub="Adjusts push reminders around your usual meal times (up to ±90 min)" checked={smartFoodTiming} onChange={setSmartFoodTiming} />
          <Toggle label="Weekly AI review" sub="Monday morning push when your weekly review is ready" checked={weeklyReviewEnabled} onChange={setWeeklyReviewEnabled} />
          <Select label="Reminder lead time" value={leadTime} onChange={e => setLeadTime(e.target.value)}
            options={[
              { value: '0',  label: 'At dose time' },
              { value: '5',  label: '5 min before' },
              { value: '10', label: '10 min before' },
              { value: '15', label: '15 min before' },
              { value: '30', label: '30 min before' },
            ]}
          />
          <Button size="sm" onClick={saveNotifications}>Save Notifications</Button>
        </Section>

        <Section title="Integrations">
          <div className="pb-4 border-b border-[#23272d]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#e8e6e1]">Oura</div>
                <div className="mt-1 text-xs text-[#9b978f] font-mono tabular-nums">
                  {ouraStatus?.connected ? 'Connected' : 'Not connected'}
                  {ouraStatus?.lastSyncAt ? ` · Last sync: ${new Date(ouraStatus.lastSyncAt).toLocaleString()}` : ''}
                  {ouraStatus?.battery
                    ? ` · Battery: ${ouraStatus.battery.level}%${ouraStatus.battery.charging ? ' (charging)' : ''}`
                    : ''}
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                {ouraStatus?.connected ? (
                  <button
                    type="button"
                    onClick={handleOuraDisconnect}
                    disabled={disconnectingOura}
                    className="text-xs font-semibold text-[#e2a89d] hover:underline disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2"
                  >
                    Disconnect
                  </button>
                ) : (
                  <a href="/api/integrations/oura/connect" className="text-xs font-semibold text-[#d9a53f] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2">
                    Connect
                  </a>
                )}
              </div>
            </div>
            {ouraStatus?.connected && (ouraStatus.missingScopes?.length ?? 0) > 0 && (
              <div className="mt-3 rounded-xl border border-[rgba(207,129,72,0.25)] bg-[rgba(207,129,72,0.08)] px-4 py-3 flex flex-col gap-1">
                <p className="text-xs font-semibold text-[#cf8148]">Missing permissions — reconnect Oura</p>
                <p className="text-xs text-[#9b978f] leading-relaxed">
                  Your Oura connection is missing: {ouraStatus.missingScopes!.join(', ')}. Some data won&apos;t sync until you reconnect.
                </p>
                <a href="/api/integrations/oura/connect" className="mt-1 text-xs font-semibold text-[#cf8148] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2">
                  Reconnect Oura →
                </a>
              </div>
            )}
            <a href="https://cloud.ouraring.com/user/apps" className="mt-3 block text-xs font-semibold text-[#9b978f] hover:text-[#e8e6e1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2">
              Manage Oura app access
            </a>
          </div>
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#e8e6e1]">Health sync</div>
                <div className="mt-1 text-xs text-[#9b978f] font-mono tabular-nums">
                  {healthSyncStatus || (ouraStatus?.lastSyncAt ? `Last run: ${new Date(ouraStatus.lastSyncAt).toLocaleString()}` : 'No health sync run shown yet.')}
                  {ringBatteryLow ? ' · Ring battery is low — data may stop arriving.' : ''}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={handleHealthSync} loading={healthSyncing}>
                Sync
              </Button>
            </div>
            <a href="/app/progress" className="text-xs font-semibold text-[#d9a53f] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2">
              Open Progress analytics
            </a>
          </div>
        </Section>

        {/* About */}
        <Section title="About">
          <div className="text-sm text-[#9b978f] leading-relaxed bg-[rgba(217,165,63,0.05)] border border-[rgba(217,165,63,0.15)] rounded-xl p-4">
            <strong className="text-[#e8e6e1]">MedRemind v0.1.0</strong><br /><br />
            This app is a protocol management and adherence tracking tool. It is <strong>not</strong> a medical device and does not provide medical advice, diagnosis, or treatment. Always consult a qualified healthcare provider before starting, modifying, or discontinuing any medication or supplement regimen.
            {buildInfo && (
              <>
                <br /><br />
                <span className="text-xs">
                  Build: <code className="font-mono tabular-nums">{buildInfo.sha.slice(0, 7)}</code> · Env: <code className="font-mono tabular-nums">{buildInfo.environment}</code>
                </span>
              </>
            )}
          </div>
          <div className="flex gap-2 text-xs">
            <a href="#" className="text-[#d9a53f] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2">Privacy Policy</a>
            <span className="text-[#9b978f]">·</span>
            <a href="#" className="text-[#d9a53f] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2">Terms of Service</a>
          </div>
        </Section>

        {/* Account */}
        <Section title="Account">
          <Button variant="secondary" fullWidth onClick={handleSignOut} loading={flushing}>Sign Out</Button>
          {!showDeleteConfirm ? (
            <button onClick={() => setShowDeleteConfirm(true)} className="text-xs text-[#c96a5a] hover:underline text-center w-full mt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2">
              Delete account and all data
            </button>
          ) : (
            <div className="bg-[rgba(201,106,90,0.1)] border border-[rgba(201,106,90,0.3)] rounded-xl p-4 flex flex-col gap-3">
              <p className="text-sm text-[#c96a5a] font-semibold">This will permanently delete all your data.</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
                <Button variant="danger" size="sm" onClick={handleDeleteAccount}>Delete Everything</Button>
              </div>
            </div>
          )}
        </Section>

        <Section title="Data Recovery">
          <p className="text-xs text-[#9b978f] leading-relaxed font-mono tabular-nums">
            Cloud sync: {outbox.pending > 0 ? `${outbox.pending} pending change(s)` : 'all changes synced'}.
            {outbox.lastSuccessAt ? ` Last success: ${new Date(outbox.lastSuccessAt).toLocaleTimeString()}.` : ''}
          </p>
          {outbox.lastError && (
            <div className="bg-[rgba(201,106,90,0.08)] border border-[rgba(201,106,90,0.25)] rounded-xl px-3 py-2 flex flex-col gap-2">
              <p className="text-xs text-[#e2a89d]">Sync error: {outbox.lastError}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleRetrySync}>Retry now</Button>
                <Button variant="danger" size="sm" onClick={handleClearOutbox}>Clear outbox</Button>
              </div>
            </div>
          )}
          {outbox.deadLettered > 0 && (
            <div className="bg-[rgba(201,106,90,0.08)] border border-[rgba(201,106,90,0.25)] rounded-xl px-3 py-2 flex flex-col gap-2">
              <p className="text-xs text-[#e2a89d] font-mono tabular-nums">
                {outbox.deadLettered} change(s) failed permanently after repeated retries and will not sync.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" onClick={handleDiscardDeadLettered}>Discard failed changes</Button>
              </div>
            </div>
          )}
          <p className="text-xs text-[#9b978f] leading-relaxed">
            Import old `medremind-store` snapshot into Supabase for the current signed-in account.
          </p>
          <div className="grid grid-cols-2 gap-2">
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
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" onClick={loadSnapshotFromCurrentBrowser}>
              Load from local storage
            </Button>
            <Button size="sm" onClick={handleCloudImport} loading={importing}>
              Import to cloud
            </Button>
          </div>
          {syncStatus && (
            <p className="text-xs text-[#9b978f] bg-[rgba(143,174,116,0.08)] border border-[rgba(143,174,116,0.2)] rounded-xl px-3 py-2">
              {syncStatus}
            </p>
          )}
          <textarea
            value={importPayload}
            onChange={e => setImportPayload(e.target.value)}
            placeholder="Paste medremind-store JSON here"
            rows={7}
            className="w-full bg-[#191d22] border border-[#23272d] rounded-xl px-4 py-3 text-[#e8e6e1] text-xs font-mono outline-none focus:border-[#d9a53f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2"
          />
          {importStatus && (
            <p className="text-xs text-[#9b978f] bg-[rgba(217,165,63,0.06)] border border-[rgba(217,165,63,0.15)] rounded-xl px-3 py-2">
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
      <div className="text-[10px] font-mono font-semibold text-[#9b978f] uppercase tracking-wider mb-3">{title}</div>
      <div className="bg-[#14171b] border border-[#23272d] rounded-2xl p-4 flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

function Toggle({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-semibold text-[#e8e6e1]">{label}</div>
        <div className="text-xs text-[#9b978f]">{sub}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-label={label}
        aria-pressed={checked}
        className={`w-12 h-6 rounded-full transition-colors duration-200 relative flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#d9a53f] focus-visible:outline-offset-2 ${checked ? 'bg-[#d9a53f]' : 'bg-[#2e333a]'}`}
      >
        <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all duration-200 ${checked ? 'left-6' : 'left-0.5'}`} />
      </button>
    </div>
  );
}
