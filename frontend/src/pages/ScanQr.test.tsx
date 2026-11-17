import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import ScanQr from './ScanQr';

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

function mount() {
  render(
    <MemoryRouter initialEntries={['/scan']}>
      <Routes>
        <Route path="/scan" element={<ScanQr />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const FALLBACK =
  "Votre navigateur ne lit pas les QR codes : ouvrez l'appareil photo de votre téléphone et visez l'étiquette, le lien s'ouvrira dans AgriPilot.";

afterEach(() => vi.unstubAllGlobals());

describe('/scan without BarcodeDetector', () => {
  it('explains, and still offers the field', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Scanner un QR code' })).toBeInTheDocument();
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    expect(screen.getByLabelText("Lien ou code de l'étiquette")).toBeInTheDocument();
    expect(screen.queryByTestId('scan-video')).toBeNull();
  });

  it('opens a pasted link of this site', async () => {
    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Lien ou code de l'étiquette"), `${window.location.origin}/q/lot/abc`);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/q/lot/abc');
  });

  it('opens a pasted path as well', async () => {
    mount();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Lien ou code de l'étiquette"), '/q/animal/a1{enter}');
    expect(await screen.findByTestId('where')).toHaveTextContent('/q/animal/a1');
  });

  it('refuses another site’s link and anything that is not a QR link', async () => {
    mount();
    const user = userEvent.setup();
    const field = screen.getByLabelText("Lien ou code de l'étiquette");
    await user.type(field, 'https://evil.example/q/lot/abc');
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(await screen.findByText("Ce QR code n'appartient pas à AgriPilot")).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    await user.clear(field);
    await user.type(field, `${window.location.origin}/m/lots/abc`);
    await user.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(screen.getByText("Ce QR code n'appartient pas à AgriPilot")).toBeInTheDocument();
  });
});

describe('/scan with BarcodeDetector and a camera', () => {
  const stop = vi.fn();
  let value: string;
  beforeEach(() => {
    stop.mockReset();
    value = `${window.location.origin}/q/lot/abc`;
    class Detector {
      detect() {
        return Promise.resolve([{ rawValue: value }]);
      }
    }
    vi.stubGlobal('BarcodeDetector', Detector);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop }] })) },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('asks for the rear camera and follows a QR of this site', async () => {
    mount();
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(await screen.findByTestId('where', undefined, { timeout: 3000 })).toHaveTextContent('/q/lot/abc');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' } });
    // Leaving the page stops the camera.
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('says so for a QR that is not AgriPilot’s and keeps scanning', async () => {
    value = 'https://evil.example/q/lot/abc';
    mount();
    expect(await screen.findByText("Ce QR code n'appartient pas à AgriPilot", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('stops the camera when the page is left', async () => {
    value = '';
    const { unmount } = render(<MemoryRouter><ScanQr /></MemoryRouter>);
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    await Promise.resolve();
    unmount();
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('explains when the camera cannot be opened and still offers the field', async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('denied'));
    mount();
    expect(await screen.findByText("La caméra n'est pas disponible : collez le lien de l'étiquette ci-dessous.")).toBeInTheDocument();
    expect(screen.queryByTestId('scan-video')).toBeNull();
    expect(screen.getByLabelText("Lien ou code de l'étiquette")).toBeInTheDocument();
  });

  it('labels the camera preview', async () => {
    value = '';
    mount();
    expect(screen.getByLabelText('Aperçu de la caméra')).toBe(screen.getByTestId('scan-video'));
  });
});
