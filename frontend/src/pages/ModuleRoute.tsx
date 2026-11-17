import { useParams } from 'react-router';
import { ModulePage } from '../components/module/ModulePage';
import { NAV } from '../components/shell/nav';
import { RequirePermission } from '../components/shell/guards';
import { MODULES } from '../modules';
import { ComingSoon } from './ComingSoon';
import NotFound from './NotFound';

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * `/m/:module`: the module's page when it is built, the "coming soon" page otherwise.
 * `/m/:module/:id`: the config's `detail` screen for that record, the 404 card when the module has none.
 */
export function ModuleRoute() {
  const { module, id } = useParams();
  for (const g of NAV) {
    const item = g.items.find((i) => i.slug === module && i.to === `/m/${module}`);
    if (!item) continue;
    const config = MODULES[item.slug];
    if (id !== undefined) {
      const Detail = config?.detail;
      if (!Detail) return <NotFound />;
      return (
        <RequirePermission module={item.slug}>
          <Detail key={id} id={id} />
        </RequirePermission>
      );
    }
    return (
      <RequirePermission module={item.slug} also={item.also}>
        {config ? (
          <ModulePage key={item.slug} config={config} />
        ) : (
          <ComingSoon group={g.group ? sentenceCase(g.group) : ''} title={item.label} />
        )}
      </RequirePermission>
    );
  }
  return <NotFound />;
}
