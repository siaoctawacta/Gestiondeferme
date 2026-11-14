import { useParams } from 'react-router';
import { ModulePage } from '../components/module/ModulePage';
import { NAV } from '../components/shell/nav';
import { RequirePermission } from '../components/shell/guards';
import { MODULES } from '../modules';
import { ComingSoon } from './ComingSoon';
import NotFound from './NotFound';

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** `/m/:module`: the module's page when it is built, the "coming soon" page otherwise. */
export function ModuleRoute() {
  const { module } = useParams();
  for (const g of NAV) {
    const item = g.items.find((i) => i.slug === module && i.to === `/m/${module}`);
    if (!item) continue;
    const config = MODULES[item.slug];
    return (
      <RequirePermission module={item.slug}>
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
