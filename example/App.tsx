import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  AppState,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {RecorderEngine} from '@clarionhq/recorder';
import {RecognizerEngine} from '@clarionhq/recognizer';
import {AzureEngine, type AzureEngineOptions} from '@clarionhq/azure';
import {openAppSettings} from '@clarionhq/core';
import type {
  ClarionEngine,
  ClarionError,
  ClarionWarning,
  RecorderResult,
  TranscriptResult,
} from '@clarionhq/core';

type EngineEventHandlers = {
  /** Fired after the hook records the new state. */
  onState?: (state: string, prev: string) => void;
  onAudioLevel?: (rms: number) => void;
  onPartial?: (result: TranscriptResult) => void;
  /** `prevState` lets callers branch (e.g. session-final vs phrase-final). */
  onFinal?: (result: TranscriptResult, prevState: string) => void;
  onRecordingComplete?: (result: RecorderResult) => void;
  onError?: (error: ClarionError) => void;
  onWarning?: (warning: ClarionWarning) => void;
};

/**
 * Subscribe to a Clarion engine's events with sensible default logging.
 * Handles the common scaffolding (state setter + ref, log lines, cleanup +
 * release on unmount); per-tab variation comes through the handler callbacks.
 * Duplicate state events are filtered. Pass `null` engine to no-op.
 */
function useEngineEvents(
  engine: ClarionEngine | null,
  log: (line: string) => void,
  handlers: EngineEventHandlers,
): {state: string; stateRef: React.MutableRefObject<string>} {
  const [state, setState] = useState<string>('idle');
  const stateRef = useRef<string>('idle');
  stateRef.current = state;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const logRef = useRef(log);
  logRef.current = log;

  useEffect(() => {
    if (!engine) {
      setState('idle');
      return;
    }
    logRef.current(`engine.kind=${engine.kind}`);
    const unsubscribe = engine.on(event => {
      const h = handlersRef.current;
      const l = logRef.current;
      switch (event.type) {
        case 'state': {
          const prev = stateRef.current;
          if (event.state === prev) break;
          setState(event.state);
          l(`state → ${event.state}`);
          h.onState?.(event.state, prev);
          break;
        }
        case 'audio-level':
          h.onAudioLevel?.(event.rms);
          break;
        case 'partial':
          h.onPartial?.(event.result);
          break;
        case 'final':
          h.onFinal?.(event.result, stateRef.current);
          break;
        case 'recording-complete':
          h.onRecordingComplete?.(event.result);
          break;
        case 'error':
          l(`error[${event.error.code}]: ${event.error.message}`);
          h.onError?.(event.error);
          break;
        case 'warning':
          l(`warning[${event.warning.code}]: ${event.warning.message}`);
          h.onWarning?.(event.warning);
          break;
        case 'speech-started':
        case 'speech-ended':
        case 'audio-confidence':
        case 'chunk':
          break;
      }
    });
    return () => {
      unsubscribe();
      engine.release().catch(() => {});
    };
  }, [engine]);

  return {state, stateRef};
}

type Tab = 'recorder' | 'recognizer' | 'azure';

