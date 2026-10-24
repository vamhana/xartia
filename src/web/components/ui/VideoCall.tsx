// F.4.99.08 — VideoCall. WebRTC-комната для интервью.
// Signaling через WS-канал `interview:<id>` (см. W.2.13.01).
// Запись — на interviewer'е, загрузка в S3 через presigned POST.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { uploadFile } from '../../api/client';
import { colors, fontSize, radius, spacing } from '../../theme';
import { subscribe, send } from '../../ws/client';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export interface VideoCallProps {
  interviewId: string;
  role: 'interviewer' | 'candidate';
  onEnd?: () => void;
}

export interface WebRTCState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  start: () => Promise<void>;
  stop: () => void;
  startRecording: () => void;
  stopRecording: () => Promise<void>;
  isRecording: boolean;
}

export function useWebRTC(
  interviewId: string,
  role: 'interviewer' | 'candidate',
): WebRTCState {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] =
    useState<RTCPeerConnectionState>('new');
  const [isRecording, setIsRecording] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const myConnectionIdRef = useRef<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Захват своего connectionId из welcome (event 'connected').
  // Нужен для фильтрации собственных signaling-событий (эхо).
  useEffect(() => {
    const unsub = subscribe('__webrtc_welcome__', (event, payload) => {
      if (event !== 'connected') {return;}
      const p = payload as { connectionId?: string };
      if (typeof p.connectionId === 'string') {
        myConnectionIdRef.current = p.connectionId;
      }
    });
    return unsub;
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState('closed');
  }, []);

  const startRecording = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {return;}
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm',
    });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {chunksRef.current.push(e.data);}
    };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    send({
      action: 'signal',
      channel: `interview:${interviewId}`,
      event: 'recording_started',
      payload: {},
    });
  }, [interviewId]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') {return;}

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    setIsRecording(false);

    const blob = new Blob(chunksRef.current, {
      type: 'video/webm',
    });
    const file = new File(
      [blob],
      `interview-${interviewId}.webm`,
      { type: 'video/webm' },
    );
    try {
      const uploaded = await uploadFile(file);
      send({
        action: 'signal',
        channel: `interview:${interviewId}`,
        event: 'recording_stopped',
        payload: { key: uploaded.key },
      });
    } catch (e) {
      console.warn('Recording upload failed:', e);
    }
  }, [interviewId]);

  const start = useCallback(async () => {
    // 1. Локальный поток
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);

    // 2. PeerConnection
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const remote = new MediaStream();
    setRemoteStream(remote);
    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach((t) => remote.addTrack(t));
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        send({
          action: 'signal',
          channel: `interview:${interviewId}`,
          event: 'ice_candidate',
          payload: ev.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () =>
      setConnectionState(pc.connectionState);

    // 3. Подписка на signaling
    const unsub = subscribe(
      `interview:${interviewId}`,
      (event, payload) => {
        const p = payload as {
          fromConnectionId?: string;
          offer?: RTCSessionDescriptionInit;
          answer?: RTCSessionDescriptionInit;
          candidate?: RTCIceCandidateInit;
        };
        // Эхо-фильтр: игнорируем свои же signaling-сообщения
        if (
          p.fromConnectionId &&
          p.fromConnectionId === myConnectionIdRef.current
        ) {
          return;
        }

        void (async () => {
          try {
            if (
              event === 'interview.offer' &&
              role === 'candidate' &&
              p.offer
            ) {
              await pc.setRemoteDescription(p.offer);
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              send({
                action: 'signal',
                channel: `interview:${interviewId}`,
                event: 'answer',
                payload: answer,
              });
            } else if (
              event === 'interview.answer' &&
              role === 'interviewer' &&
              p.answer
            ) {
              await pc.setRemoteDescription(p.answer);
            } else if (
              event === 'interview.ice_candidate' &&
              p.candidate
            ) {
              await pc.addIceCandidate(p.candidate);
            } else if (event === 'interview.ended') {
              stop();
            }
          } catch (e) {
            console.warn('signaling error:', e);
          }
        })();
      },
    );

    // 4. Если interviewer — инициируем offer
    if (role === 'interviewer') {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({
        action: 'signal',
        channel: `interview:${interviewId}`,
        event: 'offer',
        payload: offer,
      });
    }

    (pc as unknown as { _unsub?: () => void })._unsub = unsub;
  }, [interviewId, role, stop]);

  // Cleanup при unmount
  useEffect(
    () => () => {
      const unsub = (
        pcRef.current as unknown as { _unsub?: () => void }
      )?._unsub;
      unsub?.();
      stop();
    },
    [stop],
  );

  return {
    localStream,
    remoteStream,
    connectionState,
    start,
    stop,
    startRecording,
    stopRecording,
    isRecording,
  };
}

