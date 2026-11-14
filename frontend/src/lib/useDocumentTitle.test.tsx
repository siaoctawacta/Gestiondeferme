import { render } from '@testing-library/react';
import { useDocumentTitle } from './useDocumentTitle';
import { PageHeader } from '../components/module/PageHeader';

function Probe({ page }: { page: string }) {
  useDocumentTitle(page);
  return null;
}

describe('useDocumentTitle', () => {
  it('sets "{page} — AgriPilot" and follows the page', () => {
    const { rerender } = render(<Probe page="Connexion" />);
    expect(document.title).toBe('Connexion — AgriPilot');
    rerender(<Probe page="Rapports" />);
    expect(document.title).toBe('Rapports — AgriPilot');
  });

  it('is set by the page header', () => {
    render(<PageHeader group="Administration" title="Bâtiments" />);
    expect(document.title).toBe('Bâtiments — AgriPilot');
  });
});