type LogEntry = {ts: number; line: string};
const ts = () => new Date().toLocaleTimeString();

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('recorder');
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <View style={styles.header}>
        <Text style={styles.title}>Clarion</Text>
        <Text style={styles.subtitle}>@clarionhq/* demo</Text>
      </View>
      <View style={styles.tabBar}>
        <TabButton
          label="Recorder"
          active={tab === 'recorder'}
          onPress={() => setTab('recorder')}
        />
        <TabButton
          label="Recognizer"
          active={tab === 'recognizer'}
          onPress={() => setTab('recognizer')}
        />
        <TabButton
          label="Azure"
          active={tab === 'azure'}
          onPress={() => setTab('azure')}
        />
      </View>
      {tab === 'recorder' && <RecorderTab />}
      {tab === 'recognizer' && <RecognizerTab />}
      {tab === 'azure' && <AzureTab />}
    </SafeAreaView>
  );
}

function RecorderTab(): React.JSX.Element {
  const engine = useMemo(
    () => new RecorderEngine({emitAudioLevel: true, audioLevelIntervalMs: 100}),
    [],
  );
  const [rms, setRms] = useState<number>(0);
  const [result, setResult] = useState<RecorderResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<ScrollView>(null);

  const log = (line: string) =>
    setLogs(prev => [...prev.slice(-49), {ts: Date.now(), line}]);

  const {state} = useEngineEvents(engine, log, {
    onState: next => {
      if (next !== 'recording') setRms(0);
    },
    onAudioLevel: setRms,
    onRecordingComplete: r => {
      setResult(r);
      log(`done: ${r.uri}\n  ${r.durationMs}ms · ${(r.sizeBytes / 1024).toFixed(1)} KB`);
    },
  });

  useEffect(() => {
    logRef.current?.scrollToEnd({animated: true});
  }, [logs]);

  const onStart = safeCall(log, 'start', async () => {
    const ok = await requestMicPermission();
    if (!ok) throw new Error('mic permission denied');
    setResult(null);
    await engine.start();
  });
  const onPause = safeCall(log, 'pause', () => engine.pause());
  const onResume = safeCall(log, 'resume', () => engine.resume());
  const onStop = safeCall(log, 'stop', () => engine.stop());
  const onDiscard = safeCall(log, 'discard', () => engine.discard());

  const canStart = state === 'idle' || state === 'ready' || state === 'error';
  const canPause = state === 'recording';
  const canResume = state === 'paused';
  const canStop = state === 'recording' || state === 'paused';
  const canDiscard =
    state === 'starting' || state === 'recording' || state === 'paused';

  return (
    <View style={styles.tabContent}>
      <StateMeterRow state={state} rms={rms} />
      <View style={styles.grid}>
        <Btn label="Start" onPress={onStart} disabled={!canStart} />
        <Btn label="Pause" onPress={onPause} disabled={!canPause} />
        <Btn label="Resume" onPress={onResume} disabled={!canResume} />
        <Btn label="Stop" onPress={onStop} disabled={!canStop} />
        <Btn
          label="Discard"
          onPress={onDiscard}
          disabled={!canDiscard}
          variant="destructive"
        />
      </View>
      {result && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Last recording</Text>
          <Text style={styles.resultLine} selectable>
            {result.uri}
          </Text>
          <Text style={styles.resultMeta}>
            {result.durationMs} ms · {(result.sizeBytes / 1024).toFixed(1)} KB ·{' '}
            {result.audioFormat.sampleRate} Hz / {result.audioFormat.channels}ch
          </Text>
        </View>
      )}
      <LogPanel logs={logs} logRef={logRef} />
    </View>
  );
}

function RecognizerTab(): React.JSX.Element {
  const engine = useMemo(
    () =>
      new RecognizerEngine({
        language: 'en-IN',
        emitPartials: true,
        emitAudioLevel: true,
        audioLevelIntervalMs: 100,
      }),
    [],
  );
  const [rms, setRms] = useState<number>(0);
  const [partial, setPartial] = useState<string>('');
  const [finalResult, setFinalResult] = useState<TranscriptResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<ScrollView>(null);

  const log = (line: string) =>
    setLogs(prev => [...prev.slice(-49), {ts: Date.now(), line}]);

  const {state} = useEngineEvents(engine, log, {
    onState: next => {
      if (next !== 'recording') setRms(0);
    },
    onAudioLevel: setRms,
    onPartial: r => setPartial(r.text),
    onFinal: r => {
      setFinalResult(r);
      setPartial('');
      log(`final: "${r.text || '<empty>'}"`);
    },
  });

  useEffect(() => {
    logRef.current?.scrollToEnd({animated: true});
  }, [logs]);

  const onStart = safeCall(log, 'start', async () => {
    const ok = await requestMicPermission();
    if (!ok) throw new Error('mic permission denied');
    setFinalResult(null);
    setPartial('');
    await engine.start();
  });
  const onStop = safeCall(log, 'stop', () => engine.stop());
  const onDiscard = safeCall(log, 'discard', () => engine.discard());

  const canStart = state === 'idle' || state === 'ready' || state === 'error';
  const canStop = state === 'recording';
  const canDiscard = state === 'recording' || state === 'starting';

  return (
    <View style={styles.tabContent}>
      <StateMeterRow state={state} rms={rms} />
      <View style={styles.grid}>
        <Btn label="Start" onPress={onStart} disabled={!canStart} />
        <Btn label="Stop" onPress={onStop} disabled={!canStop} />
        <Btn
          label="Discard"
          onPress={onDiscard}
          disabled={!canDiscard}
          variant="destructive"
        />
      </View>
      <View style={styles.transcriptCard}>
        <Text style={styles.resultTitle}>LIVE TRANSCRIPT</Text>
        <Text style={styles.partialText} selectable>
          {partial || (state === 'recording' ? '…listening…' : ' ')}
        </Text>
        {finalResult && (
          <>
            <Text style={[styles.resultTitle, {marginTop: 12}]}>FINAL</Text>
            <Text style={styles.finalText} selectable>
              {finalResult.text || '<empty>'}
            </Text>
            <TranscriptDetails result={finalResult} />
          </>
        )}
      </View>
      <LogPanel logs={logs} logRef={logRef} />
    </View>
  );
}

function AzureTab(): React.JSX.Element {
  const [subscriptionKey, setSubscriptionKey] = useState<string>('');
  const [region, setRegion] = useState<string>('eastus');
  const [language, setLanguage] = useState<string>('en-US');
  const [diarization, setDiarization] = useState<boolean>(false);

  // Engine is recreated only when the user commits creds via "Connect".
  // Keeping the engine across input edits would mean reusing stale creds.
  const [connected, setConnected] = useState<boolean>(false);
  const credsRef = useRef<AzureEngineOptions>({
    auth: {subscriptionKey, region},
    recognition: {language},
  });
  const [constructError, setConstructError] = useState<string | null>(null);
  const engine = useMemo(() => {
    if (!connected) return null;
    try {
      setConstructError(null);
      return new AzureEngine(credsRef.current);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConstructError(msg);
      return null;
    }
  }, [connected]);

  const [partial, setPartial] = useState<string>('');
  const [finals, setFinals] = useState<TranscriptResult[]>([]);
  const [sessionFinal, setSessionFinal] = useState<TranscriptResult | null>(
    null,
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<ScrollView>(null);

  const pendingStartRef = useRef<boolean>(false);

  const log = (line: string) =>
    setLogs(prev => [...prev.slice(-49), {ts: Date.now(), line}]);

  const {state} = useEngineEvents(engine, log, {
    onState: next => {
      if (next === 'ready' && pendingStartRef.current) {
        pendingStartRef.current = false;
        engine?.start().catch(err => log(`✗ auto-start: ${String(err)}`));
      }
    },
    onPartial: r => setPartial(r.text),
    onFinal: (r, prev) => {
      // stop() emits the session-final after phrase-finals; anything received
      // while stopping/idle is the session-final.
      if (prev === 'stopping' || prev === 'idle') {
        setSessionFinal(r);
        log(`session-final: "${r.text || '<empty>'}"`);
      } else {
        setFinals(curr => [...curr, r]);
        setPartial('');
        log(`phrase: "${r.text || '<empty>'}"`);
      }
    },
    onError: err => {
      // Re-enable Start/reset by cancelling any pending auto-start.
      pendingStartRef.current = false;
      if (err.openSettings) promptOpenSettings();
    },
  });

  useEffect(() => {
    if (engine) {
      const auth = engine.options.auth;
      const region = 'region' in auth ? auth.region : 'custom-endpoint';
      log(`region=${region}`);
      engine.prepare().then(
        () => log('ready to start'),
        err => log(`prepare failed: ${String(err)}`),
      );
      return;
    }
    if (constructError) {
      log(`✗ invalid config: ${constructError}`);
      pendingStartRef.current = false;
      setConnected(false);
    }
  }, [engine, constructError]);

  useEffect(() => {
    logRef.current?.scrollToEnd({animated: true});
  }, [logs]);

  const onStart = safeCall(log, 'start', async () => {
    const key = subscriptionKey.trim();
    const rgn = region.trim();
    const lang = language.trim();
    if (!key || !rgn || !lang) {
      throw new Error('fill subscriptionKey + region + language');
    }
    const ok = await requestMicPermission();
    if (!ok) throw new Error('mic permission denied');
    setFinals([]);
    setSessionFinal(null);
    setPartial('');
    if (engine) {
      await engine.start();
      return;
    }
    credsRef.current = {
      auth: { subscriptionKey: key, region: rgn },
      recognition: {
        language: lang,
        emitPartials: true,
        outputFormat: 'detailed',
        enableSpeakerDiarization: diarization,
      },
      advanced: {
        autoRetry: { maxAttempts: 2, baseDelayMs: 500 },
      },
      telemetry: {
        onWarning: w => log(`⚠ ${w.code}: ${w.message}`),
      },
    };
    pendingStartRef.current = true;
    setConnected(true);
  });

  const onReset = async () => {
    pendingStartRef.current = false;
    setConnected(false);
    setPartial('');
    setFinals([]);
    setSessionFinal(null);
    log('reset · credentials cleared');
  };
  const onStop = safeCall(log, 'stop', async () => {
    if (!engine) return;
    await engine.stop();
  });
  const onDiscard = safeCall(log, 'discard', async () => {
    if (!engine) return;
    await engine.discard();
  });

  const isBusy =
    state === 'preparing' ||
    state === 'starting' ||
    state === 'stopping' ||
    pendingStartRef.current;
  const isRecording = state === 'recording';
  const canStop = isRecording;
  const canDiscard = !!engine && (state === 'recording' || state === 'starting');
  const inputsDisabled = !!engine && state !== 'idle' && state !== 'error';

  return (
    <View style={styles.tabContent}>
      <View style={styles.credsCard}>
        <Text style={styles.resultTitle}>AZURE</Text>
        <Text style={styles.credsHint}>
          Paste key + region, tap Start. Validated against Azure before audio opens.
        </Text>
        <TextInput
          value={subscriptionKey}
          onChangeText={setSubscriptionKey}
          placeholder="subscription key"
          placeholderTextColor="#4b5563"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          contextMenuHidden={false}
          keyboardType="default"
          editable={!inputsDisabled}
          style={[styles.input, inputsDisabled && styles.inputDisabled]}
        />
        <TextInput
          value={region}
          onChangeText={setRegion}
          placeholder="region (eastus, westeurope, …)"
          placeholderTextColor="#4b5563"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          contextMenuHidden={false}
          keyboardType="default"
          editable={!inputsDisabled}
          style={[styles.input, inputsDisabled && styles.inputDisabled]}
        />
        <TextInput
          value={language}
          onChangeText={setLanguage}
          placeholder="language (en-US, es-ES, …)"
          placeholderTextColor="#4b5563"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          contextMenuHidden={false}
          keyboardType="default"
          editable={!inputsDisabled}
          style={[styles.input, inputsDisabled && styles.inputDisabled]}
        />
        {constructError ? (
          <Text style={styles.inlineError}>✗ {constructError}</Text>
        ) : null}
        <TouchableOpacity
          style={[styles.toggle, diarization && styles.toggleOn]}
          disabled={inputsDisabled}
          onPress={() => setDiarization(v => !v)}>
          <Text style={[styles.toggleText, diarization && styles.toggleTextOn]}>
            {diarization ? '✓ ' : '○ '}
            Speaker diarization (en-US only)
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.stateRow}>
        <Text style={styles.stateLabel}>STATE</Text>
        <Text style={styles.stateValue}>{state}</Text>
        <View style={{flex: 1}} />
        {connected ? (
          <TouchableOpacity onPress={onReset} disabled={isRecording || isBusy}>
            <Text
              style={[
                styles.disconnectLink,
                (isRecording || isBusy) && {opacity: 0.3},
              ]}>
              reset
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.grid}>
        {!isRecording ? (
          <Btn
            label={isBusy ? '…' : 'Start'}
            onPress={onStart}
            disabled={isBusy}
          />
        ) : (
          <Btn label="Stop" onPress={onStop} disabled={!canStop} />
        )}
        <Btn
          label="Discard"
          onPress={onDiscard}
          disabled={!canDiscard}
          variant="destructive"
        />
      </View>
      <View style={styles.transcriptCard}>
        <Text style={styles.resultTitle}>LIVE TRANSCRIPT</Text>
        <Text style={styles.partialText} selectable>
          {partial || (state === 'recording' ? '…listening…' : ' ')}
        </Text>

        {finals.length > 0 && (
          <>
            <Text style={[styles.resultTitle, {marginTop: 12}]}>
              PHRASE FINALS ({finals.length})
            </Text>
            {finals.slice(-5).map(r => (
              <View key={r.id} style={styles.phraseRow}>
                {r.speakerId ? (
                  <Text
                    style={[
                      styles.speakerTag,
                      {color: speakerColor(r.speakerId)},
                    ]}>
                    {r.speakerId}
                  </Text>
                ) : null}
                <Text style={styles.finalText} selectable>
                  · {r.text || '<empty>'}
                </Text>
              </View>
            ))}
          </>
        )}

        {sessionFinal && (
          <>
            <Text style={[styles.resultTitle, {marginTop: 12}]}>
              SESSION FINAL
            </Text>
            <Text style={styles.finalText} selectable>
              {sessionFinal.text || '<empty>'}
            </Text>
            <TranscriptDetails result={sessionFinal} />
          </>
        )}
      </View>
      <LogPanel logs={logs} logRef={logRef} />
    </View>
  );
}

function StateMeterRow({
  state,
  rms,
}: {
  state: string;
  rms: number;
}): React.JSX.Element {
  return (
    <>
      <View style={styles.stateRow}>
        <Text style={styles.stateLabel}>STATE</Text>
        <Text style={styles.stateValue}>{state}</Text>
      </View>
      <View style={styles.meterTrack}>
        <View
          style={[
            styles.meterFill,
            {width: `${Math.min(100, Math.round(rms * 100))}%`},
          ]}
        />
      </View>
      <Text style={styles.meterLabel}>rms {rms.toFixed(3)}</Text>
    </>
  );
}

function TranscriptDetails({
  result,
}: {
  result: TranscriptResult;
}): React.JSX.Element {
  const shortId = (s: string) => (s.length > 8 ? s.slice(0, 8) : s);
  const pct = (c?: number) => (c == null ? '—' : `${Math.round(c * 100)}%`);
  const ms = (n?: number) => (n == null ? '—' : `${Math.round(n)} ms`);
  const segs = result.segments ?? [];

  return (
    <View style={styles.metaWrap}>
      <View style={styles.metaRow}>
        <Meta label="LANG" value={result.language ?? '—'} />
        <Meta label="CONF" value={pct(result.confidence)} />
        <Meta label="OFFSET" value={ms(result.offsetMs)} />
        <Meta label="DURATION" value={ms(result.durationMs)} />
      </View>
      <View style={styles.metaRow}>
        <Meta label="ID" value={shortId(result.id)} mono />
        <Meta label="SESSION" value={shortId(result.sessionId)} mono />
        <Meta label="SEGMENTS" value={String(segs.length)} />
      </View>
      {segs.length > 0 && (
        <View style={styles.segmentsBox}>
          <Text style={styles.metaLabel}>WORD SEGMENTS (iOS)</Text>
          {segs.slice(0, 6).map((s, i) => (
            <Text key={i} style={styles.segmentLine}>
              {`${Math.round(s.startMs)}ms +${Math.round(s.durationMs)}ms  ${s.text}${
                s.confidence != null ? `  ·  ${pct(s.confidence)}` : ''
              }`}
            </Text>
          ))}
          {segs.length > 6 && (
            <Text style={styles.segmentLine}>+{segs.length - 6} more…</Text>
          )}
        </View>
      )}
    </View>
  );
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, mono && styles.metaValueMono]}>
        {value}
      </Text>
    </View>
  );
}

function LogPanel({
  logs,
  logRef,
}: {
  logs: LogEntry[];
  logRef: React.RefObject<ScrollView>;
}): React.JSX.Element {
  return (
    <>
      <View style={styles.logHeader}>
        <Text style={styles.logHeaderText}>EVENT LOG</Text>
      </View>
      <ScrollView ref={logRef} style={styles.logScroll}>
        {logs.map(l => (
          <Text key={`${l.ts}-${l.line}`} style={styles.logLine}>
            {ts()}  {l.line}
          </Text>
        ))}
      </ScrollView>
    </>
  );
}

/**
 * Stable color per Azure speaker id (e.g. "Guest-1"). Cycles through a small
 * palette so two consecutive speakers visually pop apart.
 */
