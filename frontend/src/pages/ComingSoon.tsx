import { PageHeader } from '../components/module/PageHeader';
import { Card } from '../components/ui/Card';

export function ComingSoon({ group, title }: { group: string; title: string }) {
  return (
    <>
      <PageHeader group={group} title={title} />
      <Card className="p-6 text-sm text-muted-foreground">Module en cours de construction</Card>
    </>
  );
}
