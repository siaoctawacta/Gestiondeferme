import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../components/module/PageHeader';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { qrPathOf } from '../lib/qr';

const NOT_OURS = "Ce QR code n'appartient pas à AgriPilot";
const NO_DETECTOR =
  "Votre navigateur ne lit pas les QR codes : ouvrez l'appareil photo de votre téléphone et visez l'étiquette, le lien s'ouvrira dans AgriPilot.";
const SCAN_EVERY_MS = 300;

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

const hasDetector = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

/** `/scan`: the camera reads the label where the browser can (`BarcodeDetector`); a field takes a pasted link everywhere. */
export default function ScanQr() {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraFailure, setCameraFailure] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const supported = hasDetector();

  const open = (raw: string) => {
    const path = qrPathOf(raw);
    if (path) navigate(path);
    else setError(NOT_OURS);
  };

  useEffect(() => {
    if (!supported) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | undefined;
    const stopStream = () => stream?.getTracks().forEach((t) => t.stop());

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) return stopStream();
        const el = video.current;
        if (el) {
          el.srcObject = stream;
          await el.play().catch(() => undefined);
        }
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = new Ctor({ formats: ['qr_code'] });
        const tick = async () => {
          if (stopped) return;
          try {
            const found = el ? await detector.detect(el) : [];
            const raw = found[0]?.rawValue;
            if (raw && !stopped) {
              const path = qrPathOf(raw);
              if (path) {
                stopped = true;
                stopStream();
                navigate(path);
                return;
              }
              setError(NOT_OURS);
            }
          } catch {
            // A frame that cannot be read is skipped.
          }
          if (!stopped) timer = setTimeout(() => void tick(), SCAN_EVERY_MS);
        };
        timer = setTimeout(() => void tick(), SCAN_EVERY_MS);
      } catch {
        if (!stopped) setCameraFailure("La caméra n'est pas disponible : collez le lien de l'étiquette ci-dessous.");
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stopStream();
    };
  }, [supported, navigate]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    open(value);
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <PageHeader title="Scanner un QR code" />
      <Card className="space-y-4 p-6">
        {supported && !cameraFailure ? (
          <video ref={video} data-testid="scan-video" muted playsInline className="aspect-square w-full rounded-3xl bg-muted object-cover" />
        ) : (
          <p className="text-sm text-muted-foreground">{supported ? cameraFailure : NO_DETECTOR}</p>
        )}
        {error && <Alert>{error}</Alert>}
        <form onSubmit={submit} className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Lien ou code de l'étiquette" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} />
          </div>
          <Button type="submit">Ouvrir</Button>
        </form>
      </Card>
    </div>
  );
}
