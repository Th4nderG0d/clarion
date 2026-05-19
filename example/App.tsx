import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {RecorderEngine} from '@clarionhq/recorder';
import type {RecorderResult} from '@clarionhq/core';

type LogEntry = {ts: number; line: string};

const ts = () => new Date().toLocaleTimeString();

export default function App(): React.JSX.Element {
  const engine = useMemo(
    () => new RecorderEngine({emitAudioLevel: true, audioLevelIntervalMs: 100}),
    [],
  );
  const [state, setState] = useState<string>('idle');
  const [rms, setRms] = useState<number>(0);
  const [result, setResult] = useState<RecorderResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<ScrollView>(null);

  const log = (line: string) =>
    setLogs(prev => [...prev.slice(-49), {ts: Date.now(), line}]);

  useEffect(() => {
    log(`engine.kind=${engine.kind}`);
    const unsubscribe = engine.on(event => {
      switch (event.type) {
        case 'state':
          setState(event.state);
          log(`state → ${event.state}`);
          if (event.state !== 'recording') {
            setRms(0);
          }
          break;
        case 'audio-level':
          setRms(event.rms);
          break;
        case 'recording-complete':
          setResult(event.result);
          log(
            `done: ${event.result.uri}\n  ${event.result.durationMs}ms · ${(
              event.result.sizeBytes / 1024
            ).toFixed(1)} KB`,
          );
          break;
        case 'error':
          log(`error[${event.error.code}]: ${event.error.message}`);
          break;
      }
    });
    return () => {
      unsubscribe();
      engine.release().catch(() => {});
    };
  }, [engine]);

  useEffect(() => {
    logRef.current?.scrollToEnd({animated: true});
  }, [logs]);

  const requestMicPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone',
        message: 'Clarion needs the mic to record audio.',
        buttonPositive: 'OK',
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const safeCall = (label: string, fn: () => Promise<void>) => async () => {
    try {
      log(`→ ${label}`);
      await fn();
    } catch (err) {
      log(`✗ ${label}: ${String(err)}`);
    }
  };

  const onStart = safeCall('start', async () => {
    const ok = await requestMicPermission();
    if (!ok) throw new Error('mic permission denied');
    setResult(null);
    await engine.start();
  });
  const onPause = safeCall('pause', () => engine.pause());
  const onResume = safeCall('resume', () => engine.resume());
  const onStop = safeCall('stop', () => engine.stop());
  const onDiscard = safeCall('discard', () => engine.discard());

  // Which actions are valid in which state. start() auto-prepares from
  // idle/error, so it's a single button for the whole "begin recording" intent.
  const canStart = state === 'idle' || state === 'ready' || state === 'error';
  const canPause = state === 'recording';
  const canResume = state === 'paused';
  const canStop = state === 'recording' || state === 'paused';
  const canDiscard =
    state === 'starting' ||
    state === 'recording' ||
    state === 'paused';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <View style={styles.header}>
        <Text style={styles.title}>Clarion · Recorder</Text>
        <Text style={styles.subtitle}>@clarionhq/recorder demo</Text>
      </View>

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
    </SafeAreaView>
  );
}

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

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 16},
  header: {paddingTop: 12, paddingBottom: 8},
  title: {color: '#fff', fontSize: 22, fontWeight: '700'},
  subtitle: {color: '#888', fontSize: 12, marginTop: 2},
  stateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 14,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
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