const SPEAKER_PALETTE = [
  '#22d3ee', // cyan
  '#fbbf24', // amber
  '#a7f3d0', // mint
  '#f472b6', // pink
  '#c4b5fd', // violet
];
const speakerColor = (id: string): string => {
  if (!id) return '#9ca3af';
  // Hash the id to a stable palette index.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return SPEAKER_PALETTE[Math.abs(h) % SPEAKER_PALETTE.length] ?? '#9ca3af';
};

/**
 * Show the OS "Open Settings?" dialog when mic access is permanently denied.
 * `openAppSettings()` deep-links to the per-app settings page on both platforms.
 */
const promptOpenSettings = (): void => {
  Alert.alert(
    'Microphone Required',
    'Recording needs microphone access. Open Settings to enable it.',
    [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Open Settings',
        onPress: () => {
          openAppSettings().catch(() => {});
        },
      },
    ],
  );
};

/**
 * "Locked" means the OS told us NEVER_ASK_AGAIN — only Settings can unblock.
 * Reset whenever the user returns from background (they may have just been
 * in Settings flipping the switch).
 */
let micLocked = false;
AppState.addEventListener('change', s => {
  if (s === 'active') micLocked = false;
});

const requestMicPermission = async (): Promise<boolean> => {
  // iOS: engine handles the OS prompt; PERMISSION_DENIED is caught in the
  // engine error listener which calls promptOpenSettings.
  if (Platform.OS !== 'android') return true;

  const has = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  if (has) return true;

  // OS has previously told us it won't prompt again — deep-link to Settings.
  if (micLocked) {
    promptOpenSettings();
    return false;
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone',
      message: 'Clarion needs the mic to record audio.',
      buttonPositive: 'OK',
    },
  );
  if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    micLocked = true;
    promptOpenSettings();
  }
  // DENIED (not NEVER_ASK_AGAIN): Android may still let us prompt next tap —
  // don't lock to Settings prematurely.
  return false;
};