export function CallControls({
  onMute, onCameraOff, onEnd, onRecord, isRecording,
}: {
  onMute?: () => void;
  onCameraOff?: () => void;
  onEnd?: () => void;
  onRecord?: () => void;
  isRecording?: boolean;
}): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: spacing.sm,
        justifyContent: 'center',
      }}
    >
      {onMute && (
        <Button variant="secondary" onClick={onMute}>
          🔇 Mute
        </Button>
      )}
      {onCameraOff && (
        <Button variant="secondary" onClick={onCameraOff}>
          📷 Off
        </Button>
      )}
      {onRecord && (
        <Button
          variant={isRecording ? 'danger' : 'secondary'}
          onClick={onRecord}
        >
          {isRecording ? '⏹ Stop' : '⏺ Record'}
        </Button>
      )}
      {onEnd && (
        <Button variant="danger" onClick={onEnd}>
          📞 End
        </Button>
      )}
    </div>
  );
}

export function VideoCall({
  interviewId, role, onEnd,
}: VideoCallProps): ReactElement {
  const rtc = useWebRTC(interviewId, role);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  // Автостарт: ровно один раз при mount. rtc.start — useCallback, зависит
  // от (interviewId, role, stop); начальное значение через ref фиксируем
  // на первом рендере, чтобы не зависеть от react-hooks/exhaustive-deps
  // (в проекте этот плагин не установлен).
  const startRef = useRef(rtc.start);
  startRef.current = rtc.start;
  useEffect(() => {
    void startRef.current().catch((e) => console.warn(e));
  }, []);

  useEffect(() => {
    if (localRef.current && rtc.localStream) {
      localRef.current.srcObject = rtc.localStream;
    }
  }, [rtc.localStream]);

  useEffect(() => {
    if (remoteRef.current && rtc.remoteStream) {
      remoteRef.current.srcObject = rtc.remoteStream;
    }
  }, [rtc.remoteStream]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div style={{ width: '90%', maxWidth: 900 }}>
        <Card title={`Интервью (${role})`}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: spacing.md,
              marginBottom: spacing.md,
            }}
          >
            <video
              ref={localRef}
              autoPlay
              muted
              playsInline
              style={{
                width: '100%',
                background: '#000',
                borderRadius: radius.md,
              }}
            />
            <video
              ref={remoteRef}
              autoPlay
              playsInline
              style={{
                width: '100%',
                background: '#000',
                borderRadius: radius.md,
              }}
            />
          </div>
          <div
            style={{
              textAlign: 'center',
              fontSize: fontSize.xs,
              color: colors.textMuted,
              marginBottom: spacing.md,
            }}
          >
            Состояние: {rtc.connectionState}
          </div>
          <CallControls
            onEnd={() => {
              rtc.stop();
              onEnd?.();
            }}
            onRecord={() => {
              if (rtc.isRecording) {
                void rtc.stopRecording();
              } else {
                rtc.startRecording();
              }
            }}
            isRecording={rtc.isRecording}
          />
        </Card>
      </div>
    </div>
  );
}