const safeCall =
  (log: (s: string) => void, label: string, fn: () => Promise<void>) =>
  async () => {
    try {
      log(`→ ${label}`);
      await fn();
    } catch (err) {
      log(`✗ ${label}: ${String(err)}`);
    }
  };

type BtnProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'destructive';
  disabled?: boolean;
};
function Btn({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: BtnProps): React.JSX.Element {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.7}
      style={[
        styles.btn,
        variant === 'destructive' && styles.btnDestructive,
        disabled && styles.btnDisabled,
      ]}
      onPress={disabled ? undefined : onPress}
      accessibilityState={{disabled}}>
      <Text style={[styles.btnText, disabled && styles.btnTextDisabled]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 16},
  header: {paddingTop: 12, paddingBottom: 4},
  title: {color: '#fff', fontSize: 22, fontWeight: '700'},
  subtitle: {color: '#888', fontSize: 12, marginTop: 2},

  tabBar: {flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 8},
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  tabBtnActive: {backgroundColor: '#1e3a8a'},
  tabBtnText: {color: '#6b7280', fontWeight: '600'},
  tabBtnTextActive: {color: '#fff'},

  tabContent: {flex: 1},

  stateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 6,
  },
  stateLabel: {color: '#888', fontSize: 11, letterSpacing: 1.2},
  stateValue: {color: '#22d3ee', fontSize: 20, fontWeight: '700'},
  meterTrack: {
    height: 10,
    backgroundColor: '#1c1c1c',
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 12,
  },
  meterFill: {height: '100%', backgroundColor: '#22c55e'},
  meterLabel: {
    color: '#888',
    fontSize: 11,
    marginTop: 4,
    fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}),
  },

  grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16},
  btn: {
    minWidth: '31%',
    flexGrow: 1,
    backgroundColor: '#1f2937',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDestructive: {backgroundColor: '#7f1d1d'},
  btnDisabled: {backgroundColor: '#111827', opacity: 0.5},
  btnText: {color: '#fff', fontWeight: '600'},
  btnTextDisabled: {color: '#6b7280'},

  resultCard: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#111827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  transcriptCard: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#111827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    minHeight: 80,
  },
  resultTitle: {
    color: '#888',
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  resultLine: {
    color: '#a7f3d0',
    fontSize: 12,
    fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}),
  },
  resultMeta: {color: '#9ca3af', fontSize: 11, marginTop: 6},
  partialText: {color: '#fbbf24', fontSize: 16, fontStyle: 'italic'},
  finalText: {color: '#a7f3d0', fontSize: 16, fontWeight: '600'},

  metaWrap: {marginTop: 10},
  metaRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6},
  metaCell: {minWidth: 64},
  metaLabel: {color: '#6b7280', fontSize: 10, letterSpacing: 1.1},
  metaValue: {color: '#e5e7eb', fontSize: 12, fontWeight: '600', marginTop: 2},
  metaValueMono: {
    fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}),
    fontWeight: '500',
  },
  segmentsBox: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#0a0f1e',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  segmentLine: {
    color: '#cbd5e1',
    fontSize: 11,
    fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}),
    marginTop: 4,
  },

  credsCard: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#111827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 8,
  },
  credsHint: {color: '#9ca3af', fontSize: 11, marginBottom: 4},
  inlineError: {
    color: '#fca5a5',
    fontSize: 12,
    backgroundColor: '#2a1414',
    borderColor: '#7f1d1d',
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  inputDisabled: {opacity: 0.5},
  input: {
    backgroundColor: '#0a0f1e',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#e5e7eb',
    fontSize: 13,
    fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}),
  },
  disconnectLink: {color: '#94a3b8', fontSize: 12, textDecorationLine: 'underline'},
  toggle: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0a0f1e',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  toggleOn: {borderColor: '#22d3ee', backgroundColor: '#0a1929'},
  toggleText: {color: '#6b7280', fontSize: 12, fontWeight: '600'},
  toggleTextOn: {color: '#22d3ee'},

  phraseRow: {flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2},
  speakerTag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    minWidth: 56,
  },

  logHeader: {marginTop: 18},
  logHeaderText: {color: '#888', fontSize: 11, letterSpacing: 1.2},
  logScroll: {
    flex: 1,
    marginTop: 6,
    backgroundColor: '#070707',
    borderRadius: 6,
    padding: 8,
  },
  logLine: {
    color: '#d4d4d8',
    fontSize: 11,
    fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}),
    marginVertical: 1,
  },
});
